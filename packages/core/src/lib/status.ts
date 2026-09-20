/**
 * Execution statuses for workflows and tasks.
 *
 * The terminal/non-terminal split is the single most load-bearing distinction in
 * the engine: the decider's "pending frontier" query selects exactly the tasks
 * that are NOT terminal, and a workflow completes precisely when nothing
 * non-terminal remains. Every predicate here is exhaustive over its union so
 * that adding a status is a compile error at every decision point rather than a
 * silently-wrong branch at runtime.
 */

export const TaskStatus = {
  /** Created and queued, not yet leased by a worker. */
  SCHEDULED: 'SCHEDULED',
  /** Leased by a worker, or a system task currently executing. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** Waiting on something external: a timer, a signal, a webhook, a human. */
  WAITING: 'WAITING',
  /** Finished successfully. */
  COMPLETED: 'COMPLETED',
  /** Finished unsuccessfully, but may be retried if attempts remain. */
  FAILED: 'FAILED',
  /** Finished unsuccessfully and must never be retried, whatever retryCount says. */
  FAILED_WITH_TERMINAL_ERROR: 'FAILED_WITH_TERMINAL_ERROR',
  /** Exceeded one of its timeout budgets. */
  TIMED_OUT: 'TIMED_OUT',
  /** Cancelled by an operator, or abandoned because the workflow terminated. */
  CANCELED: 'CANCELED',
  /** Never ran: an untaken SWITCH branch, or explicitly skipped by an operator. */
  SKIPPED: 'SKIPPED',
  /** Failed, but marked `optional` so the workflow proceeds regardless. */
  COMPLETED_WITH_ERRORS: 'COMPLETED_WITH_ERRORS',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const WorkflowStatus = {
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  TERMINATED: 'TERMINATED',
} as const;

export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.FAILED_WITH_TERMINAL_ERROR,
  TaskStatus.TIMED_OUT,
  TaskStatus.CANCELED,
  TaskStatus.SKIPPED,
  TaskStatus.COMPLETED_WITH_ERRORS,
]);

const SUCCESSFUL_TASK_STATUSES = new Set<TaskStatus>([
  TaskStatus.COMPLETED,
  TaskStatus.SKIPPED,
  TaskStatus.COMPLETED_WITH_ERRORS,
]);

const RETRYABLE_TASK_STATUSES = new Set<TaskStatus>([TaskStatus.FAILED, TaskStatus.TIMED_OUT]);

const TERMINAL_WORKFLOW_STATUSES = new Set<WorkflowStatus>([
  WorkflowStatus.COMPLETED,
  WorkflowStatus.FAILED,
  WorkflowStatus.TIMED_OUT,
  WorkflowStatus.TERMINATED,
]);

/** A task that will never change state again without operator intervention. */
export function isTaskTerminal(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

/**
 * A task whose outcome lets successors proceed.
 *
 * SKIPPED counts as successful: an untaken SWITCH branch must not block a JOIN
 * downstream of it, or every switch inside a fork would deadlock.
 */
export function isTaskSuccessful(status: TaskStatus): boolean {
  return SUCCESSFUL_TASK_STATUSES.has(status);
}

/**
 * A failure that retry policy may act on.
 *
 * FAILED_WITH_TERMINAL_ERROR is excluded by design — it is how a worker says
 * "this input will never succeed, stop burning attempts on it".
 */
export function isTaskRetryable(status: TaskStatus): boolean {
  return RETRYABLE_TASK_STATUSES.has(status);
}

export function isWorkflowTerminal(status: WorkflowStatus): boolean {
  return TERMINAL_WORKFLOW_STATUSES.has(status);
}

/** Tasks the decider must load to evaluate a workflow: everything unfinished. */
export const NON_TERMINAL_TASK_STATUSES: readonly TaskStatus[] = Object.values(TaskStatus).filter(
  (s) => !TERMINAL_TASK_STATUSES.has(s)
);
