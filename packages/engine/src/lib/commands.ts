import type { JsonValue, TaskStatus, TaskType, WorkflowStatus } from '@node-flow-dev/core';

/**
 * What the decider produces.
 *
 * The decider performs no I/O. It reads state and returns a list of commands
 * describing what *should* happen; the caller applies them inside a single
 * transaction. Three things fall out of that separation:
 *
 *  - The engine is unit-testable with no database, so operator semantics are
 *    covered by fast tests rather than integration tests.
 *  - Evaluation is replayable — feed the same state in, get the same commands
 *    out — which is what makes time-travel debugging possible later.
 *  - Nothing can escape the transaction, because the decider has no way to send
 *    anything anywhere.
 */

export interface ScheduleTaskCommand {
  type: 'ScheduleTask';
  refName: string;
  taskDefName: string;
  /**
   * Worker pool this task is routed to, if the definition names one.
   *
   * Carried through the command rather than re-derived at apply time, because
   * the decider is the only thing that has read the definition. When it was not
   * carried, the applier had nothing to route on and every task silently went
   * to the shared queue — while the API went on accepting the routing request.
   */
  domain?: string;
  taskType: TaskType;
  input: Record<string, JsonValue>;
  /** DO_WHILE pass number; 0 outside a loop. Part of task identity. */
  iteration: number;
  /** Enclosing fork branch or loop body, for nesting. */
  parentRefName?: string;
  /** Deferred start — `startDelaySeconds`, or a retry backoff. */
  delaySeconds?: number;
  /**
   * Output cache lookup for this task, with the key already resolved. The
   * applier consults the cache; the engine only says where to look.
   */
  cache?: { key: string; ttlSeconds: number };
  /** Attempt number; 0 for a first run. */
  attempt: number;
  /**
   * Set when the decider resolved this task within the same pass — a NOOP,
   * SET_VARIABLE, or a SWITCH whose branch was chosen. The applier inserts the
   * row already terminal instead of queueing it.
   *
   * Without this, a SWITCH nested in a FORK inside a DO_WHILE would cost three
   * separate evaluations and three database round trips to get through control
   * flow that involves no actual work. The task row is still written, because
   * seeing *why* a workflow took a branch is most of debugging one.
   */
  resolved?: {
    status: Extract<TaskStatus, 'COMPLETED' | 'SKIPPED'>;
    output: Record<string, JsonValue>;
  };
  /**
   * The pass already advanced past this resolved task to its successors. When
   * true, the task is recorded as seen, so a later pass does not react to its
   * completion a second time and repeat what follows it — an `EVENT` published
   * twice. False past the resolution depth limit, where the next pass continues.
   */
  continuedInPass?: boolean;
}

/** Completes a task the decider resolved itself, e.g. SWITCH or SET_VARIABLE. */
export interface CompleteTaskCommand {
  type: 'CompleteTask';
  taskId: string;
  refName: string;
  output: Record<string, JsonValue>;
}

export interface FailTaskCommand {
  type: 'FailTask';
  taskId: string;
  refName: string;
  reason: string;
  /** Terminal failures bypass retry entirely. */
  status: Extract<
    TaskStatus,
    'FAILED' | 'FAILED_WITH_TERMINAL_ERROR' | 'TIMED_OUT' | 'COMPLETED_WITH_ERRORS'
  >;
}

/** Re-queues a failed task for another attempt after a computed backoff. */
export interface RetryTaskCommand {
  type: 'RetryTask';
  refName: string;
  taskDefName: string;
  /** Same pool as the attempt it replaces — a retry must not change fleets. */
  domain?: string;
  taskType: TaskType;
  input: Record<string, JsonValue>;
  iteration: number;
  parentRefName?: string;
  attempt: number;
  delaySeconds: number;
  /** The failed attempt this retry supersedes, for lineage in the UI. */
  previousTaskId: string;
}

/** Marks a task that will never run — an untaken SWITCH branch. */
export interface SkipTaskCommand {
  type: 'SkipTask';
  refName: string;
  iteration: number;
  reason: string;
}

export interface SetVariableCommand {
  type: 'SetVariable';
  values: Record<string, JsonValue>;
}

