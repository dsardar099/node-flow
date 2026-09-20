import {
  InvalidDefinitionError,
  TaskStatus,
  WorkflowStatus,
  inlinePayload,
  isExternallyCompleted,
  isOperator,
  isTaskTerminal,
  isTimerBacked,
  isWorkflowTerminal,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type JsonValue,
  type TaskDefinition,
  type TaskExecution,
  type TaskType,
  type WorkflowDefinition,
  type WorkflowExecution,
} from '@node-flow-dev/core';
import { compileBlueprint, decide, loopConditionProblem, switchExpressionProblem, type Blueprint, type Command } from '@node-flow-dev/engine';

/**
 * Runs a workflow definition entirely in memory, with task outcomes mocked.
 *
 * The real engine decides every step — this is not a re-implementation of
 * workflow semantics, only of what the database evaluator does with the
 * engine's commands: insert tasks, record completions, keep variables. That is
 * what makes a passing simulation mean something: SWITCH branches, loops,
 * joins, retries, expression errors and output parameters all behave exactly
 * as they will in production, in milliseconds, with no server.
 *
 * Anything that would touch the outside world — a worker, an HTTP call, a
 * person, a webhook — takes its outcome from `mocks` instead, keyed by task
 * reference. A task with no mock succeeds with an empty output and is listed in
 * `unmocked`, so a test can assert it mocked everything it meant to.
 */

export type MockOutcome =
  | { status?: 'COMPLETED'; output?: Record<string, JsonValue> }
  | { status: 'FAILED' | 'FAILED_WITH_TERMINAL_ERROR' | 'TIMED_OUT'; reason?: string; output?: Record<string, JsonValue> };

export interface SimulateOptions {
  input?: Record<string, JsonValue>;
  variables?: Record<string, JsonValue>;
  env?: Record<string, JsonValue>;
  /** Per task reference: one outcome for every attempt, or one per attempt in order (the last repeats). */
  mocks?: Record<string, MockOutcome | MockOutcome[]>;
  /** Task definitions by name, for retry and timeout policy. Unlisted tasks use the defaults. */
  taskDefs?: Record<string, Partial<TaskDefinition>>;
  /** Definitions for SUB_WORKFLOW children, which then run for real rather than being mocked. */
  subWorkflows?: Record<string, unknown>;
  /**
   * Runs a task for real instead of mocking it — for pure computation such as
   * INLINE or JSON_JQ_TRANSFORM. Return undefined to fall back to the mock.
   */
  execute?: (task: { refName: string; taskType: TaskType; input: Record<string, JsonValue> }) => Promise<MockOutcome | undefined>;
  /** Evaluation cap; a workflow still running after this many passes is reported as stuck. */
  maxEvaluations?: number;
}

export interface SimulatedTask {
  refName: string;
  taskDefName: string;
  taskType: TaskType;
  status: TaskStatus;
  attempt: number;
  iteration: number;
  input: Record<string, JsonValue>;
  output?: Record<string, JsonValue>;
  reason?: string;
  mocked: boolean;
}

export interface SimulationResult {
  status: WorkflowStatus | 'STUCK';
  output?: Record<string, JsonValue>;
  reasonForIncompletion?: string;
  variables: Record<string, JsonValue>;
  tasks: SimulatedTask[];
  /** Task references that completed with the default empty output because nothing mocked them. */
  unmocked: string[];
  published: { sink: string; payload: Record<string, JsonValue> }[];
  startedWorkflows: { defName: string; input: Record<string, JsonValue> }[];
  evaluations: number;
}

interface Row extends TaskExecution {
  processed: boolean;
  mocked: boolean;
}

