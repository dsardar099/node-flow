import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Module, NotFoundException, Param, Post, Put, Query, Res, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  ErrorCode,
  NodeFlowError,
  Scope,
  TaskStatus,
  WorkflowStatus,
  hasScope,
  queueNameFor,
  queueScope,
  type JsonValue,
  type Principal,
} from '@node-flow-dev/core';
import { IdentityRepository, TaskDispatchService, TaskLogRepository, TaskQueueRepository, WorkflowRepository, checkDefinition } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, Public, RequireScopes } from '../auth/auth.decorators.js';
import { TokenService } from '../auth/token.service.js';
import { ExecutionController } from '../execution/execution.module.js';
import { MetadataController } from '../metadata/metadata.module.js';
import { QueueController } from '../queue/queue.module.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Conductor wire compatibility.
 *
 * One controller that speaks Conductor's REST shapes and forwards every request
 * to the service that already implements it, so an existing Conductor worker or
 * SDK runs against node-flow with a base-URL change and nothing else.
 *
 * ## Mounted at `/conductor/api`, not `/api`
 *
 * Conductor's own surface is `/api/...`, and SDKs build that path themselves:
 * the JavaScript SDK strips a trailing `/api` from its `serverUrl` and appends
 * `/api/...`, while the Python and Java clients take a base URL that already
 * ends in `/api`. Mounting under `/conductor` therefore serves both — point the
 * JS SDK at `https://host/conductor` and the others at `https://host/conductor/api`
 * — while keeping the compatibility layer clearly separate from the `/v1` API
 * this project actually designs against. It is a translation, not the contract.
 *
 * ## What is translated, and what is not
 *
 * Requests go through the same controllers the `/v1` API uses, so scopes,
 * resource grants, input schemas, quotas, admission control and masking apply
 * unchanged. The namespace comes from the credential, because Conductor has no
 * concept of one and its paths carry none.
 *
 * Two differences are inherent rather than incidental, and are documented rather
 * than papered over:
 *
 *  - **Fencing.** A Conductor `TaskResult` carries no lease token — Conductor has
 *    no equivalent — so the token is read from the task row. A worker that lost
 *    its lease is refused by `workerId` instead, which is weaker: a worker that
 *    kept its id and lost its lease to a timeout could still report. Workers on
 *    the `/v1` API keep the stronger guarantee.
 *  - **Search.** Conductor's query language is an Elasticsearch dialect. The
 *    common equality forms are translated; anything else is ignored rather than
 *    silently mistranslated into a different result set.
 */

const CONDUCTOR = 'conductor/api';

const tokenSchema = z.object({ keyId: z.string().min(1).max(255), keySecret: z.string().min(1).max(4000) });

const startSchema = z.object({
  name: z.string().min(1).max(255),
  version: z.number().int().positive().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  correlationId: z.string().max(255).optional(),
  taskToDomain: z.record(z.string(), z.string()).optional(),
  priority: z.number().int().min(0).max(99).optional(),
  idempotencyKey: z.string().max(255).optional(),
});

const taskResultSchema = z.object({
  workflowInstanceId: z.string().min(1),
  taskId: z.string().min(1),
  status: z.string().min(1),
  outputData: z.record(z.string(), z.unknown()).optional(),
  reasonForIncompletion: z.string().max(4000).optional(),
  workerId: z.string().max(255).optional(),
  callbackAfterSeconds: z.number().int().min(0).max(86_400).optional(),
  logs: z.array(z.object({ log: z.string().max(64_000), createdTime: z.number().optional() })).optional(),
});

/** Conductor task statuses a worker may report, mapped to ours. */
const REPORTED_STATUS: Record<string, TaskStatus> = {
  COMPLETED: TaskStatus.COMPLETED,
  FAILED: TaskStatus.FAILED,
  FAILED_WITH_TERMINAL_ERROR: TaskStatus.FAILED_WITH_TERMINAL_ERROR,
  COMPLETED_WITH_ERRORS: TaskStatus.FAILED,
};

interface ReplyLike {
  header(name: string, value: string): unknown;
  status(code: number): unknown;
  send(payload?: unknown): unknown;
}

