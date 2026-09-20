import { TaskStatus, requireInline, type JsonValue, type TaskType } from '@node-flow-dev/core';
import type { TaskExecutorRegistry } from '@node-flow-dev/tasks';
import type { PayloadStore } from './payload-store.js';
import type { SecretResolver } from './secret-resolver.js';
import type { TaskDispatchService } from './task-dispatch.service.js';
import type { QueuedTask } from './task-queue.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Runs the task types the server implements itself.
 *
 * Structurally this is a worker that happens to live in-process: it leases
 * through the same queue, holds the same fencing token, heartbeats the same
 * way, and its results go through the same `report` path. That is the point —
 * a separate execution path would have to re-earn retries, timeouts,
 * concurrency caps, lease expiry and the fencing guarantee, and would get at
 * least one of them wrong.
 *
 * One batch per pass, driven by the same `BackgroundRunner` as every other
 * loop, so it inherits non-overlapping passes, error isolation and eager
 * draining without restating any of it.
 */

export interface SystemTaskRunnerOptions {
  /** In-flight executions across all types. The main throughput knob. */
  concurrency?: number;
  leaseSeconds?: number;
  /** Hard ceiling on one execution, whatever the executor thinks. */
  maxExecutionMs?: number;
  onError?: (error: unknown, context: { taskId?: string; type?: string }) => void;
}

export class SystemTaskRunner {
  private readonly concurrency: number;
  private readonly leaseSeconds: number;
  private readonly maxExecutionMs: number;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private readonly workerId: string;

  constructor(
    private readonly registry: TaskExecutorRegistry,
    private readonly dispatch: TaskDispatchService,
    private readonly workflows: WorkflowRepository,
    private readonly payloads?: PayloadStore,
    private readonly options: SystemTaskRunnerOptions = {},
    /** Substitutes `${secrets.x}` into the copy handed to an executor. */
    private readonly secrets?: SecretResolver
  ) {
    this.concurrency = Math.max(1, options.concurrency ?? 20);
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.maxExecutionMs = options.maxExecutionMs ?? 300_000;
    this.workerId = `system-${process.pid}`;
  }

  /**
   * Leases and runs one batch. Returns how many tasks it started.
   *
   * It leases only what it has capacity for. Taking more would hold leases on
   * tasks nothing is working on, and the reclaimer would eventually take them
   * back as abandoned — turning a busy server into one that looks broken.
   */
  async runBatch(): Promise<number> {
    const capacity = this.concurrency - this.inFlight.size;
    if (capacity <= 0) return 0;

    const types = this.registry.types;
    if (types.length === 0) return 0;

    // Through the dispatch service, never the queue repository directly: it is
    // what keeps the queue lease and the task row's fencing token in step.
    const leased = await this.dispatch.leaseSystemTasks({
      types,
      workerId: this.workerId,
      leaseSeconds: this.leaseSeconds,
      limit: capacity,
    });

    for (const task of leased) this.track(task);
    return leased.length;
  }

  /** Waits for in-flight executions. Called on shutdown. */
  async drain(): Promise<void> {
    this.shutdown.abort();
    await Promise.allSettled([...this.inFlight]);
  }

  get running(): number {
    return this.inFlight.size;
  }

  private track(task: QueuedTask): void {
    const promise = this.execute(task).finally(() => {
      this.inFlight.delete(promise);
    });

    this.inFlight.add(promise);
  }

