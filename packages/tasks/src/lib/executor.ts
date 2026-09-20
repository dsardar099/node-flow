import type { JsonValue, TaskType } from '@node-flow-dev/core';

/**
 * A task type the server executes itself.
 *
 * Everything the DSL declares beyond `SIMPLE` and the operators — `HTTP`,
 * `INLINE`, `WAIT` and the rest — was accepted, validated and then enqueued for
 * an external worker that by definition does not exist, so it simply hung. This
 * interface is what makes them run.
 *
 * The shape deliberately mirrors the worker SDK's handler. A system task is a
 * worker that happens to live in-process: it leases through the same queue,
 * holds the same fencing token, heartbeats the same way, and is subject to the
 * same retries, timeouts and concurrency caps. Inventing a second execution
 * path would mean re-earning every one of those guarantees.
 */

export interface TaskContext {
  taskId: string;
  workflowId: string;
  namespaceId: string;
  /** Resolved input — `${...}` expressions are already substituted. */
  input: Record<string, JsonValue>;
  /**
   * Fires on shutdown and on the task's own deadline.
   *
   * An executor doing I/O must pass this down, or a shutdown waits for its
   * slowest in-flight request instead of draining promptly.
   */
  signal: AbortSignal;
  /** Extends the lease. For anything that may outlive it. */
  heartbeat(): Promise<void>;
  /**
   * Output recorded by earlier passes of *this same task*.
   *
   * Empty for almost every task, because almost every task runs once. A task
   * that returns `IN_PROGRESS` is asked again later, and this is how it
   * remembers what it already did — a poll count, a cursor, an external job id.
   * Keeping that on the task row rather than in the executor is what makes it
   * survive a restart, and what stops a second server from starting over.
   */
  state: Record<string, JsonValue>;
}

export type TaskOutcome =
  | { status: 'COMPLETED'; output?: Record<string, JsonValue> }
  | {
      /**
       * Not finished; ask again in `callbackAfterSeconds`.
       *
       * The task keeps its place and its identity — same row, same attempt, no
       * retry consumed — but **releases its execution slot** rather than
       * sleeping in it. A task polling a slow job every minute for an hour
       * would otherwise hold a concurrency slot for the full hour while doing
       * nothing, which is the same reasoning that keeps `WAIT` off the queue.
       *
       * `output` is persisted before the slot is released, so whatever the next
       * pass needs to know arrives as `context.state`.
       */
      status: 'IN_PROGRESS';
      callbackAfterSeconds: number;
      output?: Record<string, JsonValue>;
    }
  | {
      status: 'FAILED';
      reason: string;
      /**
       * True when retrying cannot possibly help — a malformed URL, a blocked
       * host, a script that will never compile.
       *
       * Distinguishing this from a transient failure is most of the value of a
       * retry policy: without it, a permanently broken task burns its whole
       * budget and delays the error someone needs to see by minutes.
       */
      terminal?: boolean;
      /** Partial output worth recording, such as a failing HTTP response. */
      output?: Record<string, JsonValue>;
    };

export interface TaskExecutor {
  readonly type: TaskType;
  execute(context: TaskContext): Promise<TaskOutcome>;
}

/**
 * The pluggable task-type registry.
 *
 * Pluggable because the set of useful system tasks is open-ended and
 * install-specific — one deployment needs `JDBC`, another needs an internal
 * protocol nobody else has. A closed `switch` would make every addition a fork.
 */
export class TaskExecutorRegistry {
  private readonly executors = new Map<TaskType, TaskExecutor>();

  register(executor: TaskExecutor): this {
    // Replacing silently would let two registrations disagree about which one
    // is live, and the loser's absence is invisible until something misbehaves.
    if (this.executors.has(executor.type)) {
      throw new Error(`an executor for ${executor.type} is already registered`);
    }

    this.executors.set(executor.type, executor);
    return this;
  }

  /** Replaces an executor. Explicit, so an override is never accidental. */
  override(executor: TaskExecutor): this {
    this.executors.set(executor.type, executor);
    return this;
  }

  get(type: TaskType): TaskExecutor | undefined {
    return this.executors.get(type);
  }

  has(type: TaskType): boolean {
    return this.executors.has(type);
  }

  /** Every type this install can run. Drives what the runner leases. */
  get types(): TaskType[] {
    return [...this.executors.keys()];
  }
}