/** Conductor returns bare ids and task ids as text; a JSON string would break its clients. */
function text(reply: ReplyLike, body: string, status = 200): void {
  reply.header('content-type', 'text/plain; charset=utf-8');
  reply.status(status);
  reply.send(body);
}

const epoch = (value: unknown): number => (value ? new Date(value as string).getTime() : 0);

@Controller(CONDUCTOR)
export class ConductorController {
  constructor(
    private readonly modules: ModuleRef,
    private readonly workflows: WorkflowRepository,
    private readonly dispatch: TaskDispatchService,
    private readonly queues: TaskQueueRepository,
    private readonly logs: TaskLogRepository,
    private readonly identity: IdentityRepository,
    private readonly tokens: TokenService
  ) {}

  private get executions(): ExecutionController {
    return this.modules.get(ExecutionController, { strict: false });
  }

  private get metadata(): MetadataController {
    return this.modules.get(MetadataController, { strict: false });
  }

  private get queue(): QueueController {
    return this.modules.get(QueueController, { strict: false });
  }

  // ------------------------------------------------------------------ auth

  /**
   * `POST /token` — what every Conductor SDK calls before anything else.
   *
   * A service account's key and secret mints a short-lived token, exactly as
   * `/v1/auth/token` does. An API key is also accepted as the secret, so a
   * worker with only a key needs no second credential; the key is handed back
   * as the token, and the guard accepts it in `X-Authorization`.
   */
  @Public()
  @Post('token')
  @HttpCode(200)
  @ApiRoute({ summary: 'Conductor-compatible token exchange', tags: ['conductor'], body: tokenSchema })
  async token(@Body() body: unknown) {
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) throw new NodeFlowError(ErrorCode.INVALID_ARGUMENT, 'keyId and keySecret are required');
    const { keyId, keySecret } = parsed.data;

    if (keySecret.startsWith('nf_')) {
      const principal = await this.identity.authenticateApiKey(keySecret);
      if (!principal) throw unauthorised();
      return { token: keySecret };
    }

