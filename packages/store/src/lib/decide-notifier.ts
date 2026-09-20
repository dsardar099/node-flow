import { DECIDE_CHANNEL } from './decide-queue.repository.js';
import { PgChannelListener } from './pg-channel-listener.js';

/**
 * Wakes the decider the instant an evaluation is queued.
 *
 * The decider's interval exists so a wake-up can never be *missed*. Left on its
 * own it also decides how quickly work is *noticed*, and that is a different
 * question with a much worse answer: every step of every workflow waits half an
 * interval before anyone looks at it. In a five-task workflow that is five
 * waits, and it is the single largest component of end-to-end latency on an
 * otherwise idle system — the load harness measures it directly.
 *
 * So `enqueue` raises a `NOTIFY` and this turns it into a wake-up. The
 * notification is **advisory**: it reaches only the connections listening at
 * that moment, so a replica that is reconnecting misses every notification in
 * the gap. That is survivable precisely because the interval remains — the loop
 * is still a loop, this only shortens the wait.
 *
 * Coalescing is free: `wake()` on a runner mid-pass sets a flag rather than
 * queueing another pass, so a thousand notifications in a burst cost one extra
 * evaluation, not a thousand.
 */

export interface DecideNotifierOptions {
  url: string;
  /** Called for each notification. Normally `host.wake('decider')`. */
  onWake: () => void;
  reconnectDelayMs?: number;
  onError?: (error: unknown) => void;
}

export class DecideNotifier {
  private readonly listener: PgChannelListener;

  constructor(options: DecideNotifierOptions) {
    this.listener = new PgChannelListener({
      url: options.url,
      channel: DECIDE_CHANNEL,
      reconnectDelayMs: options.reconnectDelayMs,
      onError: options.onError,
      // The payload is the workflow id, and it is deliberately ignored: the
      // decider reads the queue itself, so routing a specific workflow here
      // would be a second, weaker copy of that read — one that a missed
      // notification turns into a stranded workflow.
      onPayload: () => options.onWake(),
      // A fresh connection may have missed notifications while it was down, so
      // the first thing a reconnect does is ask for a pass.
      onConnect: () => options.onWake(),
    });
  }

  async start(): Promise<void> {
    await this.listener.start();
  }

  async stop(): Promise<void> {
    await this.listener.stop();
  }

  get connected(): boolean {
    return this.listener.connected;
  }
}
