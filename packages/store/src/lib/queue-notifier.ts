import { EventEmitter } from 'node:events';
import { PgChannelListener } from './pg-channel-listener.js';

/**
 * Wakes a parked long-poll the moment a task is enqueued.
 *
 * Without it, an idle worker asking for work gets an empty answer and sleeps —
 * so a task enqueued a millisecond later waits out the worker's whole poll
 * interval. Across a fleet that is the difference between millisecond and
 * multi-second task start latency, and it is pure waiting rather than work.
 *
 * **This is an optimisation, never a correctness guarantee.** `NOTIFY` reaches
 * only the connections listening at that instant: a replica whose listener
 * connection has dropped, or which is mid-reconnect, silently misses every
 * notification in the gap. Every long-poll therefore also has a timeout, and
 * the timeout is what makes the design correct. Treating notify as reliable is
 * how a fleet quietly stops picking up work after a network blip.
 *
 * One channel for the whole cluster rather than one per queue: Postgres channel
 * names are global and a busy install has thousands of queues, so per-queue
 * channels would mean thousands of `LISTEN`s per replica. Routing happens in
 * process, where it is free.
 */

export const TASK_CHANNEL = 'node_flow_tasks';

/** `namespaceId:queueName` — the key a waiter subscribes on. */
export function queueKey(namespaceId: string, queueName: string): string {
  return `${namespaceId}:${queueName}`;
}

/** A parked wait that can be given up before it resolves. */
export interface QueueWaiter {
  notified: Promise<boolean>;
  /** Releases the listener and timer. Idempotent. */
  cancel(): void;
}

export interface QueueNotifierOptions {
  url: string;
  /** Delay before re-dialling a dropped listener connection. */
  reconnectDelayMs?: number;
  onError?: (error: unknown) => void;
}

export class QueueNotifier {
  private readonly emitter = new EventEmitter();
  private readonly listener: PgChannelListener;
  private stopped = true;
  /** Every parked waiter, so shutdown can settle them instead of waiting. */
  private readonly waiters = new Set<(notified: boolean) => void>();

  constructor(options: QueueNotifierOptions) {
    // The payload *is* the routing key — `namespaceId:queueName`, built by
    // `queueKey` on the enqueue side — so there is nothing to parse.
    this.listener = new PgChannelListener({
      url: options.url,
      channel: TASK_CHANNEL,
      reconnectDelayMs: options.reconnectDelayMs,
      onError: options.onError,
      onPayload: (payload) => this.emitter.emit(payload),
    });

    // A busy queue may have many workers parked on it, and Node warns at ten
    // listeners on the assumption they are a leak. Here they are the design.
    this.emitter.setMaxListeners(0);
  }

  /** Opens the listener connection. Safe to call twice. */
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.listener.start();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    // Before closing the connection, not after: a parked poll is an in-flight
    // HTTP request, and releasing them is what makes shutdown prompt.
    this.releaseAll();
    this.emitter.removeAllListeners();

    await this.listener.stop();
  }

  /**
   * Settles every parked waiter immediately, as if it had timed out.
   *
   * Called at the start of shutdown, and it is the difference between a prompt
   * stop and one that hangs. A parked long-poll is an *in-flight HTTP request*
   * as far as the server is concerned, so `close()` waits for it — for the full
   * poll duration, since the whole point of the park is that it does not
   * return early. A worker aborting its side does not help: the client socket
   * closes, but the handler keeps waiting.
   *
   * Each released poll re-checks the queue and returns whatever it finds, so
   * nothing is lost — a worker simply gets an empty answer a little early and
   * polls again against whichever replica is still up.
   */
  releaseAll(): void {
    for (const settle of [...this.waiters]) settle(false);
    this.waiters.clear();
  }

  /**
   * Parks until a task lands on this queue, or `timeoutMs` elapses.
   *
   * Returns a **cancellable** waiter rather than a bare promise, and that
   * matters more than it looks. A caller that finds work on its first read no
   * longer needs the wait — and simply abandoning the promise leaves its
   * listener and timer registered until the timeout expires. At a 30-second
   * wait and a few hundred leases a second, that is tens of thousands of dead
   * closures held for no reason, and a `waiting()` metric that reads as a
   * fleet-wide stall when nothing is stalled.
   *
   * `notified` is for metrics only: the caller must re-check the queue either
   * way, because a notification may be for a task another replica has taken.
   */
  waitFor(namespaceId: string, queueName: string, timeoutMs: number): QueueWaiter {
    const key = queueKey(namespaceId, queueName);

    // Already shutting down: do not park a request that would be released a
    // moment later anyway.
    if (this.stopped) return { notified: Promise.resolve(false), cancel: () => undefined };

    let settle!: (notified: boolean) => void;

    const notified = new Promise<boolean>((resolve) => {
      settle = (value: boolean) => {
        clearTimeout(timer);
        this.emitter.off(key, onNotify);
        this.waiters.delete(settle);
        resolve(value);
      };

      const onNotify = () => settle(true);
      const timer = setTimeout(() => settle(false), timeoutMs);
      // Never hold the process open for a parked poll.
      timer.unref?.();

      this.emitter.on(key, onNotify);
      this.waiters.add(settle);
    });

    return { notified, cancel: () => settle(false) };
  }

  /** Listener count, for tests and for a "parked pollers" metric. */
  waiting(namespaceId: string, queueName: string): number {
    return this.emitter.listenerCount(queueKey(namespaceId, queueName));
  }

  get connected(): boolean {
    return this.listener.connected;
  }

}
