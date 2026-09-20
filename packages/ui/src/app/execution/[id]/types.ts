export interface TaskRun {
  id: string;
  refName: string;
  taskDefName: string;
  taskType: string;
  status: string;
  attempt: number;
  iteration: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  reasonForIncompletion?: string | null;
  workerId?: string | null;
  domain?: string | null;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface ExecutionDetail {
  id: string;
  defName: string;
  defVersion: number;
  status: string;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  priority?: number;
  parentWorkflowId?: string | null;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  variables: Record<string, unknown>;
  reasonForIncompletion?: string | null;
  /** The rate-limit bucket this execution counts against, if its definition has one. */
  rateLimitKey?: string;
  /** Worker routing for this run: task definition name or `*` to domain. */
  taskToDomain?: Record<string, string>;
  /** Created, but queued behind its rate-limit key; nothing has run yet. */
  awaitingAdmission?: boolean;
  startedAt: string;
  endedAt?: string | null;
  tasks: TaskRun[];
  tasksTruncated: boolean;
}

export const TERMINAL_WORKFLOW = new Set(['COMPLETED', 'FAILED', 'TIMED_OUT', 'TERMINATED']);
export const TERMINAL_TASK = new Set([
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'FAILED_WITH_TERMINAL_ERROR',
  'TIMED_OUT',
  'CANCELED',
  'SKIPPED',
]);
export const FAILED_TASK = new Set(['FAILED', 'FAILED_WITH_TERMINAL_ERROR', 'TIMED_OUT']);
