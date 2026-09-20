import type { JsonValue } from '@node-flow-dev/core';
import { NodeFlowApiError, type LeasedTask, type NodeFlowClient } from './client.js';

/**
 * A worker: leases tasks, runs a handler, reports the result.
 *
 * The whole point of the language-agnostic model is that this file is small and
 * has no equivalent on the server — a worker is any process that can speak
 * HTTP. What it must get right is the handful of things that are easy to get
 * subtly wrong and painful to debug:
 *
 *  - never holding more work than it can run,
 *  - heartbeating anything long enough to outlive its lease,
 *  - distinguishing a retryable failure from a permanent one,
 *  - and finishing what it started when asked to shut down.
 */

/** Thrown by a handler to say "never retry this". */
export class TerminalTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalTaskError';
  }
}

export interface TaskContext {
  taskId: string;
  workflowId: string;
  /**
   * The task's `inputParameters`, resolved.
   *
   * Offloaded payloads are already inlined and `${secrets.x}` references
   * already substituted, so a handler sees plain values and never has to know
   * either mechanism exists.
   */
  input: Record<string, JsonValue>;
  /** Extends the lease. Call from any handler that may outlive it. */
  heartbeat(): Promise<void>;
  /** Aborts when the worker is shutting down, so a handler can bail out early. */
  signal: AbortSignal;
  /**
   * Writes a line to this task's log, visible beside the task in the dashboard.
   *
   * Buffered and sent in batches, and always flushed before the result is
   * reported — so the lines explaining a failure are there when someone opens
   * the failed task. Never throws: a logging problem must not fail the task.
   */
  log(message: string, level?: 'debug' | 'info' | 'warn' | 'error'): void;
}

export type TaskHandler = (
  context: TaskContext
) => Promise<Record<string, JsonValue> | void> | Record<string, JsonValue> | void;

export interface WorkerOptions {
  client: NodeFlowClient;
  queue: string;
  handler: TaskHandler;
  /** Identifies this process in the execution view. Defaults to host + pid. */
  workerId?: string;
  /** Maximum tasks in flight. The single most important knob here. */
  concurrency?: number;
  /** How long to park an idle poll. 0 disables long-poll. */
  waitSeconds?: number;
  leaseSeconds?: number;
  /** Heartbeat interval. Defaults to a third of the lease. */
  heartbeatSeconds?: number;
  onError?: (error: unknown, context: { queue: string; taskId?: string }) => void;
}

export interface WorkerStats {
  leased: number;
  completed: number;
  failed: number;
  inFlight: number;
  running: boolean;
}

export class Worker {
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly leaseSeconds: number;
  private readonly waitSeconds: number;
  private readonly heartbeatMs: number;

  private running = false;
  private loop?: Promise<void>;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private stats = { leased: 0, completed: 0, failed: 0 };