    const principal = await this.identity.authenticateServiceAccount(keyId, keySecret);
    if (!principal) throw unauthorised();
    return { token: (await this.tokens.issue(principal)).token };
  }

  // -------------------------------------------------------------- metadata

  @Post('metadata/workflow')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Register a workflow definition (Conductor)', tags: ['conductor'] })
  async registerWorkflow(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    await this.registerOrAcceptIdentical(principal, body);
    return {};
  }

  /** Conductor's `PUT` takes a list and overwrites; each becomes a new immutable version here. */
  @Put('metadata/workflow')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Register workflow definitions in bulk (Conductor)', tags: ['conductor'] })
  async registerWorkflows(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    for (const definition of Array.isArray(body) ? body : [body]) {
      await this.registerOrAcceptIdentical(principal, definition);
    }
    return {};
  }

  /**
   * Registering the definition that is already there is not an error.
   *
   * Conductor's `overwrite=true` replaces a version in place. node-flow cannot:
   * versions are immutable because a running instance is pinned to one, and a
   * fork/join mid-flight must not have its branches change underneath it. So a
   * *changed* definition at an existing version is still refused, and the
   * message says to register a new version.
   *
   * An *unchanged* one is different. Re-running a deploy, or re-syncing, sends
   * exactly what the server already holds, and there is nothing to refuse —
   * nothing would change. Refusing it made every deploy pipeline fail on its
   * second run.
   *
   * The comparison is against the *parsed* definition rather than the raw body,
   * so defaults, field order and the fields Conductor's SDK always sends but
   * node-flow stores differently cannot make two equal definitions look
   * different. That matters more than it sounds: the bug that led here was one
   * such field, and a client-side diff cannot be trusted to know about them.
   */
  private async registerOrAcceptIdentical(principal: Principal, body: unknown): Promise<void> {
    try {
      await this.metadata.registerWorkflow(principal, body);
    } catch (error) {
      if (!(error instanceof NodeFlowError) || error.code !== ErrorCode.CONFLICT) throw error;

      const checked = checkDefinition(body);
      if (!checked.valid) throw error;

      const stored = await this.metadata
        .getWorkflow(principal, checked.definition.name, String(checked.definition.version))
        .catch(() => undefined);

      if (!stored || !sameDefinition(stored, checked.definition)) throw error;
    }
  }

  @Get('metadata/workflow')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List workflow definitions (Conductor)', tags: ['conductor'] })
  async listWorkflows(@CurrentPrincipal() principal: Principal) {
    const listed = await this.metadata.listWorkflows(principal);
    return Promise.all(listed.map((row) => this.definitionOf(principal, row.name, row.version)));
  }

  @Get('metadata/workflow/:name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Fetch a workflow definition (Conductor)', tags: ['conductor'] })
  async getWorkflow(@CurrentPrincipal() principal: Principal, @Param('name') name: string, @Query('version') version?: string) {
    return this.definitionOf(principal, name, version ? Number(version) : undefined);
  }

  @Delete('metadata/workflow/:name/:version')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete a workflow version (Conductor)', tags: ['conductor'] })
  async deleteWorkflow(@CurrentPrincipal() principal: Principal, @Param('name') name: string, @Param('version') version: string) {
    await this.metadata.deleteWorkflow(principal, name, version);
    return {};
  }

  @Post('metadata/taskdefs')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Create task definitions (Conductor)', tags: ['conductor'] })
  async createTaskDefs(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    for (const definition of Array.isArray(body) ? body : [body]) await this.metadata.upsertTaskDefinition(principal, definition);
    return {};
  }

  @Put('metadata/taskdefs')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Update a task definition (Conductor)', tags: ['conductor'] })
  updateTaskDef(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.metadata.upsertTaskDefinition(principal, body);
  }

  @Get('metadata/taskdefs')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List task definitions (Conductor)', tags: ['conductor'] })
  listTaskDefs(@CurrentPrincipal() principal: Principal) {
    return this.metadata.listTaskDefinitions(principal);
  }

  @Get('metadata/taskdefs/:name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Fetch a task definition (Conductor)', tags: ['conductor'] })
  getTaskDef(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    return this.metadata.getTaskDefinition(principal, name);
  }

  // -------------------------------------------------------------- workflow

  /** `POST /workflow` — a `StartWorkflowRequest`; the id comes back as plain text. */
  @Post('workflow')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_START)
  @ApiRoute({ summary: 'Start a workflow (Conductor)', tags: ['conductor'], body: startSchema })
  async startWorkflow(@CurrentPrincipal() principal: Principal, @Body() body: unknown, @Res() reply: ReplyLike) {
    const request = startSchema.parse(body);
    const started = await this.executions.start(principal, request.name, {
      input: request.input ?? {},
      version: request.version,
      correlationId: request.correlationId,
      taskToDomain: request.taskToDomain,
      priority: request.priority,
      idempotencyKey: request.idempotencyKey,
    } as never);
    text(reply, started.workflowId);
  }

  /** `POST /workflow/{name}` — the body *is* the input, and options are query parameters. */
  @Post('workflow/:name')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_START)
  @ApiRoute({ summary: 'Start a workflow by name (Conductor)', tags: ['conductor'] })
  async startNamed(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body() input: unknown,
    @Res() reply: ReplyLike,
    @Query('version') version?: string,
    @Query('correlationId') correlationId?: string,
    @Query('priority') priority?: string
  ) {
    const started = await this.executions.start(principal, name, {
      input: (input ?? {}) as Record<string, unknown>,
      ...(version ? { version: Number(version) } : {}),
      ...(correlationId ? { correlationId } : {}),
      ...(priority ? { priority: Number(priority) } : {}),
    } as never);
    text(reply, started.workflowId);
  }

  /** `POST /workflow/execute/{name}` — start and wait, Conductor's synchronous start. */
  @Post(['workflow/execute/:name', 'workflow/execute/:name/:version'])
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_START)
  @ApiRoute({ summary: 'Start a workflow and wait (Conductor)', tags: ['conductor'] })
  async executeWorkflow(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body() body: unknown,
    @Param('version') version?: string,
    @Query('waitUntilTaskRef') waitUntilTaskRef?: string,
    @Query('waitForSeconds') waitForSeconds?: string
  ) {
    const request = (body ?? {}) as { input?: Record<string, unknown>; correlationId?: string; requestId?: string };
    // Conductor's request nests the input; a bare input object is also accepted.
    const input = request.input ?? (request as Record<string, unknown>);
    const outcome = await this.executions.execute(principal, name, {
      input,
      ...(version ? { version: Number(version) } : {}),
      ...(request.correlationId ? { correlationId: request.correlationId } : {}),
      ...(request.requestId ? { idempotencyKey: request.requestId } : {}),
      ...(waitUntilTaskRef ? { waitUntilTaskRef } : {}),
      waitForSeconds: waitForSeconds ? Math.min(Number(waitForSeconds), 60) : 10,
    } as never);
    return this.workflowJson(principal, outcome.workflowId);
  }

  @Get('workflow/:workflowId')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Fetch an execution (Conductor)', tags: ['conductor'] })
  async getWorkflowRun(@CurrentPrincipal() principal: Principal, @Param('workflowId') workflowId: string, @Query('includeTasks') includeTasks?: string) {
    return this.workflowJson(principal, workflowId, includeTasks !== 'false');
  }

  @Get('workflow/:name/correlated/:correlationId')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Executions by correlation id (Conductor)', tags: ['conductor'] })
  async correlated(@CurrentPrincipal() principal: Principal, @Param('name') name: string, @Param('correlationId') correlationId: string) {
    const found = await this.executions.byCorrelation(principal, correlationId);
    const matching = found.executions.filter((execution) => execution.defName === name);
    return Promise.all(matching.map((execution) => this.workflowJson(principal, execution.workflowId, false)));
  }

  @Put('workflow/:workflowId/pause')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @ApiRoute({ summary: 'Pause an execution (Conductor)', tags: ['conductor'] })
  async pause(@CurrentPrincipal() principal: Principal, @Param('workflowId') workflowId: string) {
    await this.executions.pause(principal, workflowId);
    return {};
  }

  @Put('workflow/:workflowId/resume')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @ApiRoute({ summary: 'Resume an execution (Conductor)', tags: ['conductor'] })
  async resume(@CurrentPrincipal() principal: Principal, @Param('workflowId') workflowId: string) {
    await this.executions.resume(principal, workflowId);
    return {};
  }

  @Post('workflow/:workflowId/retry')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @ApiRoute({ summary: 'Retry the failed tasks of an execution (Conductor)', tags: ['conductor'] })
  async retry(@CurrentPrincipal() principal: Principal, @Param('workflowId') workflowId: string) {
    await this.executions.retry(principal, workflowId);
    return {};
  }

  /** Conductor's restart re-runs from the beginning; ours starts a fresh run with the same input. */
  @Post('workflow/:workflowId/restart')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_START)
  @ApiRoute({ summary: 'Restart an execution (Conductor)', tags: ['conductor'] })
  async restart(@CurrentPrincipal() principal: Principal, @Param('workflowId') workflowId: string, @Res() reply: ReplyLike) {
    const started = await this.executions.runAgain(principal, workflowId);
    text(reply, started.workflowId);
  }

  @Post('workflow/:workflowId/rerun')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @ApiRoute({ summary: 'Re-run an execution from a task (Conductor)', tags: ['conductor'] })
  async rerun(@CurrentPrincipal() principal: Principal, @Param('workflowId') workflowId: string, @Body() body: unknown, @Res() reply: ReplyLike) {
    const request = (body ?? {}) as { reRunFromTaskId?: string; taskInput?: Record<string, unknown> };
    const task = request.reRunFromTaskId ? await this.workflows.findTaskById(workflowId, request.reRunFromTaskId) : undefined;
    if (request.reRunFromTaskId && !task) throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no task ${request.reRunFromTaskId}` });
    await this.executions.rerun(principal, workflowId, { fromTaskRef: task?.refName } as never);
    text(reply, workflowId);
  }

  @Delete('workflow/:workflowId')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @ApiRoute({ summary: 'Terminate an execution (Conductor)', tags: ['conductor'] })
  async terminate(@CurrentPrincipal() principal: Principal, @Param('workflowId') workflowId: string, @Query('reason') reason?: string) {
    await this.executions.terminate(principal, workflowId, { reason: reason ?? 'terminated through the Conductor API' } as never);
    return {};
  }

  @Get('workflow/search')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Search executions (Conductor)', tags: ['conductor'] })
  async search(
    @CurrentPrincipal() principal: Principal,
    @Query('query') query?: string,
    @Query('freeText') freeText?: string,
    @Query('size') size?: string,
    @Query('start') start?: string
  ) {
    const filters = conductorQuery(query);
    const found = await this.executions.searchExecutions(principal, {
      ...filters,
      ...(freeText && freeText !== '*' ? { q: freeText } : {}),
      limit: Math.min(Number(size ?? 20) || 20, 200),
    } as never);
    // Conductor pages by offset; ours is cursor-based, so an offset beyond the
    // first page is honoured by slicing rather than pretending to seek.
    const offset = Number(start ?? 0) || 0;
    const results = await Promise.all(found.executions.slice(offset).map((execution) => this.workflowJson(principal, execution.workflowId, false)));
    return { results, totalHits: results.length + offset };
  }

  // ----------------------------------------------------------------- tasks

  @Get('tasks/poll/:taskType')
  @RequireScopes(Scope.TASKS_REPORT)
  @ApiRoute({ summary: 'Poll for one task (Conductor)', tags: ['conductor'] })
  async poll(
    @CurrentPrincipal() principal: Principal,
    @Param('taskType') taskType: string,
    @Res() reply: ReplyLike,
    @Query('workerid') workerId?: string,
    @Query('domain') domain?: string
  ) {
    const tasks = await this.leaseTasks(principal, taskType, { workerId, domain, count: 1, timeoutMs: 0 });
    if (tasks.length === 0) {
      reply.status(204);
      reply.send();
      return;
    }
    reply.status(200);
    reply.send(tasks[0]);
  }

  @Get('tasks/poll/batch/:taskType')
  @RequireScopes(Scope.TASKS_REPORT)
  @ApiRoute({ summary: 'Poll for a batch of tasks (Conductor)', tags: ['conductor'] })
  async pollBatch(
    @CurrentPrincipal() principal: Principal,
    @Param('taskType') taskType: string,
    @Query('workerid') workerId?: string,
    @Query('domain') domain?: string,
    @Query('count') count?: string,
    @Query('timeout') timeout?: string
  ) {
    return this.leaseTasks(principal, taskType, {
      workerId,
      domain,
      count: Math.min(Number(count ?? 1) || 1, 100),
      timeoutMs: Number(timeout ?? 100) || 0,
    });
  }

  /** `POST /tasks` — a `TaskResult`. Conductor answers with the task id as text. */
  @Post('tasks')
  @HttpCode(200)
  @RequireScopes(Scope.TASKS_REPORT)
  @ApiRoute({ summary: 'Report a task result (Conductor)', tags: ['conductor'], body: taskResultSchema })
  async updateTask(@CurrentPrincipal() principal: Principal, @Body() body: unknown, @Res() reply: ReplyLike) {
    const result = taskResultSchema.parse(body);
    await this.applyResult(principal, result);
    text(reply, result.taskId);
  }

  /** `POST /tasks/{workflowId}/{taskRefName}/{status}` — update by reference. */
  @Post('tasks/:workflowId/:taskRefName/:status')
  @HttpCode(200)
  @RequireScopes(Scope.TASKS_REPORT)
  @ApiRoute({ summary: 'Report a task result by reference (Conductor)', tags: ['conductor'] })
  async updateByRef(
    @CurrentPrincipal() principal: Principal,
    @Param('workflowId') workflowId: string,
    @Param('taskRefName') taskRefName: string,
    @Param('status') status: string,
    @Body() output: unknown,
    @Res() reply: ReplyLike,
    @Query('workerid') workerId?: string
  ) {
    const task = await this.workflows.findTaskByRef(workflowId, taskRefName);
    if (!task) throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no task "${taskRefName}" in ${workflowId}` });
    await this.applyResult(principal, {
      workflowInstanceId: workflowId,
      taskId: task.id,
      status,
      outputData: (output ?? {}) as Record<string, unknown>,
      workerId,
    });
    text(reply, task.id);
  }

  @Get('tasks/:taskId')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Fetch a task (Conductor)', tags: ['conductor'] })
  async getTask(@CurrentPrincipal() principal: Principal, @Param('taskId') taskId: string) {
    const found = await this.workflows.findTaskInNamespace(principal.namespaceId, taskId);
    if (!found) throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no task ${taskId}` });
    const execution = await this.executions.get(principal, found.workflowId);
    const task = execution.tasks.find((t) => t.id === taskId);
    return task ? taskJson(task, execution) : undefined;
  }

  @Post('tasks/:taskId/log')
  @HttpCode(200)
  @RequireScopes(Scope.TASKS_REPORT)
  @ApiRoute({ summary: 'Append a log line to a task (Conductor)', tags: ['conductor'] })
  async log(@CurrentPrincipal() principal: Principal, @Param('taskId') taskId: string, @Body() body: unknown) {
    const message = typeof body === 'string' ? body : JSON.stringify(body);
    const task = await this.workflows.findTaskInNamespace(principal.namespaceId, taskId);
    if (!task?.leaseToken) throw new NodeFlowError(ErrorCode.LEASE_EXPIRED, `logs for task ${taskId} were refused: its lease is not held`);
    await this.logs.append({
      namespaceId: principal.namespaceId,
      workflowId: task.workflowId,
      taskId,
      leaseToken: task.leaseToken,
      entries: [{ message: message.slice(0, 64_000) }],
    });
    return {};
  }

  @Get('tasks/queue/sizes')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Queue depths by task type (Conductor)', tags: ['conductor'] })
  async queueSizes(@CurrentPrincipal() principal: Principal, @Query('taskType') taskType?: string | string[]) {
    const names = (Array.isArray(taskType) ? taskType : taskType ? [taskType] : []).filter(Boolean);
    // Conductor's "size" is work waiting to be picked up, not work in flight.
    const depths = await Promise.all(names.map(async (name) => [name, await this.queues.depth(name, principal.namespaceId)] as const));
    return Object.fromEntries(depths.map(([name, depth]) => [name, depth.available + depth.delayed]));
  }

  // --------------------------------------------------------------- helpers

  /** Leases through the same path `/v1` workers use, then shapes each task as Conductor's. */
  private async leaseTasks(
    principal: Principal,
    taskType: string,
    options: { workerId?: string; domain?: string; count: number; timeoutMs: number }
  ): Promise<Record<string, JsonValue>[]> {
    const queue = queueNameFor(taskType, options.domain);
    // The same queue-scoped permission the `/v1` lease requires.
    if (!hasScope(principal, queueScope(queue)) && !hasScope(principal, Scope.ADMIN)) {
      throw new ForbiddenException({ error: 'forbidden', message: `this credential may not lease from "${queue}"` });
    }
    const leased = await this.queue.lease(principal, queue, {
      workerId: options.workerId ?? 'conductor-worker',
      count: options.count,
      waitSeconds: Math.ceil(options.timeoutMs / 1000),
    } as never);

    const out: Record<string, JsonValue>[] = [];
    for (const task of leased.tasks) {
      const row = await this.workflows.findTaskById(task.workflowId, task.taskId);
      const execution = await this.workflows.findById(task.workflowId);
      if (!row || !execution) continue;
      out.push(
        taskJson(
          { ...row, id: row.id, input: task.input, status: TaskStatus.IN_PROGRESS, workerId: options.workerId },
          { id: execution.id, defName: execution.defName, defVersion: execution.defVersion, correlationId: execution.correlationId }
        )
      );
    }
    return out;
  }

  /**
   * Applies a `TaskResult`.
   *
   * The lease token comes from the task row, since Conductor's result has none.
   * A worker whose id no longer matches the row is refused: the weaker of the
   * two guarantees, and the one Conductor itself offers.
   */
  private async applyResult(principal: Principal, result: z.infer<typeof taskResultSchema>): Promise<void> {
    const task = await this.workflows.findTaskById(result.workflowInstanceId, result.taskId);
    if (!task) throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no task ${result.taskId} in ${result.workflowInstanceId}` });
    if (!task.leaseToken) throw new NodeFlowError(ErrorCode.LEASE_EXPIRED, `task ${result.taskId} is not leased; its result was refused`);
    if (result.workerId && task.workerId && result.workerId !== task.workerId) {
      throw new NodeFlowError(ErrorCode.LEASE_EXPIRED, `task ${result.taskId} is held by another worker; its result was refused`);
    }
    const queueName = queueNameFor(task.taskDefName, task.domain);

    for (const line of result.logs ?? []) {
      await this.logs
        .append({ namespaceId: principal.namespaceId, workflowId: task.workflowId, taskId: task.id, leaseToken: task.leaseToken, entries: [{ message: line.log.slice(0, 64_000) }] })
        .catch(() => undefined);
    }

    const status = REPORTED_STATUS[result.status.toUpperCase()];
    if (!status) {
      // IN_PROGRESS with a callback is Conductor's "still working"; ours is a lease extension.
      if (result.status.toUpperCase() === 'IN_PROGRESS') {
        await this.dispatch.heartbeat(queueName, task.id, task.leaseToken, Math.max(result.callbackAfterSeconds ?? 60, 60));
        return;
      }
      throw new NodeFlowError(ErrorCode.INVALID_ARGUMENT, `a worker may not report "${result.status}"`);
    }

    const accepted = await this.dispatch.report({
      namespaceId: principal.namespaceId,
      queueName,
      workflowId: task.workflowId,
      taskId: task.id,
      leaseToken: task.leaseToken,
      status,
      output: result.outputData as Record<string, JsonValue> | undefined,
      reason: result.reasonForIncompletion,
    });
    if (!accepted) throw new NodeFlowError(ErrorCode.LEASE_EXPIRED, `result for task ${result.taskId} was refused: the lease is no longer held`);
  }

  /**
   * A definition in Conductor's shape, which is not quite ours.
   *
   * `failureWorkflow` is the difference that matters. Conductor's SDK
   * initialises it to `""` and sends it on every registration; Conductor's
   * server stores that and hands it back unchanged. We take `""` to mean "no
   * failure workflow" — which is what it means — and store it as absent, so
   * without this the field would go in as `""` and come back missing.
   *
   * That asymmetry is not cosmetic. Deployment tooling diffs what it would
   * register against what the server holds, and `"" !== undefined`, so *every*
   * workflow reads as changed on *every* run. A sixty-workflow project then
   * re-registers all sixty and fails on the first one, because versions here
   * are immutable. Found exactly that way.
   *
   * So the echo happens here, in the translation layer, and not by storing an
   * empty name: the `/v1` API keeps the honest shape, and Conductor's clients
   * get the shape they diff against.
   */
  private async definitionOf(principal: Principal, name: string, version?: number) {
    const definition = await this.metadata.getWorkflow(
      principal,
      name,
      version ? String(version) : undefined
    );

    return { failureWorkflow: '', ...definition };
  }

  /** An execution in Conductor's `Workflow` shape. */
  private async workflowJson(principal: Principal, workflowId: string, includeTasks = true): Promise<Record<string, JsonValue>> {
    const execution = await this.executions.get(principal, workflowId);
    return {
      workflowId: execution.id,
      parentWorkflowId: (execution.parentWorkflowId ?? null) as JsonValue,
      status: execution.status,
      workflowName: execution.defName,
      workflowVersion: execution.defVersion,
      correlationId: (execution.correlationId ?? null) as JsonValue,
      input: (execution.input ?? {}) as JsonValue,
      output: (execution.output ?? {}) as JsonValue,
      variables: (execution.variables ?? {}) as JsonValue,
      reasonForIncompletion: (execution.reasonForIncompletion ?? null) as JsonValue,
      priority: execution.priority ?? 0,
      createTime: epoch(execution.startedAt),
      startTime: epoch(execution.startedAt),
      endTime: epoch(execution.endedAt),
      updateTime: epoch(execution.updatedAt ?? execution.startedAt),
      tasks: includeTasks ? (execution.tasks.map((task) => taskJson(task, execution)) as JsonValue) : [],
    };
  }
}