export async function simulate(definition: unknown, options: SimulateOptions = {}, depth = 0): Promise<SimulationResult> {
  if (depth > 10) throw new Error('sub-workflows nest more than ten deep');
  const parsed: WorkflowDefinition = workflowDefinitionSchema.parse(definition);
  const blueprint: Blueprint = compileBlueprint(parsed);
  // The rules registration applies on top of the compiler. A simulation that
  // accepted what the server refuses would pass tests for a workflow that can
  // never be deployed — or, worse, show a condition silently running once.
  for (const node of blueprint.nodes.values()) {
    const problem =
      node.task.type === 'DO_WHILE'
        ? loopConditionProblem(node.task.loopCondition)
        : node.task.type === 'SWITCH'
          ? switchExpressionProblem(node.task)
          : undefined;
    if (problem) throw new InvalidDefinitionError(`${node.task.type} "${node.ref}": ${problem}`, { taskReferenceName: node.ref });
  }
  const taskDefs = new Map(
    Object.entries(options.taskDefs ?? {}).map(([name, def]) => [name, taskDefinitionSchema.parse({ retryCount: 0, ...def, name })])
  );

  const now = new Date();
  const workflow: WorkflowExecution = {
    id: `sim-${depth}`,
    namespaceId: 'simulation',
    defName: parsed.name,
    defVersion: parsed.version,
    status: WorkflowStatus.RUNNING,
    priority: 0,
    input: inlinePayload(options.input ?? {}),
    variables: { ...(parsed.variables ?? {}), ...(options.variables ?? {}) } as Record<string, JsonValue>,
    startedAt: now,
    updatedAt: now,
    version: 0,
  };

  const rows: Row[] = [];
  const unmocked = new Set<string>();
  const attemptsUsed = new Map<string, number>();
  const result: Pick<SimulationResult, 'published' | 'startedWorkflows'> = { published: [], startedWorkflows: [] };
  let sequence = 0;
  // A clock that always moves forward: tasks finishing within one millisecond
  // must still have an order, because compensation undoes them by it.
  let clock = Date.now();
  const tick = () => new Date(++clock);
  let evaluations = 0;
  const max = options.maxEvaluations ?? 10_000;

  const payloadOf = (payload: TaskExecution['output']): Record<string, JsonValue> | undefined =>
    payload?.kind === 'inline' ? (payload.value as Record<string, JsonValue>) : undefined;

  const finish = (row: Row, status: TaskStatus, output?: Record<string, JsonValue>, reason?: string) => {
    if (isTaskTerminal(row.status)) return;
    row.status = status;
    if (output) row.output = inlinePayload(output);
    if (reason) row.reasonForIncompletion = reason;
    row.endedAt = tick();
    row.processed = false;
  };

  const mockFor = (refName: string): MockOutcome | undefined => {
    const mock = options.mocks?.[refName];
    if (!mock) return undefined;
    if (!Array.isArray(mock)) return mock;
    const used = attemptsUsed.get(refName) ?? 0;
    attemptsUsed.set(refName, used + 1);
    return mock[Math.min(used, mock.length - 1)];
  };

  const settle = async (row: Row) => {
    const real = options.execute
      ? await options.execute({ refName: row.refName, taskType: row.taskType, input: payloadOf(row.input) ?? {} })
      : undefined;
    const outcome = real ?? mockFor(row.refName);
    if (!outcome) {
      // A wait with nothing mocked simply elapses; it has no outcome to invent.
      if (!isTimerBacked(row.taskType)) unmocked.add(row.refName);
      finish(row, TaskStatus.COMPLETED, {});
      return;
    }
    row.mocked = !real;
    const status = (outcome.status ?? 'COMPLETED') as TaskStatus;
    finish(row, status, outcome.output ?? {}, 'reason' in outcome ? outcome.reason : undefined);
  };

  const insert = (fields: Partial<Row> & Pick<Row, 'refName' | 'taskDefName' | 'taskType' | 'status' | 'attempt' | 'iteration'>): Row | undefined => {
    // The unique (refName, iteration, attempt) identity the database enforces:
    // a repeated schedule is absorbed, which the engine relies on.
    if (rows.some((r) => r.refName === fields.refName && r.iteration === fields.iteration && r.attempt === fields.attempt)) {
      return undefined;
    }
    const row: Row = {
      id: `task-${depth}-${++sequence}`,
      workflowId: workflow.id,
      input: inlinePayload({}),
      scheduledAt: tick(),
      processed: false,
      mocked: false,
      ...fields,
    } as Row;
    rows.push(row);
    return row;
  };

  const runChild = async (row: Row, command: Extract<Command, { type: 'StartSubWorkflow' }>) => {
    const child = options.subWorkflows?.[command.defName];
    if (!child) return settle(row);
    const outcome = await simulate(child, { ...options, input: command.input, variables: {} }, depth + 1);
    result.published.push(...outcome.published);
    result.startedWorkflows.push(...outcome.startedWorkflows);
    for (const ref of outcome.unmocked) unmocked.add(`${command.defName}.${ref}`);
    if (outcome.status === WorkflowStatus.COMPLETED) finish(row, TaskStatus.COMPLETED, outcome.output ?? {});
    else finish(row, TaskStatus.FAILED, undefined, outcome.reasonForIncompletion ?? `sub-workflow ${outcome.status}`);
  };

  while (!isWorkflowTerminal(workflow.status) && evaluations < max) {
    const pending = rows.filter((r) => !isTaskTerminal(r.status));
    const completed = rows.filter((r) => isTaskTerminal(r.status) && !r.processed);
    if (evaluations > 0 && completed.length === 0) break;

    // Latest per reference, finished before unfinished — the evaluator's own
    // ordering — and only for the refs the blueprint says expressions and joins
    // read, exactly as the evaluator loads them. Offering every task instead
    // is not harmless: the engine treats a ref it can see as already scheduled,
    // so a loop would never start its second iteration.
    const staticRefs = new Set(blueprint.allStaticRefs);
    const resolvedRefs = new Map<string, TaskExecution>();
    for (const row of [...rows].filter((r) => staticRefs.has(r.refName)).sort(
      (a, b) =>
        Number(isTaskTerminal(b.status)) - Number(isTaskTerminal(a.status)) || b.iteration - a.iteration || b.attempt - a.attempt
    )) {
      if (!resolvedRefs.has(row.refName)) resolvedRefs.set(row.refName, row);
    }

    evaluations++;
    const { commands } = decide(
      blueprint,
      { workflow, pending, completed, resolvedRefs, hasAnyTask: rows.length > 0, now: new Date(), env: options.env },
      { taskDefs, maxConcurrentTasks: blueprint.maxConcurrentTasks, random: () => 0.5 }
    );
    for (const row of completed) row.processed = true;

    const toSettle: Row[] = [];
    for (const command of commands) {
      switch (command.type) {
        case 'ScheduleTask': {
          const status = command.resolved?.status ?? (isOperator(command.taskType) || isTimerBacked(command.taskType) || isExternallyCompleted(command.taskType) ? TaskStatus.IN_PROGRESS : TaskStatus.SCHEDULED);
          const row = insert({
            refName: command.refName,
            taskDefName: command.taskDefName,
            taskType: command.taskType,
            status,
            attempt: command.attempt,
            iteration: command.iteration,
            parentRefName: command.parentRefName,
            input: inlinePayload(command.input),
            ...(command.resolved ? { output: inlinePayload(command.resolved.output), endedAt: tick() } : {}),
            // As the evaluator records it: a task the pass already walked past is not reacted to again.
            ...(command.continuedInPass ? { processed: true } : {}),
          });
          // Operators are finished by later decisions; everything else needs an
          // outcome from outside. YIELD is the operator that waits for one — a
          // signal — so it takes its outcome from the mocks too.
          if (row && !command.resolved && (!isOperator(command.taskType) || command.taskType === 'YIELD')) toSettle.push(row);
          break;
        }
        case 'RetryTask': {
          const row = insert({
            refName: command.refName,
            taskDefName: command.taskDefName,
            taskType: command.taskType,
            status: TaskStatus.SCHEDULED,
            attempt: command.attempt,
            iteration: command.iteration,
            parentRefName: command.parentRefName,
            input: inlinePayload(command.input),
          });
          if (row) toSettle.push(row);
          break;
        }
        case 'SkipTask':
          insert({
            refName: command.refName,
            taskDefName: command.refName,
            taskType: 'NOOP',
            status: TaskStatus.SKIPPED,
            attempt: 0,
            iteration: command.iteration,
            output: inlinePayload({ reason: command.reason }),
            endedAt: new Date(),
          });
          break;
        case 'CompleteTask': {
          const row = rows.find((r) => r.id === command.taskId);
          if (row) finish(row, TaskStatus.COMPLETED, command.output);
          break;
        }
        case 'FailTask': {
          const row = rows.find((r) => r.id === command.taskId);
          if (row) finish(row, command.status, undefined, command.reason);
          break;
        }
        case 'SetVariable':
          workflow.variables = { ...workflow.variables, ...command.values };
          break;
        case 'PublishEvent':
          result.published.push({ sink: command.sink, payload: command.payload });
          break;
        case 'StartWorkflow':
          result.startedWorkflows.push({ defName: command.defName, input: command.input });
          break;
        case 'CompleteWorkflow':
          workflow.status = WorkflowStatus.COMPLETED;
          workflow.output = inlinePayload(command.output);
          break;
        case 'FailWorkflow':
          workflow.status = command.status;
          workflow.reasonForIncompletion = command.reason;
          break;
        case 'StartSubWorkflow': {
          const row = [...rows]
            .reverse()
            .find((r) => r.refName === command.parentTaskRefName && r.iteration === command.parentTaskIteration && !isTaskTerminal(r.status));
          if (row) await runChild(row, command);
          break;
        }
        case 'SetTimer':
          // Deadlines never fire in a simulation: every outcome is immediate.
          break;
      }
    }

    // Outcomes after the whole pass is applied, as a worker's report would land after the commit.
    for (const row of toSettle) {
      if (row.taskType !== 'SUB_WORKFLOW' && !isTaskTerminal(row.status)) await settle(row);
    }
  }

  const stuck = !isWorkflowTerminal(workflow.status);
  return {
    status: stuck ? 'STUCK' : workflow.status,
    output: payloadOf(workflow.output),
    reasonForIncompletion: stuck
      ? `still running after ${evaluations} evaluations; waiting on ${rows.filter((r) => !isTaskTerminal(r.status)).map((r) => r.refName).join(', ') || 'nothing'}`
      : workflow.reasonForIncompletion,
    variables: workflow.variables,
    tasks: rows.map((row) => ({
      refName: row.refName,
      taskDefName: row.taskDefName,
      taskType: row.taskType,
      status: row.status,
      attempt: row.attempt,
      iteration: row.iteration,
      input: payloadOf(row.input) ?? {},
      output: payloadOf(row.output),
      reason: row.reasonForIncompletion,
      mocked: row.mocked,
    })),
    unmocked: [...unmocked],
    evaluations,
    ...result,
  };
}