  constructor(private readonly options: WorkerOptions) {
    this.workerId = options.workerId ?? `${hostname()}-${process.pid}`;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.leaseSeconds = options.leaseSeconds ?? 60;
    this.waitSeconds = options.waitSeconds ?? 30;

    // A third of the lease: two heartbeats can be lost to a network blip before
    // the lease actually expires. Half would leave no margin at all.
    this.heartbeatMs = (options.heartbeatSeconds ?? Math.max(1, this.leaseSeconds / 3)) * 1000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /**
   * Stops leasing and waits for in-flight tasks to finish.
   *
   * Draining rather than abandoning is the difference between a rolling deploy
   * that is invisible and one that produces a burst of timed-out tasks every
   * time.
   *
   * The abort does double duty: it cancels the *parked long-poll* so shutdown
   * is immediate rather than waiting out `waitSeconds`, and it is handed to
   * each handler so a long wait can be cut short. The first matters more than
   * it looks — a 30-second poll would otherwise make every shutdown take 30
   * seconds, which is longer than the grace period most orchestrators allow
   * before SIGKILL.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.shutdown.abort();

    await this.loop;
    await Promise.allSettled([...this.inFlight]);
  }

  getStats(): WorkerStats {
    return { ...this.stats, inFlight: this.inFlight.size, running: this.running };
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        const capacity = this.concurrency - this.inFlight.size;

        // At capacity: wait for a slot rather than leasing work this process
        // cannot start. Leasing it anyway would hold a lease the task is not
        // being worked under, and the server would reclaim it as abandoned.
        if (capacity <= 0) {
          await Promise.race(this.inFlight);
          continue;
        }

        const tasks = await this.options.client.lease({
          queue: this.options.queue,
          workerId: this.workerId,
          count: capacity,
          waitSeconds: this.waitSeconds,
          leaseSeconds: this.leaseSeconds,
          // Abandons the parked request on shutdown. Without this, `stop()`
          // cannot return until the poll times out by itself.
          signal: this.shutdown.signal,
        });

        this.stats.leased += tasks.length;
        for (const task of tasks) this.track(task);
      } catch (error) {
        // An aborted poll during shutdown is the expected path, not a failure.
        if (!this.running) break;

        this.options.onError?.(error, { queue: this.options.queue });

        // Back off before retrying. Without this, a server that is down turns
        // every worker into a tight reconnect loop, which is precisely the
        // extra load it least needs while recovering.
        await this.pause(error instanceof NodeFlowApiError && !error.retryable ? 5_000 : 1_000);
      }
    }
  }

  private track(task: LeasedTask): void {
    const promise = this.execute(task).finally(() => {
      this.inFlight.delete(promise);
    });

    this.inFlight.add(promise);
  }

  private async execute(task: LeasedTask): Promise<void> {
    const beat = setInterval(() => {
      void this.options.client
        .heartbeat({
          taskId: task.taskId,
          queueName: this.options.queue,
          leaseToken: task.leaseToken,
          leaseSeconds: this.leaseSeconds,
        })
        .catch((error) => this.options.onError?.(error, { queue: this.options.queue, taskId: task.taskId }));
    }, this.heartbeatMs);

    const logs = new LogBuffer(async (lines) => {
      await this.options.client.appendLogs({
        taskId: task.taskId,
        workflowId: task.workflowId,
        leaseToken: task.leaseToken,
        logs: lines,
      });
    }, (error) => this.options.onError?.(error, { queue: this.options.queue, taskId: task.taskId }));

    try {
      const output = await this.options.handler({
        taskId: task.taskId,
        workflowId: task.workflowId,
        input: task.input ?? {},
        log: (message, level) => logs.push(message, level),
        heartbeat: () =>
          this.options.client.heartbeat({
            taskId: task.taskId,
            queueName: this.options.queue,
            leaseToken: task.leaseToken,
            leaseSeconds: this.leaseSeconds,
          }),
        signal: this.shutdown.signal,
      });

      await logs.close();
      await this.report(task, 'COMPLETED', output ?? {});
      this.stats.completed++;
    } catch (error) {
      // A handler that knows the work can never succeed says so, and the engine
      // skips the retry budget entirely. Retrying a malformed payload twenty
      // times helps nobody and delays the failure the caller needs to see.
      const terminal = error instanceof TerminalTaskError;

      this.options.onError?.(error, { queue: this.options.queue, taskId: task.taskId });
      this.stats.failed++;

      // The failure itself is the line most worth having in the task's log.
      logs.push(error instanceof Error ? (error.stack ?? error.message) : String(error), 'error');
      await logs.close();

      await this.report(
        task,
        terminal ? 'FAILED_WITH_TERMINAL_ERROR' : 'FAILED',
        undefined,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      clearInterval(beat);
      await logs.close();
    }
  }

  /**
   * Reports a result, tolerating a lost lease.
   *
   * A 409 means the lease expired and another worker already has the task — so
   * this result is genuinely unwanted, and treating it as an error would fill
   * the log with noise during exactly the incident that caused the expiry.
   */
  private async report(
    task: LeasedTask,
    status: 'COMPLETED' | 'FAILED' | 'FAILED_WITH_TERMINAL_ERROR',
    output?: Record<string, JsonValue>,
    reason?: string
  ): Promise<void> {
    try {
      await this.options.client.report({
        taskId: task.taskId,
        queueName: this.options.queue,
        workflowId: task.workflowId,
        leaseToken: task.leaseToken,
        status,
        output,
        reason,
      });
    } catch (error) {
      if (error instanceof NodeFlowApiError && error.code === 'LEASE_EXPIRED') return;
      this.options.onError?.(error, { queue: this.options.queue, taskId: task.taskId });
    }
  }

  /** Sleeps, but wakes immediately on shutdown. */
  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      this.shutdown.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}

function hostname(): string {
  try {
    // Optional: an SDK that crashes on import in a browser or edge runtime
    // because `node:os` is missing would be worse than an anonymous worker id.
    return process.env['HOSTNAME'] ?? 'worker';
  } catch {
    return 'worker';
  }
}

/**
 * Batches a task's log lines: sent every two seconds, at 50 lines, and on close.
 *
 * One request per line would make a chatty handler spend more time logging than
 * working. Send failures are reported and dropped, never thrown — losing a log
 * line must not fail the task it describes.
 */
class LogBuffer {
  private lines: { message: string; level?: 'debug' | 'info' | 'warn' | 'error' }[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private sending: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly send: (lines: { message: string; level?: 'debug' | 'info' | 'warn' | 'error' }[]) => Promise<void>,
    private readonly onError: (error: unknown) => void
  ) {}

  push(message: string, level?: 'debug' | 'info' | 'warn' | 'error'): void {
    if (this.closed || message === '') return;
    this.lines.push({ message: String(message), level });
    if (this.lines.length >= 50) this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 2000);
      this.timer.unref?.();
    }
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.lines.length === 0) return;
    const batch = this.lines;
    this.lines = [];
    // Chained, so batches arrive in the order they were written.
    this.sending = this.sending.then(() => this.send(batch)).catch((error) => this.onError(error));
  }

  async close(): Promise<void> {
    this.flush();
    await this.sending;
    this.closed = true;
  }
}
