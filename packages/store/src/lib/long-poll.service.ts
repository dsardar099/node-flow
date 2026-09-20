import type { QueuedTask } from './task-queue.repository.js';
import type { QueueNotifier } from './queue-notifier.js';
import type { DispatchPolicy } from './concurrency.repository.js';
import type { TaskDispatchService } from './task-dispatch.service.js';

/**
 * A lease that waits for work instead of returning empty.
 *
 * Conductor's workers poll on a fixed interval, which forces a choice between
 * task-start latency and database load: poll every 100ms and a thousand idle
 * workers generate ten thousand pointless queries a second; poll every five
 * seconds and every task waits up to five seconds to start. Parking the request
 * removes the trade-off — an idle worker costs one held connection and no
 * queries at all, and a task starts within a millisecond of being enqueued.
 */

export interface LongPollOptions {
  namespaceId: string;
  queueName: string;
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
  policy?: DispatchPolicy;
  /** How long to hold the request open when there is no work. */
  waitMs: number;
}

export interface LongPollResult {
  tasks: QueuedTask[];
  /** True if the wait was cut short by a notification. For metrics. */
  wokenByNotification: boolean;
  waitedMs: number;
}

export class LongPollService {
  constructor(
    private readonly dispatch: TaskDispatchService,
    private readonly notifier?: QueueNotifier
  ) {}

  /**
   * Leases work, waiting up to `waitMs` for some to appear.
   *
   * **The subscription is registered before the queue is read, and that
   * ordering is the whole correctness argument** — the same shape as the
   * claim-before-read rule in the decider. Check first and subscribe second,
   * and a task enqueued in the window between them notifies nobody: the worker
   * then parks for the full timeout while its work sits ready. It is not lost,
   * merely late, but at a 30-second poll that is a 30-second stall on a queue
   * that is not even busy.
   *
   * Subscribing first makes the race harmless in the other direction: a
   * notification arriving before the read simply resolves the wait immediately
   * and costs one extra lease attempt.
   */
  async lease(options: LongPollOptions): Promise<LongPollResult> {
    const started = Date.now();

    const attempt = () =>
      this.dispatch.lease({
        namespaceId: options.namespaceId,
        queueName: options.queueName,
        workerId: options.workerId,
        limit: options.limit,
        leaseSeconds: options.leaseSeconds,
        policy: options.policy,
      });

    // No notifier configured, or no time to wait: behave as a plain lease.
    if (!this.notifier || options.waitMs <= 0) {
      return { tasks: await attempt(), wokenByNotification: false, waitedMs: 0 };
    }

    const waiter = this.notifier.waitFor(
      options.namespaceId,
      options.queueName,
      options.waitMs
    );

    const immediate = await attempt();
    if (immediate.length > 0) {
      // Work was already there. Cancel rather than abandon: an abandoned wait
      // keeps its listener and timer alive for the full `waitMs`, and on a busy
      // queue that accumulates one dead closure per lease.
      waiter.cancel();
      return { tasks: immediate, wokenByNotification: false, waitedMs: Date.now() - started };
    }

    const wokenByNotification = await waiter.notified;

    // Re-check regardless of *why* the wait ended. A notification may have been
    // for a task another replica has already taken, and a timeout may still
    // have raced an arrival — so the answer always comes from the queue, never
    // from the reason for waking.
    return {
      tasks: await attempt(),
      wokenByNotification,
      waitedMs: Date.now() - started,
    };
  }
}
