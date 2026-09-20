import { Body, Controller, HttpCode, Module, NotFoundException, Post } from '@nestjs/common';
import {
  ErrorCode,
  InvalidArgumentError,
  InvalidDefinitionError,
  Scope,
  TaskType,
  type JsonValue,
  type Principal,
  type WorkflowTask,
} from '@node-flow-dev/core';
import { EnvironmentRepository, MetadataRepository, checkDefinition } from '@node-flow-dev/store';
import { TaskExecutorRegistry } from '@node-flow-dev/tasks';
import { simulate, type MockOutcome } from '@node-flow-dev/testkit';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Test mode: run a workflow with mocked task outcomes, touching nothing.
 *
 * The engine that decides is the production engine; only the outside world is
 * replaced. Tasks that are pure computation — INLINE, JQ, business rules — run
 * for real in their usual sandboxes, because mocking the logic under test
 * would test nothing. Everything with an effect (workers, HTTP, people,
 * webhooks, events) takes its outcome from `mocks`. No execution is created,
 * no event is published, no worker is woken.
 */

const outcomeSchema = z.union([
  z.object({ status: z.literal('COMPLETED').optional(), output: z.record(z.string(), z.unknown()).optional() }),
  z.object({
    status: z.enum(['FAILED', 'FAILED_WITH_TERMINAL_ERROR', 'TIMED_OUT']),
    reason: z.string().max(2000).optional(),
    output: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const testSchema = z
  .object({
    /** An unsaved definition, as the editor holds it. */
    definition: z.record(z.string(), z.unknown()).optional(),
    /** Or a registered one. */
    name: z.string().min(1).optional(),
    version: z.number().int().positive().optional(),
    input: z.record(z.string(), z.unknown()).default({}),
    variables: z.record(z.string(), z.unknown()).optional(),
    mocks: z.record(z.string(), z.union([outcomeSchema, z.array(outcomeSchema).min(1).max(50)])).default({}),
    /** Run INLINE, JQ and business-rule tasks for real rather than mocking them. */
    runPureTasks: z.boolean().default(true),
  })
  .refine((body) => body.definition || body.name, { message: 'give a definition, or the name of a registered workflow' });

/** Task types that compute and have no effect, so a test may run them for real. */
const PURE_TYPES = new Set<string>([TaskType.INLINE, TaskType.JSON_JQ_TRANSFORM, TaskType.BUSINESS_RULE]);

@Controller('ns/:ns/metadata')
export class SimulationController {
  constructor(
    private readonly metadata: MetadataRepository,
    private readonly environment: EnvironmentRepository,
    private readonly executors: TaskExecutorRegistry
  ) {}

  @Post('workflows/test')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Test a workflow with mocked task outcomes',
    description:
      'Runs the definition through the real engine, in memory. Tasks with effects take their outcome from ' +
      '`mocks` (by task reference; an array gives one outcome per attempt). Nothing is persisted or published.',
    tags: ['metadata'],
    body: testSchema,
  })
  async test(@CurrentPrincipal() principal: Principal, @Body(zodBody(testSchema)) body: z.infer<typeof testSchema>) {
    const access = { tagGrants: [...(principal.tagGrants ?? []), ...principal.scopes] };
    const definition = body.definition ?? (await this.metadata.getWorkflowDefinition(principal.namespaceId, body.name as string, access, body.version));
    if (!definition) throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no workflow "${body.name}"` });

    // The same verdict registration gives, so a test cannot pass for a definition that could never be saved.
    const checked = checkDefinition(definition);
    if (!checked.valid) {
      throw new InvalidArgumentError('the definition is not valid', { stage: checked.stage, issues: checked.issues });
    }

    const subWorkflows = await this.loadSubWorkflows(principal.namespaceId, checked.definition.tasks, access);
    const taskDefs = await this.metadata.loadTaskDefs(principal.namespaceId, checked.blueprint.allTaskDefNames);
    const started = Date.now();

    try {
      const result = await simulate(checked.definition, {
        input: body.input as Record<string, JsonValue>,
        variables: body.variables as Record<string, JsonValue> | undefined,
        env: await this.environment.load(principal.namespaceId),
        mocks: body.mocks as Record<string, MockOutcome | MockOutcome[]>,
        taskDefs: Object.fromEntries(taskDefs),
        subWorkflows,
        maxEvaluations: 5_000,
        execute: body.runPureTasks ? (task) => this.runPure(principal.namespaceId, task) : undefined,
      });
      return { ...result, durationMs: Date.now() - started };
    } catch (error) {
      if (error instanceof InvalidDefinitionError) throw new InvalidArgumentError(error.message, error.details);
      throw error;
    }
  }

  private async runPure(
    namespaceId: string,
    task: { refName: string; taskType: string; input: Record<string, JsonValue> }
  ): Promise<MockOutcome | undefined> {
    if (!PURE_TYPES.has(task.taskType)) return undefined;
    const executor = this.executors.get(task.taskType as TaskType);
    if (!executor) return undefined;
    const outcome = await executor.execute({
      taskId: `test:${task.refName}`,
      workflowId: 'test',
      namespaceId,
      input: task.input,
      signal: AbortSignal.timeout(5_000),
      heartbeat: async () => undefined,
      state: {},
    });
    if (outcome.status === 'COMPLETED') return { status: 'COMPLETED', output: outcome.output ?? {} };
    if (outcome.status === 'FAILED') {
      return { status: outcome.terminal ? 'FAILED_WITH_TERMINAL_ERROR' : 'FAILED', reason: outcome.reason, output: outcome.output };
    }
    return { status: 'FAILED', reason: 'a pure task asked to be polled again, which a test cannot wait for' };
  }

  /** Every sub-workflow the definition can reach, by name, so children run for real too. */
  private async loadSubWorkflows(
    namespaceId: string,
    tasks: WorkflowTask[],
    access: { tagGrants: string[] },
    found: Record<string, unknown> = {},
    depth = 0
  ): Promise<Record<string, unknown>> {
    if (depth > 5) return found;
    for (const name of subWorkflowNames(tasks)) {
      if (found[name]) continue;
      const child = await this.metadata.getWorkflowDefinition(namespaceId, name, access);
      if (!child) continue; // Mocked by its task reference instead.
      found[name] = child;
      await this.loadSubWorkflows(namespaceId, child.tasks, access, found, depth + 1);
    }
    return found;
  }
}

function subWorkflowNames(tasks: WorkflowTask[]): string[] {
  const names: string[] = [];
  const walk = (list: WorkflowTask[] | undefined) => {
    for (const task of list ?? []) {
      if (task.type === TaskType.SUB_WORKFLOW && task.subWorkflowParam?.name) names.push(task.subWorkflowParam.name);
      walk(task.loopOver);
      walk(task.defaultCase);
      for (const branch of Object.values(task.decisionCases ?? {})) walk(branch);
      for (const branch of task.forkTasks ?? []) walk(branch);
    }
  };
  walk(tasks);
  return names;
}

@Module({ controllers: [SimulationController] })
export class SimulationModule {}
