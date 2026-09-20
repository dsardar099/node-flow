import { EventEmitter } from 'node:events';
import { PgChannelListener } from './pg-channel-listener.js';

/**
 * Tells a live execution view that something happened, the moment it commits.
 *
 * The alternative is polling, and the reason not to poll is not elegance: a
 * dashboard open on twenty executions at one second each is twenty queries a
 * second doing nothing, and it is *still* a second late. Notification makes the
 * common case free and instant.
 *
 * **What arrives is a cursor, never the event.** The trigger sends
 * `workflowId:seq`, and a subscriber reads `WorkflowEvents` for everything
 * after the sequence it last saw. That indirection is what makes the whole
 * design survive its own failure modes:
 *
 *  - Postgres caps a notification at 8000 bytes, and task payloads are
 *    unbounded — carrying events inline would break on exactly the large
 *    payloads most worth watching.
 *  - Notifications raised while the listener connection is down are gone.
 *    Because a subscriber reads *from its own cursor* rather than consuming a
 *    delivery, a missed notification costs latency and nothing else: the next
 *    one, or the backstop poll, returns the gap along with the new event.
 *
 * So this is an optimisation layered over a durable log, exactly as
 * `QueueNotifier` is an optimisation layered over a timeout. Treating it as
 * delivery is the mistake it invites, and `onConnect` exists to make recovery
 * from a drop immediate rather than eventual.
 */

export const WORKFLOW_EVENT_CHANNEL = 'node_flow_workflow_events';

/** Raised when the listener reconnects, so subscribers can close their gap. */
const RECONNECTED = 'reconnected';

export interface WorkflowEventNotifierOptions {
  url: string;
  reconnectDelayMs?: number;
  onError?: (error: unknown) => void;
}

export class WorkflowEventNotifier {
  private readonly emitter = new EventEmitter();
  private readonly listener: PgChannelListener;
  private stopped = true;

  constructor(options: WorkflowEventNotifierOptions) {
    // A popular execution may be watched by many browser tabs, and Node warns
    // at ten listeners on the assumption they are a leak. Here they are the
    // design.
    this.emitter.setMaxListeners(0);

    this.listener = new PgChannelListener({
      url: options.url,
      channel: WORKFLOW_EVENT_CHANNEL,
      reconnectDelayMs: options.reconnectDelayMs,
      onError: options.onError,
      onPayload: (payload) => this.route(payload),
      // Deliberately fired on the *first* connection too. A subscriber that
      // registered before the connection came up would otherwise sit waiting
      // for an event it has already missed.
      onConnect: () => this.emitter.emit(RECONNECTED),
    });
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.listener.start();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.emitter.removeAllListeners();
    await this.listener.stop();
  }

  get connected(): boolean {
    return this.listener.connected;
  }

  /**
   * Calls `onEvent` with the newest sequence number seen for this execution.
   *
   * The number is a **hint about how far ahead the log is**, not a delivery.
   * Two notifications may collapse into one, and one may arrive for a sequence
   * the subscriber has already read; both are fine, because the subscriber
   * reads from its own cursor. What it must never do is treat the number as the
   * next event and skip to it.
   *
   * Returns an unsubscribe function. Not optional and not best-effort: a
   * dashboard opening and closing executions all day leaks one listener per
   * view otherwise, and an `EventEmitter` with no cap will hold every one.
   */
  subscribe(workflowId: string, onEvent: (seq: number) => void): () => void {
    this.emitter.on(workflowId, onEvent);
    return () => this.emitter.off(workflowId, onEvent);
  }

  /**
   * Calls `onReconnect` each time the listener (re-)establishes its connection.
   *
   * A stream that only listened for its own execution would stay silent
   * forever after a drop that happened to span its last event.
   */
  onReconnect(handler: () => void): () => void {
    this.emitter.on(RECONNECTED, handler);
    return () => this.emitter.off(RECONNECTED, handler);
  }

  /** Subscriber count for one execution — for tests and a "watchers" metric. */
  watching(workflowId: string): number {
    return this.emitter.listenerCount(workflowId);
  }

  /**
   * Splits `workflowId:seq`.
   *
   * A malformed payload is dropped rather than thrown: this runs on the pg
   * client's `notification` handler, where a throw would take down the listener
   * connection and stop every stream in the process — an enormous blast radius
   * for one bad string.
   */
  private route(payload: string): void {
    const separator = payload.lastIndexOf(':');
    if (separator <= 0) return;

    const workflowId = payload.slice(0, separator);
    const seq = Number(payload.slice(separator + 1));
    if (!Number.isFinite(seq)) return;

    this.emitter.emit(workflowId, seq);
  }
}