function unauthorised(): UnauthorizedException {
  // One message for every failure mode, as /v1/auth/token does: distinguishing
  // "no such key" from "wrong secret" is a key-enumeration oracle.
  return new UnauthorizedException({ error: 'invalid_credentials', message: 'unknown key or incorrect secret' });
}

/**
 * The equality clauses of a Conductor search query.
 *
 * `workflowType='checkout' AND status IN (FAILED,TIMED_OUT)` and the same forms
 * with `"` or no quotes are translated. Anything else is ignored: returning a
 * different result set than the caller asked for is worse than ignoring the
 * filter, because it looks like an answer.
 */
export function conductorQuery(query?: string): { defName?: string; status?: string[]; correlationId?: string } {
  if (!query) return {};
  const out: { defName?: string; status?: string[]; correlationId?: string } = {};
  const value = (raw: string) => raw.trim().replace(/^['"]|['"]$/g, '');

  const name = /workflowType\s*=\s*('[^']*'|"[^"]*"|[\w.-]+)/i.exec(query);
  if (name) out.defName = value(name[1]);
  const correlation = /correlationId\s*=\s*('[^']*'|"[^"]*"|[\w.-]+)/i.exec(query);
  if (correlation) out.correlationId = value(correlation[1]);

  const statusIn = /status\s+IN\s*\(([^)]*)\)/i.exec(query);
  const statusEq = /status\s*=\s*('[^']*'|"[^"]*"|[\w]+)/i.exec(query);
  const statuses = statusIn ? statusIn[1].split(',').map(value) : statusEq ? [value(statusEq[1])] : [];
  const known = statuses.map((s) => s.toUpperCase()).filter((s) => (Object.values(WorkflowStatus) as string[]).includes(s));
  if (known.length) out.status = known;

  return out;
}

/** A task in Conductor's `Task` shape. */
function taskJson(task: Record<string, unknown>, execution: { id: string; defName: string; defVersion: number; correlationId?: string | null }): Record<string, JsonValue> {
  return {
    taskId: task['id'] as string,
    // Conductor's `taskType` is what a worker polls for: the task's name for a
    // worker task, and the system type (HTTP, INLINE) otherwise.
    taskType: (task['taskType'] === 'SIMPLE' ? task['taskDefName'] : task['taskType']) as string,
    taskDefName: task['taskDefName'] as string,
    referenceTaskName: task['refName'] as string,
    status: task['status'] as string,
    retryCount: (task['attempt'] as number) ?? 0,
    iteration: (task['iteration'] as number) ?? 0,
    seq: ((task['iteration'] as number) ?? 0) + 1,
    inputData: (task['input'] ?? {}) as JsonValue,
    outputData: (task['output'] ?? {}) as JsonValue,
    reasonForIncompletion: (task['reasonForIncompletion'] ?? null) as JsonValue,
    workerId: (task['workerId'] ?? null) as JsonValue,
    domain: (task['domain'] ?? null) as JsonValue,
    workflowInstanceId: execution.id,
    workflowType: execution.defName,
    workflowVersion: execution.defVersion,
    correlationId: (execution.correlationId ?? null) as JsonValue,
    scheduledTime: epoch(task['scheduledAt']),
    startTime: epoch(task['startedAt']),
    endTime: epoch(task['endedAt']),
    updateTime: epoch(task['endedAt'] ?? task['startedAt'] ?? task['scheduledAt']),
    callbackAfterSeconds: 0,
    pollCount: task['startedAt'] ? 1 : 0,
    retried: ((task['attempt'] as number) ?? 0) > 0,
    executed: Boolean(task['endedAt']),
  };
}

@Module({ controllers: [ConductorController] })
export class ConductorModule {}

/**
 * Whether a stored definition and a freshly parsed one describe the same thing.
 *
 * Compared on the fields a registration actually sets, with both sides having
 * been through the same schema — so applied defaults, key order and anything
 * the wire format spells differently cannot make two equal definitions look
 * different. Server-managed fields (timestamps, the registering principal) are
 * not part of the definition and are not compared.
 */
function sameDefinition(stored: unknown, incoming: unknown): boolean {
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key, entry]) => entry !== undefined && !SERVER_MANAGED_FIELDS.has(key))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, normalise(entry)])
      );
    }
    return value;
  };

  const storedChecked = checkDefinition(stored);
  if (!storedChecked.valid) return false;

  return JSON.stringify(normalise(storedChecked.definition)) === JSON.stringify(normalise(incoming));
}

/** Set by the server on write; never part of what a caller registers. */
const SERVER_MANAGED_FIELDS = new Set(['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'namespaceId']);
