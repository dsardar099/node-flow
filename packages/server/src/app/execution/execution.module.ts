import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ErrorCode,
  InvalidArgumentError,
  NodeFlowError,
  Scope,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  isTaskTerminal,
  isWorkflowTerminal,
  maskFields,
  type JsonValue,
  type Principal,
  type ResourceAccess,
} from '@node-flow-dev/core';
import {
  ConcurrencyRepository,
  DecideQueueRepository,
  EnvironmentRepository,
  ExecutionControlService,
  MetadataRepository,
  PayloadStore,
  SchemaRegistryRepository,
  SchemaValidator,
  SearchRepository,
  parseExecutionQuery,
  TaskLogRepository,
  WorkflowEventNotifier,
  WorkflowEventsRepository,
  WorkflowMessageRepository,
  QuotaService,
  WorkflowRepository,
  currentTraceparent,
} from '@node-flow-dev/store';
import { replay } from '@node-flow-dev/testkit';
import { z } from 'zod';
import { AllowResourceGrant, CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { EXECUTION_SCOPES, accessPolicy, mayUse } from '../common/access-policy.js';

/** Starting a run: `executions:start`, or an EXECUTE grant on the workflow. */
const START_SCOPES = { ...EXECUTION_SCOPES, EXECUTE: Scope.EXECUTIONS_START };
import { ApiRoute } from '../openapi/api-route.decorator.js';
import { zodBody } from '../common/zod.pipe.js';

/**
 * Starting executions, reading them, and operating on them.
 *
 * The operator actions — pause, resume, terminate, retry, rerun, skip — are
 * thin delegations to `ExecutionControlService`, which holds the workflow row
 * lock for each. That placement is deliberate: the same operations run from the
 * CLI and from the UI, and a rule enforced in a controller is a rule the next
 * caller bypasses.
 */

const jsonObject = z.record(z.string(), z.unknown()).default({});

const startSchema = z.object({
  version: z.number().int().positive().optional(),
  input: jsonObject,
  /**
   * Routes this run's worker tasks to domains — `{ "charge": "eu-west", "*": "canary" }`.
   * A task's own name wins over `*`, and both win over the domain in the definition.
   */
  taskToDomain: z
    .record(z.string().regex(/^(\*|[A-Za-z0-9_.-]{1,200})$/, 'a key is a task definition name or *'), z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/, 'a domain is letters, digits, ".", "_" or "-"'))
    .refine((value) => Object.keys(value).length <= 100, 'at most 100 routes')
    .optional(),
  correlationId: z.string().max(255).optional(),
  /**
   * Deduplicates retried submissions. The window is the lifetime of the key
   * row, not a time bound — a duplicate start is a duplicate whenever it lands.
   */
  idempotencyKey: z.string().min(1).max(255).optional(),
  /**
   * What a repeated key means: return the existing execution (default), refuse
   * with 409, or refuse only while the existing execution is still running.
   */
  idempotencyStrategy: z.enum(['RETURN_EXISTING', 'FAIL', 'FAIL_ON_RUNNING']).optional(),
  priority: z.number().int().min(0).max(99).optional(),
  variables: jsonObject,
});

const executeSchema = startSchema.extend({
  waitForSeconds: z.number().min(0).max(60).default(10),
  waitUntilTaskRef: z.string().min(1).optional(),
});

const signalSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED']).default('COMPLETED'),
  output: jsonObject,
  reason: z.string().max(2000).optional(),
  taskRef: z.string().min(1).optional(),
  waitForSeconds: z.number().min(0).max(60).optional(),
});

const BULK_ACTIONS = ['pause', 'resume', 'retry', 'terminate'] as const;

const bulkSchema = z.object({
  workflowIds: z.array(z.string()).min(1).max(1000),
  reason: z.string().max(1000).optional(),
});

const searchSchema = z.object({
  status: z
    .array(
      z.enum([
        WorkflowStatus.RUNNING,
        WorkflowStatus.PAUSED,
        WorkflowStatus.COMPLETED,
        WorkflowStatus.FAILED,
        WorkflowStatus.TIMED_OUT,
        WorkflowStatus.TERMINATED,
      ])
    )
    .max(10)
    .optional(),
  defName: z.string().max(255).optional(),
  defVersion: z.number().int().positive().optional(),
  correlationId: z.string().max(255).optional(),
  // A malformed id is simply no match, not a 400: this is what a person pastes.
  workflowId: z.string().max(64).optional(),
  idempotencyKey: z.string().max(255).optional(),
  excludeSubWorkflows: z.boolean().optional(),
  startedAfter: z.iso.datetime().optional(),
  startedBefore: z.iso.datetime().optional(),
  finished: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  /** Opaque; comes from a previous page's `nextCursor`. */
  cursor: z.string().max(512).optional(),
  /**
   * The search box: `status:FAILED workflow:checkout_* input.customer.tier:gold card declined`.
   * Combined with the fields above; where both set the same filter, the field wins.
   */
  q: z.string().max(1000).optional(),
});

