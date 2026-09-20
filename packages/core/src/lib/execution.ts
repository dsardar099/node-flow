import type { JsonValue } from './definitions.js';
import type { TaskStatus, WorkflowStatus } from './status.js';
import type { TaskType } from './task-type.js';

/**
 * Runtime execution state.
 *
 * These mirror the `WorkflowExecutions` and `TaskExecutions` tables, but are
 * plain data with no persistence concerns attached — the engine consumes them
 * and never knows they came from a database.
 *
 * Note what is *absent*: there is no `tasks: TaskExecution[]` on a workflow.
 * That omission is deliberate and structural. A workflow may hold 30,000 tasks,
 * and an evaluation must never load them all. The decider is handed only the
 * non-terminal frontier plus the specific terminal outputs its expressions
 * reference. Making the full list unrepresentable here means no one can
 * accidentally write code that depends on having it.
 */

/**
 * A payload that may live inline or in blob storage.
 *
 * Large task inputs and outputs are offloaded, and the engine mostly does not
 * need them — so it carries a reference and resolves lazily, only when an
 * expression actually reads into the value.
 */
export type Payload =
  | { kind: 'inline'; value: Record<string, JsonValue> }
  | { kind: 'ref'; ref: string; sizeBytes: number };

export function inlinePayload(value: Record<string, JsonValue> = {}): Payload {
  return { kind: 'inline', value };
}

/** Reads an inline payload, or throws if it must be fetched first. */
export function requireInline(payload: Payload | undefined): Record<string, JsonValue> {
  if (!payload) return {};
  if (payload.kind === 'inline') return payload.value;
  throw new Error(
    `payload ${payload.ref} is externalised (${payload.sizeBytes} bytes) and must be resolved before use`
  );
}

export interface WorkflowExecution {
  id: string;
  namespaceId: string;
  defName: string;
  defVersion: number;
  status: WorkflowStatus;
  correlationId?: string;
  idempotencyKey?: string;
  priority: number;
  input: Payload;
  output?: Payload;
  /** Workflow-scoped mutable state, written by SET_VARIABLE. */
  variables: Record<string, JsonValue>;
  parentWorkflowId?: string;
  parentTaskId?: string;
  startedAt: Date;
  updatedAt: Date;
  endedAt?: Date;
  /** Optimistic-concurrency counter, bumped on every committed evaluation. */
  version: number;
  reasonForIncompletion?: string;
  /** The resolved key this execution is rate limited under, if any. */
  rateLimitKey?: string;
  /** Created, but waiting for a rate-limit slot before it may run. */
  awaitingAdmission?: boolean;
  /**
   * Worker routing for this run: task definition name, or `*` for every worker
   * task, to a domain. Overrides the domain a definition gives its tasks.
   */
  taskToDomain?: Record<string, string>;
}

export interface TaskExecution {
  id: string;
  workflowId: string;
  /** Identifies the task within the workflow; what expressions refer to. */
  refName: string;
  taskDefName: string;
  taskType: TaskType;
  status: TaskStatus;
  /** 0 for the first run; incremented per retry. */
  attempt: number;
  /** DO_WHILE pass number, 0 outside a loop. Part of the task's unique identity. */
  iteration: number;
  /** Enclosing fork branch or loop body, for nesting. */
  parentRefName?: string;
  /** Worker pool this task was routed to; absent means the shared queue. */
  domain?: string;
  input: Payload;
  output?: Payload;
  reasonForIncompletion?: string;
  workerId?: string;
  scheduledAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  /** Fencing token; a worker whose lease expired cannot report a result. */
  leaseToken?: string;
}

/**
 * Everything the decider is allowed to see in one evaluation.
 *
 * `resolvedRefs` holds only the terminal tasks whose outputs the pending tasks'
 * expressions actually reference, batch-fetched from the blueprint's static
 * analysis. This is the mechanism that keeps evaluation cost proportional to
 * references used rather than to workflow size.
 */
export interface EvaluationState {
  workflow: WorkflowExecution;
  /** Non-terminal tasks — the frontier. */
  pending: TaskExecution[];
  /**
   * Terminal tasks that triggered this evaluation.
   *
   * Evaluation is event-driven: something completed, failed or timed out, and
   * the decider works out what that unblocks. Usually one task; several when
   * parallel branches finish close together.
   *
   * This is what keeps a pass O(what changed) rather than O(workflow size).
   * Re-delivering a task here is harmless — scheduling is idempotent under the
   * `UNIQUE (workflowId, refName, iteration)` constraint — which is what lets
   * the engine always err toward an extra evaluation.
   */
  completed: TaskExecution[];
  /** Terminal tasks referenced by expressions, keyed by `refName` or `refName#iteration`. */
  resolvedRefs: Map<string, TaskExecution>;
  /**
   * Whether this workflow has ever scheduled a task.
   *
   * Distinguishes "not started yet" from "finished, and the evaluation
   * watermark has moved past every completion". Both look identical from
   * `pending` and `completed` alone — they are empty either way — and
   * conflating them makes the decider re-schedule the entry task of a workflow
   * that has already run, which then does nothing because the task exists and
   * leaves the workflow stuck at RUNNING forever.
   */
  hasAnyTask: boolean;
  /** Injected so evaluation is deterministic and testable. */
  now: Date;
  /**
   * The namespace's environment variables, read by `${workflow.env.name}`.
   * Loaded by the caller so the engine stays free of I/O.
   */
  env?: Record<string, JsonValue>;
}