  private async execute(task: QueuedTask): Promise<void> {
    const type = task.taskType as TaskType | undefined;
    const executor = type ? this.registry.get(type) : undefined;

    if (!executor) {
      // Leased something nothing can run. Failing it terminally beats leaving
      // it to expire and be retried forever by a server that will never have
      // an executor for it.
      await this.report(task, {
        status: 'FAILED',
        reason: `no executor registered for task type ${String(type)}`,
        terminal: true,
      });
      return;
    }

    // The lease is renewed while the task runs, so a slow HTTP call is not
    // reclaimed out from under itself. A third of the lease leaves room for two
    // heartbeats to be lost to a blip.
    const beat = setInterval(
      () => {
        void this.dispatch
          .heartbeat(task.queueName, task.taskId, task.leaseToken, this.leaseSeconds)
          .catch((error) => this.options.onError?.(error, { taskId: task.taskId }));
      },
      Math.max(1_000, (this.leaseSeconds / 3) * 1000)
    );

    // A ceiling the executor cannot exceed even if its own timeout is wrong or
    // absent. Without it one hung call holds a concurrency slot forever.
    const deadline = AbortSignal.timeout(this.maxExecutionMs);

    try {
      const { input, state } = await this.stateFor(task);

      const outcome = await executor.execute({
        taskId: task.taskId,
        workflowId: task.workflowId,
        namespaceId: task.namespaceId,
        input,
        state,
        signal: AbortSignal.any([this.shutdown.signal, deadline]),
        heartbeat: async () => {
          await this.dispatch.heartbeat(
            task.queueName,
            task.taskId,
            task.leaseToken,
            this.leaseSeconds
          );
        },
      });

      if (outcome.status === 'IN_PROGRESS') {
        await this.defer(task, outcome);
      } else {
        await this.report(task, outcome);
      }
    } catch (error) {
      // An executor that throws instead of returning a failure is a bug in the
      // executor, not a reason to lose the task. Recording it as a failure lets
      // the retry policy handle it and puts the message where it can be read.
      this.options.onError?.(error, { taskId: task.taskId, type: task.taskType });

      await this.report(task, {
        status: 'FAILED',
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearInterval(beat);
    }
  }

  /**
   * The task's input and whatever earlier passes recorded.
   *
   * An executor must never be handed a `ref` — it would silently see an empty
   * object and, for an `HTTP` task, POST nothing at all while reporting success.
   */
  private async stateFor(
    task: QueuedTask
  ): Promise<{ input: Record<string, JsonValue>; state: Record<string, JsonValue> }> {
    const row = await this.workflows.findTaskById(task.workflowId, task.taskId);
    if (!row) return { input: {}, state: {} };

    const stored = this.payloads
      ? ((await this.payloads.resolve(row.input)) ?? {})
      : requireInline(row.input);

    // Secrets are substituted here and nowhere else. `stored` is what the
    // database holds and keeps holding; `input` is a copy that exists only for
    // the length of this execution. See `SecretResolver`.
    const input = this.secrets
      ? await this.secrets.resolve(task.namespaceId, stored, task.workflowId)
      : stored;

    // Output on a task that has not finished is progress from an earlier pass,
    // never a result. Resolved the same way as input because it is subject to
    // the same offload threshold.
    const state = this.payloads
      ? ((await this.payloads.resolve(row.output)) ?? {})
      : (row.output ? requireInline(row.output) : {});

    return { input, state };
  }

  /**
   * Hands back the execution slot until the task asks to be looked at again.
   *
   * A refusal means the lease expired mid-poll and another runner owns the task
   * now. Doing nothing is right: that runner will carry on, and this one must
   * not write over its progress.
   */
  private async defer(
    task: QueuedTask,
    outcome: { callbackAfterSeconds: number; output?: Record<string, JsonValue> }
  ): Promise<void> {
    try {
      await this.dispatch.reschedule({
        queueName: task.queueName,
        workflowId: task.workflowId,
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        delaySeconds: Math.max(0, outcome.callbackAfterSeconds),
        output: outcome.output,
      });
    } catch (error) {
      this.options.onError?.(error, { taskId: task.taskId, type: task.taskType });
    }
  }

  private async report(
    task: QueuedTask,
    outcome:
      | { status: 'COMPLETED'; output?: Record<string, JsonValue> }
      | { status: 'FAILED'; reason: string; terminal?: boolean; output?: Record<string, JsonValue> }
  ): Promise<void> {
    const status =
      outcome.status === 'COMPLETED'
        ? TaskStatus.COMPLETED
        : outcome.terminal
          ? TaskStatus.FAILED_WITH_TERMINAL_ERROR
          : TaskStatus.FAILED;

    try {
      await this.dispatch.report({
        namespaceId: task.namespaceId,
        queueName: task.queueName,
        workflowId: task.workflowId,
        taskId: task.taskId,
        leaseToken: task.leaseToken,
        status,
        output: outcome.output,
        reason: outcome.status === 'FAILED' ? outcome.reason : undefined,
      });
    } catch (error) {
      // A refused report means the lease expired and another runner has the
      // task — genuinely unwanted, and not worth logging as a fault during the
      // incident that caused the expiry.
      this.options.onError?.(error, { taskId: task.taskId, type: task.taskType });
    }
  }
}