/**
 * Publishes an event — the `EVENT` task.
 *
 * Emitted rather than performed, because the engine does no I/O. The applier
 * writes it to the transactional outbox in the **same transaction** that
 * completes the task, which is what makes "the task succeeded" and "the event
 * was published" inseparable.
 *
 * Doing it from a task runner instead would put the publish outside that
 * transaction: a lease expiring between publishing and reporting would retry
 * the task and publish the event twice, with nothing recording that the first
 * one happened.
 */
export interface PublishEventCommand {
  type: 'PublishEvent';
  /** Where it goes. Matched against the relay's registered sinks. */
  sink: string;
  payload: Record<string, JsonValue>;
  /**
   * A stable identity for the **subscriber**, not a guard against double
   * publishing.
   *
   * Publishing exactly once is already guaranteed by the applier: the outbox
   * row and the task row commit in one transaction, and the unique index on
   * the task means a redundant evaluation re-derives nothing. What this key is
   * for is the other end — relay delivery is at-least-once, so a consumer needs
   * something stable to deduplicate on across redeliveries.
   */
  idempotencyKey: string;
}

export interface CompleteWorkflowCommand {
  type: 'CompleteWorkflow';
  output: Record<string, JsonValue>;
}

export interface FailWorkflowCommand {
  type: 'FailWorkflow';
  status: Extract<WorkflowStatus, 'FAILED' | 'TIMED_OUT' | 'TERMINATED'>;
  reason: string;
}

/**
 * Starts a workflow and does not wait for it — the START_WORKFLOW operator.
 *
 * Distinct from StartSubWorkflow: nothing links the child back to this parent,
 * so the parent proceeds immediately and the child's outcome cannot affect it.
 */
export interface StartWorkflowCommand {
  type: 'StartWorkflow';
  defName: string;
  defVersion?: number;
  input: Record<string, JsonValue>;
  correlationId?: string;
  /** Deduplicates a fire-and-forget start if the evaluation is replayed. */
  idempotencyKey?: string;
}

/**
 * Starts a child workflow for a SUB_WORKFLOW task.
 *
 * The parent task stays IN_PROGRESS until the child reaches a terminal state,
 * at which point the child's completion enqueues an evaluation on the parent.
 */
export interface StartSubWorkflowCommand {
  type: 'StartSubWorkflow';
  /** The parent SUB_WORKFLOW task awaiting this child. */
  parentTaskRefName: string;
  parentTaskIteration: number;
  /**
   * Which attempt of that task this child belongs to.
   *
   * A retried sub-workflow is a *new* child of the same ref, and the start is
   * deduplicated by an idempotency key derived from these fields. Without the
   * attempt the key repeats, so the retry is absorbed as a duplicate of the
   * previous attempt's child — which has already finished — and the retried
   * task is left with nothing that will ever complete it.
   */
  parentTaskAttempt: number;
  defName: string;
  defVersion?: number;
  input: Record<string, JsonValue>;
  /** Inherited task-to-domain routing, so children land on the same workers. */
  taskToDomain?: Record<string, string>;
}

/**
 * Schedules a durable timer.
 *
 * Each kind answers a different question. `scheduleToStart` firing means nobody
 * picked the task up; `startToClose` means a worker took it and went silent.
 * Collapsing them into one number loses the distinction between "no workers on
 * this queue" and "the worker is stuck", which are different incidents with
 * different owners.
 */
export interface SetTimerCommand {
  type: 'SetTimer';
  kind: 'scheduleToStart' | 'startToClose' | 'taskTimeout' | 'workflowTimeout' | 'wait';
  fireAfterSeconds: number;
  /** The task this deadline belongs to; absent for workflow-level timers. */
  refName?: string;
}

export type Command =
  | ScheduleTaskCommand
  | CompleteTaskCommand
  | FailTaskCommand
  | RetryTaskCommand
  | SkipTaskCommand
  | SetVariableCommand
  | PublishEventCommand
  | CompleteWorkflowCommand
  | FailWorkflowCommand
  | StartSubWorkflowCommand
  | StartWorkflowCommand
  | SetTimerCommand;

export interface DecisionResult {
  commands: Command[];
  /**
   * True when this pass changed nothing.
   *
   * Expected and harmless — the engine deliberately errs toward redundant
   * evaluations, because a lost one strands a workflow forever while an extra
   * one costs a query. Useful as a metric: a sustained high no-op rate means
   * something is enqueueing evaluations it does not need to.
   */
  noop: boolean;
}

export function emptyDecision(): DecisionResult {
  return { commands: [], noop: true };
}