/** Matches no execution: ids are UUIDv7 and never all zeros. */
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const messageSchema = z.object({ payload: z.record(z.string(), z.unknown()) });

const reasonSchema = z.object({ reason: z.string().max(1000).default('operator request') });
const rerunSchema = z.object({ fromTaskRef: z.string().min(1) });
const skipSchema = z.object({ taskRef: z.string().min(1) });
const cancelTaskSchema = z.object({ taskRef: z.string().min(1) });
const rerunTasksSchema = z.object({
  taskRefs: z.array(z.string().min(1)).min(1).max(200),
  /**
   * Re-run everything that depended on these too.
   *
   * Off by default, which is the narrower and more surprising of the two, so it
   * is the one that has to be asked for. With it off the response says which
   * tasks are now holding outputs derived from a run that no longer exists —
   * silence there would make a corrupted execution look like a clean one.
   */
  cascade: z.boolean().optional(),
});

@Controller('ns/:ns/executions')
export class ExecutionController {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly metadata: MetadataRepository,
    private readonly decideQueue: DecideQueueRepository,
    private readonly control: ExecutionControlService,
    private readonly events: WorkflowEventsRepository,
    private readonly concurrency: ConcurrencyRepository,
    private readonly quotas: QuotaService,
    private readonly payloads: PayloadStore,
    private readonly search: SearchRepository,
    private readonly logs: TaskLogRepository,
    private readonly registry: SchemaRegistryRepository,
    private readonly validator: SchemaValidator,
    private readonly notifier: WorkflowEventNotifier,
    private readonly messages: WorkflowMessageRepository,
    private readonly environment: EnvironmentRepository
  ) {}

  /**
   * Searches executions.
   *
   * `POST` for a read, deliberately. The filter set is a structured object, and
   * encoding it into a query string means inventing an escaping scheme every
   * client then has to reimplement — the exact problem Conductor's
   * query-string DSL has. A body keeps it typed and keeps correlation ids and
   * workflow names out of access logs.
   */
  @Post('search')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @HttpCode(200)
  @ApiRoute({
    summary: 'Search executions, newest first',
    description:
      'Keyset pagination: pass the previous page’s `nextCursor` as `cursor`. ' +
      'Offset paging would skip and duplicate rows, because this table receives ' +
      'continuous inserts.',
    tags: ['executions'],
    body: searchSchema,
  })
  async searchExecutions(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(searchSchema)) body: z.infer<typeof searchSchema>
  ) {
    const hidden = await this.hiddenWorkflows(principal);
    // Parsed before anything is read: a mistyped key is a 400 naming the keys
    // there are, not an empty list that looks like "no such executions".
    const parsed = body.q ? parseExecutionQuery(body.q) : {};
    const workflowId = body.workflowId ?? parsed.workflowId;
    const result = await this.search.executions({
      // From the credential, never the body — a caller-supplied namespace here
      // would be a cross-tenant read.
      namespaceId: principal.namespaceId,
      excludeDefNames: hidden,
      status: body.status ?? parsed.status,
      defName: body.defName ?? parsed.defName,
      defNamePrefix: body.defName ? undefined : parsed.defNamePrefix,
      defVersion: body.defVersion ?? parsed.defVersion,
      correlationId: body.correlationId ?? parsed.correlationId,
      // An id that is not a UUID cannot match, and handing it to Postgres
      // would be a cast error rather than an empty result.
      workflowId: workflowId === undefined ? undefined : isUuid(workflowId) ? workflowId : ZERO_UUID,
      idempotencyKey: body.idempotencyKey ?? parsed.idempotencyKey,
      excludeSubWorkflows: body.excludeSubWorkflows ?? parsed.subWorkflows === 'exclude',
      onlySubWorkflows: parsed.subWorkflows === 'only',
      reason: parsed.reason,
      contains: parsed.contains,
      text: parsed.text,
      startedAfter: body.startedAfter ? new Date(body.startedAfter) : undefined,
      startedBefore: body.startedBefore ? new Date(body.startedBefore) : undefined,
      finished: body.finished ?? parsed.finished,
      limit: body.limit,
      cursor: body.cursor,
    });

    return {
      executions: result.executions.map((execution) => ({
        workflowId: execution.id,
        defName: execution.defName,
        defVersion: execution.defVersion,
        status: execution.status,
        correlationId: execution.correlationId,
        parentWorkflowId: execution.parentWorkflowId,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        reasonForIncompletion: execution.reasonForIncompletion,
        idempotencyKey: execution.idempotencyKey,
        awaitingAdmission: execution.awaitingAdmission || undefined,
      })),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * Executions for a correlation id.
   *
   * The question asked from outside the orchestrator — "what happened to order
   * 12345?" — by a caller that never kept the workflow id.
   */
  /**
   * Pushes a message into a running execution.
   *
   * Delivered to a waiting `PULL_WORKFLOW_MESSAGES` task straight away, or kept
   * in order until one asks. Refused once the execution has finished — nothing
   * would ever read it.
   */
  @Post(':id/messages')
  @HttpCode(202)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @ApiRoute({ summary: 'Push a message into a running execution', tags: ['executions'], body: messageSchema })
  async pushMessage(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(messageSchema)) body: z.infer<typeof messageSchema>
  ) {
    await this.load(principal, id, 'EXECUTE');
    return this.messages.push(principal.namespaceId, id, body.payload as Record<string, JsonValue>);
  }

  /** Messages pushed into an execution, oldest first, and which task took each. */
  @Get(':id/messages')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({ summary: 'Messages pushed into an execution', tags: ['executions'] })
  async listMessages(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const execution = await this.load(principal, id);
    const mask = await this.maskFor(execution);
    const messages = await this.messages.list(id);
    return { messages: messages.map((message) => ({ ...message, payload: mask(message.payload) })) };
  }

  /** Counts, throughput, durations and failure hotspots over a recent window — the overview page. */
  @Get('overview')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({
    summary: 'Execution overview for a recent window',
    tags: ['executions'],
    query: z.object({ hours: z.coerce.number().int().min(1).max(168).optional() }),
  })
  async overview(@CurrentPrincipal() principal: Principal, @Query('hours') hours?: string) {
    const window = Math.min(Math.max(Number(hours) || 24, 1), 168);
    return this.search.overview(principal.namespaceId, {
      hours: window,
      excludeDefNames: await this.hiddenWorkflows(principal),
    });
  }

  @Get('by-correlation/:correlationId')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({ summary: 'Find executions by correlation id', tags: ['executions'] })
  async byCorrelation(
    @CurrentPrincipal() principal: Principal,
    @Param('correlationId') correlationId: string
  ) {
    const hidden = new Set(await this.hiddenWorkflows(principal));
    const executions = (await this.search.byCorrelationId(principal.namespaceId, correlationId)).filter(
      (execution) => !hidden.has(execution.defName)
    );

    return {
      executions: executions.map((execution) => ({
        workflowId: execution.id,
        defName: execution.defName,
        status: execution.status,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
      })),
    };
  }

  /**
   * Starts an execution.
   *
   * The admission check runs *before* the row is created. Admitting a workflow
   * and then stalling every one of its tasks against a concurrency cap looks
   * identical to a broken worker pool from the outside; rejecting the start
   * says exactly what happened.
   */
  @Post(':name')
  @RequireScopes(Scope.EXECUTIONS_START)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @ApiRoute({
    summary: 'Start a workflow execution',
    description:
      'Admission control runs before the row is created, so a workflow at its ' +
      'concurrency limit is refused rather than admitted and stalled.',
    tags: ['executions'],
    body: startSchema,
  })
  async start(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(startSchema)) body: z.infer<typeof startSchema>
  ) {
    const execution = await this.startExecution(principal, name, body);
    return {
      workflowId: execution.id,
      status: execution.status,
      defName: execution.defName,
      defVersion: execution.defVersion,
      startedAt: execution.startedAt,
      awaitingAdmission: execution.awaitingAdmission || undefined,
    };
  }

  /**
   * Starts an execution and waits for its outcome — or for one task — before
   * answering.
   *
   * For callers that want a result, not a receipt: an HTTP API fronting a
   * short workflow, a test. Bounded: after `waitForSeconds` it answers with the
   * state so far and `reached: false`, and the execution carries on — a caller
   * that stopped waiting has not cancelled anything.
   */
  @Post(':name/execute')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_START)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @ApiRoute({
    summary: 'Start a workflow and wait for its result',
    description:
      'Waits up to `waitForSeconds` (default 10, max 60) for the execution to finish, or for ' +
      '`waitUntilTaskRef` to finish. Answers `reached: false` with the state so far on timeout; ' +
      'the execution continues either way.',
    tags: ['executions'],
    body: executeSchema,
  })
  async execute(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(executeSchema)) body: z.infer<typeof executeSchema>
  ) {
    const execution = await this.startExecution(principal, name, body);
    return this.awaitOutcome(execution.id, body.waitForSeconds, body.waitUntilTaskRef);
  }

  /**
   * Completes the task a workflow is blocked on — a WAIT — without knowing
   * its id, looking into running sub-workflows when the parent is only waiting
   * on a child.
   *
   * What an external system uses to say "the thing you were waiting for
   * happened". With `waitForSeconds`, answers with where that got the workflow.
   */
  @Post(':id/signal')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @ApiRoute({
    summary: 'Resume the WAIT or YIELD task a workflow is blocked on',
    description:
      'Targets `taskRef` when given, otherwise the first blocked WAIT or YIELD task, searching running ' +
      'sub-workflows too. Set `waitForSeconds` to answer with the resulting state.',
    tags: ['executions'],
    body: signalSchema,
  })
  async signal(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(signalSchema)) body: z.infer<typeof signalSchema>
  ) {
    await this.load(principal, id, 'EXECUTE');
    const target = await this.findBlockedTask(id, body.taskRef, 0);
    if (!target) {
      throw new NodeFlowError(
        ErrorCode.CONFLICT,
        body.taskRef
          ? `task "${body.taskRef}" is not waiting in execution ${id}`
          : `execution ${id} is not blocked on a WAIT task`
      );
    }

    const completed = await this.workflows.completeTask(
      target.workflowId,
      target.taskId,
      body.status === 'FAILED' ? TaskStatus.FAILED : TaskStatus.COMPLETED,
      (body.output ?? {}) as Record<string, JsonValue>,
      body.status === 'FAILED' ? (body.reason ?? 'failed by signal') : undefined,
      undefined
    );
    if (!completed) throw new NodeFlowError(ErrorCode.CONFLICT, 'the task finished while the signal was on its way');
    await this.decideQueue.enqueue(principal.namespaceId, target.workflowId, 'signal');

    const signalled = { workflowId: target.workflowId, taskRef: target.refName };
    if (!body.waitForSeconds) return { signalled };
    return { signalled, ...(await this.awaitOutcome(id, body.waitForSeconds)) };
  }

  /** The first WAIT task still open in this execution, or in a running child of it. */
  private async findBlockedTask(
    workflowId: string,
    taskRef: string | undefined,
    depth: number
  ): Promise<{ workflowId: string; taskId: string; refName: string } | undefined> {
    const { tasks } = await this.workflows.loadAllTasks(workflowId);
    const open = tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.SCHEDULED);
    const match = taskRef
      ? open.find((t) => t.refName === taskRef)
      : // WAIT and YIELD are the two tasks that exist to be resumed by a signal.
        open.find((t) => t.taskType === TaskType.WAIT || t.taskType === TaskType.YIELD);
    if (match) return { workflowId, taskId: match.id, refName: match.refName };
    if (depth >= 5) return undefined;

    for (const childId of await this.workflows.runningChildren(workflowId)) {
      const found = await this.findBlockedTask(childId, taskRef, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Waits for an execution (or one of its tasks) to finish.
   *
   * Woken by the workflow event notifier, with a one-second poll as the
   * backstop for a missed or collapsed notification.
   */
  private async awaitOutcome(workflowId: string, waitForSeconds = 10, untilTaskRef?: string) {
    const deadline = Date.now() + Math.min(Math.max(waitForSeconds, 0), 60) * 1000;
    const started = Date.now();

    const check = async () => {
      const execution = await this.workflows.findById(workflowId);
      if (!execution) return undefined;
      const { tasks } = untilTaskRef ? await this.workflows.loadAllTasks(workflowId) : { tasks: [] };
      const task = untilTaskRef
        ? [...tasks].reverse().find((t) => t.refName === untilTaskRef && isTaskTerminal(t.status))
        : undefined;
      const reached = untilTaskRef ? Boolean(task) || isWorkflowTerminal(execution.status) : isWorkflowTerminal(execution.status);
      return { execution, task, reached };
    };

    let state = await check();
    while (state && !state.reached && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.min(1000, Math.max(0, deadline - Date.now())));
        const unsubscribe = this.notifier.subscribe(workflowId, done);
        function done() {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
      state = await check();
    }
    if (!state) throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no execution ${workflowId}` });
    const mask = await this.maskFor(state.execution);

    return {
      workflowId,
      reached: state.reached,
      status: state.execution.status,
      output: isWorkflowTerminal(state.execution.status) ? mask(await this.payloads.resolve(state.execution.output)) : undefined,
      reasonForIncompletion: state.execution.reasonForIncompletion,
      ...(state.task
        ? {
            task: {
              refName: state.task.refName,
              status: state.task.status,
              output: mask(await this.payloads.resolve(state.task.output)),
            },
          }
        : {}),
      waitedMs: Date.now() - started,
    };
  }

  private async startExecution(
    principal: Principal,
    name: string,
    body: z.infer<typeof startSchema>
  ) {
    const version = body.version ?? (await this.metadata.latestVersion(principal.namespaceId, name));
    if (version === undefined) {
      throw new NotFoundException({
        error: ErrorCode.NOT_FOUND,
        message: `no workflow "${name}" is registered`,
      });
    }

    // Reading a definition you cannot reach is one thing; running it is
    // another, and starting is the more consequential of the two. Reported as
    // "not registered" rather than forbidden, so a caller cannot map which
    // workflows exist in a space they cannot see.
    const tags = await this.metadata.tagsOf(principal.namespaceId, name);
    if (!mayUse(principal, 'EXECUTE', { name, tags: tags ?? [] }, START_SCOPES)) {
      throw new NotFoundException({
        error: ErrorCode.NOT_FOUND,
        message: `no workflow "${name}" is registered`,
      });
    }

    // The definition's own inputSchema — accepted at registration and, until
    // now, never checked. Refused before anything is created, so a malformed
    // start is a 400 naming the field, not a run that fails three tasks later.
    const definition = await this.metadata.getWorkflowDefinition(
      principal.namespaceId,
      name,
      { tagGrants: [...(principal.tagGrants ?? []), ...principal.scopes] },
      version
    );
    if (definition?.inputSchema) {
      const schema = await this.registry.resolve(principal.namespaceId, definition.inputSchema);
      const violations = this.validator.check(
        { name, inputSchema: schema as never },
        'input',
        (body.input ?? {}) as Record<string, JsonValue>
      );
      if (violations.length > 0) {
        throw new InvalidArgumentError(
          `input does not match workflow "${name}" inputSchema: ` +
            violations.map((v) => `${v.path || '(root)'} ${v.message}`).join('; '),
          { violations }
        );
      }
    }

    const running = await this.concurrency.countRunningExecutions(principal.namespaceId, name);
    const allowed = await this.metadata.canStartAnother(
      principal.namespaceId,
      name,
      version,
      running
    );
    if (!allowed) {
      throw new NodeFlowError(
        ErrorCode.LIMIT_EXCEEDED,
        `workflow "${name}" is at its maxConcurrentExecutions limit`,
        { control: 'maxConcurrentExecutions', running }
      );
    }

    // Namespace quotas are checked in the same transaction as the insert, so
    // two concurrent starts cannot both see room for one more.
    const execution = await this.quotas.withStartQuota(principal.namespaceId, (tx) =>
      this.workflows.start(
        {
          namespaceId: principal.namespaceId,
          defName: name,
          defVersion: version,
          input: body.input as Record<string, JsonValue>,
          variables: body.variables as Record<string, JsonValue>,
          correlationId: body.correlationId,
          idempotencyKey: body.idempotencyKey,
          idempotencyStrategy: body.idempotencyStrategy,
          priority: body.priority,
          taskToDomain: body.taskToDomain,
          // The trace this run belongs to, from the request that asked for it.
          // Taken from the active span rather than the raw header so it is the
          // *server's* span the worker continues from, not the client's parent.
          traceparent: currentTraceparent(),
        },
        tx
      )
    );

    // Requested after the row exists, so a crash between the two leaves a
    // startable workflow rather than a wakeup for one that never existed. The
    // stuck-workflow sweeper is the backstop if this enqueue is what fails.
    await this.decideQueue.enqueue(principal.namespaceId, execution.id, 'started');
    return execution;
  }

  /** Status only — the cheap poll, with no payloads to resolve. */
  @Get(':id/status')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({ summary: 'Lightweight status, with no payloads resolved', tags: ['executions'] })
  async status(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const execution = await this.load(principal, id);

    return {
      workflowId: execution.id,
      status: execution.status,
      startedAt: execution.startedAt,
      updatedAt: execution.updatedAt,
      endedAt: execution.endedAt,
      reasonForIncompletion: execution.reasonForIncompletion,
      awaitingAdmission: execution.awaitingAdmission || undefined,
    };
  }

  @Get(':id')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({ summary: 'Full execution, including tasks and resolved payloads', tags: ['executions'] })
  async get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const execution = await this.load(principal, id);
    const { tasks, truncated } = await this.workflows.loadAllTasks(id);
    const mask = await this.maskFor(execution);

    return {
      ...execution,
      // Offloaded payloads are fetched for the API, unlike on the decision path
      // where only referenced ones are. A human reading an execution wants the
      // value, not a `fs:` ref they cannot dereference.
      input: mask(await this.payloads.resolve(execution.input)),
      output: mask(await this.payloads.resolve(execution.output)),
      variables: mask(execution.variables),
      tasks: await Promise.all(
        tasks.map(async (task) => ({
          ...task,
          input: mask(await this.payloads.resolve(task.input)),
          output: mask(await this.payloads.resolve(task.output)),
        }))
      ),
      // Surfaced rather than silently dropped: a partial task list that looks
      // complete is how someone concludes a task never ran.
      tasksTruncated: truncated,
    };
  }

  /** Log lines a worker wrote while running one task of this execution. */
  @Get(':id/tasks/:taskId/logs')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({
    summary: 'Log lines written by the worker that ran a task',
    tags: ['executions'],
    query: z.object({
      after: z.coerce.number().int().nonnegative().optional(),
      limit: z.coerce.number().int().positive().max(2000).optional(),
    }),
  })
  async taskLogs(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string
  ) {
    // Through the execution, so a task id alone never reads another tenant's
    // logs: `load` 404s an execution outside the caller's namespace.
    await this.load(principal, id);
    if (!isUuid(taskId)) return { logs: [] };
    return {
      logs: await this.logs.list(principal.namespaceId, taskId, {
        after: after === undefined ? undefined : Number(after),
        limit: limit === undefined ? undefined : Number(limit),
      }),
    };
  }

  /** The ordered history: what happened, in what order, and why. */
  @Get(':id/history')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({
    summary: 'Ordered execution history',
    description: 'What happened, in order, and why — including operator actions.',
    tags: ['executions'],
  })
  async history(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Query('limit') limit?: string
  ) {
    const execution = await this.load(principal, id);
    const mask = await this.maskFor(execution);
    const events = await this.events.history(id, z.coerce.number().int().positive().max(1000).parse(limit ?? 1000));
    // Events carry payloads too — a task.completed event holds the output.
    return events.map((event) => ({ ...event, payload: mask(event.payload) }));
  }

  /**
   * Runs this execution again through the engine, in memory, with every task's
   * recorded outcome standing in for the real call — and reports where the
   * replay differs from what happened.
   *
   * With no version, against the definition the run used: a divergence there
   * is a determinism bug. With another version, it previews how that change
   * would have treated this run. Nothing is called, persisted or published.
   */
  @Post(':id/replay')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({
    summary: 'Replay an execution against a definition version',
    tags: ['executions'],
    body: z.object({ version: z.number().int().positive().optional() }),
  })
  async replay(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(z.object({ version: z.number().int().positive().optional() }))) body: { version?: number }
  ) {
    const execution = await this.load(principal, id);
    const version = body.version ?? execution.defVersion;
    const definition = await this.metadata.getWorkflowDefinition(principal.namespaceId, execution.defName, accessPolicy(principal, EXECUTION_SCOPES), version);
    if (!definition) {
      throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no version ${version} of workflow "${execution.defName}"` });
    }
    const { tasks, truncated } = await this.workflows.loadAllTasks(id);
    const taskDefs = await this.metadata.loadTaskDefs(principal.namespaceId, [...new Set(tasks.map((t) => t.taskDefName))]);
    const mask = await this.maskFor(execution);
    const recordedTasks = await Promise.all(
      tasks.map(async (task) => ({
        refName: task.refName,
        taskType: task.taskType,
        status: task.status,
        attempt: task.attempt,
        iteration: task.iteration,
        input: (await this.payloads.resolve(task.input)) as Record<string, JsonValue>,
        output: (await this.payloads.resolve(task.output)) as Record<string, JsonValue> | undefined,
        reasonForIncompletion: task.reasonForIncompletion,
        scheduledAt: task.scheduledAt,
      }))
    );

    const result = await replay(
      definition,
      {
        status: execution.status,
        input: (await this.payloads.resolve(execution.input)) as Record<string, JsonValue>,
        output: isWorkflowTerminal(execution.status) ? ((await this.payloads.resolve(execution.output)) as Record<string, JsonValue>) : undefined,
        // The run's starting variables are the definition's; SET_VARIABLE is replayed.
        variables: undefined,
        tasks: recordedTasks,
      },
      { taskDefs: Object.fromEntries(taskDefs), env: await this.environment.load(principal.namespaceId), maxEvaluations: 5_000 }
    );

    return {
      workflowId: id,
      defName: execution.defName,
      recordedVersion: execution.defVersion,
      replayedVersion: version,
      // A run still going will naturally differ where it has not finished yet.
      complete: isWorkflowTerminal(execution.status) && !truncated,
      matches: result.matches,
      divergences: result.divergences.map((d) => ({ ...d, recorded: mask(d.recorded), replayed: mask(d.replayed) })),
      replay: {
        status: result.replay.status,
        output: mask(result.replay.output),
        tasks: result.replay.tasks.map((t) => ({ refName: t.refName, taskType: t.taskType, status: t.status, attempt: t.attempt, iteration: t.iteration })),
      },
    };
  }

  // ------------------------------------------------------------ operator actions

  /**
   * One operator action across many executions.
   *
   * Reports per execution rather than failing on the first error: in a bulk
   * terminate of forty runs, the three that had already finished are expected,
   * not a reason to abandon the other thirty-seven. Each execution is checked
   * against the caller's namespace exactly as the single-execution routes do.
   */
  @Post('bulk/:action')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(200)
  @ApiRoute({
    summary: 'Pause, resume, retry or terminate many executions',
    description: 'Up to 1000 ids. Answers which succeeded and why each of the rest did not.',
    tags: ['operations'],
    body: bulkSchema,
  })
  async bulk(
    @CurrentPrincipal() principal: Principal,
    @Param('action') action: string,
    @Body(zodBody(bulkSchema)) body: z.infer<typeof bulkSchema>
  ) {
    const operation = BULK_ACTIONS.find((a) => a === action);
    if (!operation) {
      throw new InvalidArgumentError(`unknown bulk action "${action}"; expected one of ${BULK_ACTIONS.join(', ')}`);
    }

    const succeeded: string[] = [];
    const failed: Record<string, string> = {};
    const ids = [...new Set(body.workflowIds)];

    // Bounded concurrency: a thousand parallel row locks would starve the
    // decider of connections for as long as the bulk action ran.
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          await this.load(principal, id, 'EXECUTE');
          if (operation === 'pause') await this.control.pause(id, principal.name);
          else if (operation === 'resume') await this.control.resume(id, principal.name);
          else if (operation === 'retry') await this.control.retry(id, principal.name);
          else await this.control.terminate(id, body.reason ?? 'terminated in bulk', principal.name);
          succeeded.push(id);
        } catch (error) {
          failed[id] = error instanceof Error ? error.message : String(error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));

    return { action: operation, succeeded, failed };
  }

  @Post(':id/pause')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({
    summary: 'Stop scheduling new tasks',
    description: 'Tasks already queued or leased are not recalled; they run to completion.',
    tags: ['operations'],
  })
  async pause(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    await this.load(principal, id, 'EXECUTE');
    await this.control.pause(id, principal.name);
    return { workflowId: id, status: 'PAUSED' };
  }

  @Post(':id/resume')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({ summary: 'Resume a paused execution', tags: ['operations'] })
  async resume(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    await this.load(principal, id, 'EXECUTE');
    await this.control.resume(id, principal.name);
    return { workflowId: id, status: 'RUNNING' };
  }

  @Post(':id/terminate')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({
    summary: 'End an execution and release everything it holds',
    description: 'Cancels live tasks, purges queue entries, disarms timers, frees permits.',
    tags: ['operations'],
    body: reasonSchema,
  })
  async terminate(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(reasonSchema)) body: z.infer<typeof reasonSchema>
  ) {
    await this.load(principal, id, 'EXECUTE');
    await this.control.terminate(id, body.reason, principal.name);
    return { workflowId: id, status: 'TERMINATED' };
  }

  @Post(':id/retry')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({
    summary: 'Re-run the failed tasks of a terminal execution',
    description: 'Successful tasks keep their results; only failures are reopened.',
    tags: ['operations'],
  })
  async retry(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    await this.load(principal, id, 'EXECUTE');
    const reopened = await this.control.retry(id, principal.name);
    return { workflowId: id, status: 'RUNNING', reopenedTasks: reopened };
  }

  @Post(':id/rerun')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({
    summary: 'Discard from a task onward and run again from there',
    description: 'For a task that succeeded but produced the wrong answer.',
    tags: ['operations'],
    body: rerunSchema,
  })
  async rerun(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(rerunSchema)) body: z.infer<typeof rerunSchema>
  ) {
    await this.load(principal, id, 'EXECUTE');
    const discarded = await this.control.rerunFromTask(id, body.fromTaskRef, principal.name);
    return { workflowId: id, status: 'RUNNING', discardedTasks: discarded };
  }

  /**
   * A new execution with this one's input, version and correlation id.
   *
   * Copied on the server rather than by the client: what a client reads has its
   * masked fields replaced with `***`, and a run started from that would carry
   * the mask instead of the password.
   */
  @Post(':id/run-again')
  @RequireScopes(Scope.EXECUTIONS_START)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(201)
  @ApiRoute({ summary: 'Start a new execution with the same input', tags: ['executions'] })
  async runAgain(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const original = await this.load(principal, id, 'EXECUTE', Scope.EXECUTIONS_START);
    const execution = await this.startExecution(principal, original.defName, {
      version: original.defVersion,
      input: ((await this.payloads.resolve(original.input)) ?? {}) as Record<string, unknown>,
      variables: {},
      correlationId: original.correlationId,
      taskToDomain: original.taskToDomain,
    });
    return {
      workflowId: execution.id,
      status: execution.status,
      defName: execution.defName,
      defVersion: execution.defVersion,
      startedAt: execution.startedAt,
    };
  }

  @Post(':id/skip-task')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({ summary: 'Skip a scheduled task without running it', tags: ['operations'], body: skipSchema })
  async skipTask(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(skipSchema)) body: z.infer<typeof skipSchema>
  ) {
    await this.load(principal, id, 'EXECUTE');
    await this.control.skipTask(id, body.taskRef, principal.name);
    return { workflowId: id, taskRef: body.taskRef, status: 'SKIPPED' };
  }

  /**
   * Stops one running task and pauses the workflow around it.
   *
   * Deliberately not a failure: a failure is something the definition handles —
   * it spends a retry, may start the failure workflow, may unwind compensation
   * — and an operator intervening is none of those. The run is held exactly
   * where it is so they can look at it, and `resume` or a re-run decides what
   * happens next.
   *
   * Note that the worker is not stopped. Nothing here can reach into it; the
   * lease is released, so its eventual report is refused, but the work it is
   * doing continues until it finishes on its own.
   */
  @Post(':id/tasks/cancel')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({
    summary: 'Stop a running task and pause the workflow',
    description:
      'Marks the task CANCELED and pauses the execution. The task is not failed, so no retry is ' +
      'spent and no failure workflow runs. The worker process is not stopped — its result is ' +
      'refused when it reports, because the lease is gone.',
    tags: ['operations'],
    body: cancelTaskSchema,
  })
  async cancelTask(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(cancelTaskSchema)) body: z.infer<typeof cancelTaskSchema>
  ) {
    await this.load(principal, id, 'EXECUTE');
    const result = await this.control.cancelTask(id, body.taskRef, principal.name);
    return { workflowId: id, taskRef: body.taskRef, taskId: result.taskId, status: result.status };
  }

  /**
   * Runs named tasks again, optionally with everything that depended on them.
   *
   * Different from `rerun`, which discards everything scheduled at or after a
   * point in time — a rule that also throws away an unrelated parallel branch
   * that happened to start a moment later. This one asks the blueprint what
   * actually depended on the named tasks, by data and by control flow.
   */
  @Post(':id/rerun-tasks')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({
    summary: 'Run specific tasks again, with or without their dependents',
    description:
      'The workflow must be paused or finished — pause it first, because re-running a task has no ' +
      'agreed meaning while its downstream is still executing. With `cascade` the dependents are ' +
      're-run too; without it they keep results derived from outputs that no longer exist, and the ' +
      'response lists them as `staleDownstream`.',
    tags: ['operations'],
    body: rerunTasksSchema,
  })
  async rerunTasks(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(rerunTasksSchema)) body: z.infer<typeof rerunTasksSchema>
  ) {
    await this.load(principal, id, 'EXECUTE');
    const result = await this.control.rerunTasks(id, body.taskRefs, {
      cascade: body.cascade,
      by: principal.name,
      blueprints: this.metadata,
    });
    return { workflowId: id, ...result, cascade: Boolean(body.cascade) };
  }

  /** Forces an evaluation. An escape hatch, and a diagnostic. */
  @Post(':id/decide')
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @HttpCode(202)
  @ApiRoute({ summary: 'Force an evaluation — an escape hatch and a diagnostic', tags: ['operations'] })
  async decide(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    await this.load(principal, id, 'EXECUTE');
    await this.decideQueue.enqueue(principal.namespaceId, id, 'requested by operator');
    return { workflowId: id, queued: true };
  }

  /**
   * Loads an execution, or 404s.
   *
   * The namespace check is what stops an id from one tenant being readable by
   * another. Ids are UUIDv7 and unguessable, but "unguessable" is not an access
   * control — one leaked id in a log or a support ticket would otherwise be
   * enough.
   */
  /**
   * Hides the definition's `maskedFields` in what is about to be returned.
   *
   * Applied to payloads only — input, output, variables, event payloads — never
   * the envelope, so masking a field called `status` cannot blank the
   * execution's own status. A definition that cannot be loaded masks nothing
   * rather than failing the read.
   */
  private async maskFor(execution: { namespaceId: string; defName: string; defVersion: number }) {
    const blueprint = await this.metadata.load(execution.namespaceId, execution.defName, execution.defVersion).catch(() => undefined);
    const fields = new Set(blueprint?.maskedFields ?? []);
    return <T>(value: T): T => maskFields(value, fields);
  }

  /** Tagged workflows this caller cannot reach, whose executions are therefore invisible to them. */
  private hiddenWorkflows(principal: Principal): Promise<string[]> {
    return this.metadata.unreachableWorkflowNames(principal.namespaceId, accessPolicy(principal, EXECUTION_SCOPES));
  }

  private async load(principal: Principal, id: string, need: ResourceAccess = 'READ', scope?: string) {
    // A malformed id is a 404, not a 500. Postgres rejects a non-UUID before
    // the query runs, and letting that escape turns a typo in a URL into an
    // unhandled exception with a driver error message in the response — noise
    // in the logs, and a small disclosure of what the storage layer is.
    const execution = isUuid(id) ? await this.workflows.findById(id) : undefined;
    // A tagged workflow's executions are as protected as its definition: the
    // same 404 as a missing one, so a tag cannot be probed by execution id.
    const hidden =
      execution && execution.namespaceId === principal.namespaceId
        ? !mayUse(
            principal,
            need,
            { name: execution.defName, tags: (await this.metadata.tagsOf(principal.namespaceId, execution.defName)) ?? [] },
            scope ? { ...EXECUTION_SCOPES, [need]: scope } : EXECUTION_SCOPES
          )
        : false;
    if (!execution || execution.namespaceId !== principal.namespaceId || hidden) {
      // Identical response either way: distinguishing "not yours" from "does
      // not exist" confirms the existence of another tenant's execution.
      throw new NotFoundException({
        error: ErrorCode.NOT_FOUND,
        message: `no execution ${id}`,
      });
    }
    return execution;
  }
}

/**
 * Every execution id is a UUIDv7, so anything else cannot name a real row and
 * there is nothing to look up.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

@Module({ controllers: [ExecutionController] })
export class ExecutionModule {}
