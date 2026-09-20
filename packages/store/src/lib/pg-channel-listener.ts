import pg from 'pg';

/**
 * One `LISTEN`ing connection, kept alive.
 *
 * Extracted because there are now two things that need it — parked long-polls
 * and live execution streams — and the part worth sharing is the part nobody
 * looks at twice: dialling, collapsing concurrent dials, re-dialling after a
 * drop, and not holding the process open while it waits. Duplicating that is
 * how one copy quietly acquires a fix the other does not.
 *
 * What it deliberately does **not** do is interpret payloads or route them.
 * Routing is where the two callers differ entirely — one wakes a waiter keyed
 * by queue, the other feeds a subscription keyed by execution — and pushing
 * that in here would mean a class that knows about both.
 */

export interface PgChannelListenerOptions {
  url: string;
  /** Postgres channel name. Interpolated into `LISTEN`, so it must be a literal. */
  channel: string;
  onPayload: (payload: string) => void;
  /**
   * Called once each time a connection is (re-)established, including the
   * first. A subscriber that must not miss anything uses it to re-read from
   * durable state, because notifications raised during the gap are gone.
   */
  onConnect?: () => void;
  reconnectDelayMs?: number;
  onError?: (error: unknown) => void;
}

export class PgChannelListener {
  private client?: pg.Client;
  private stopped = true;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectingPromise?: Promise<void>;

  constructor(private readonly options: PgChannelListenerOptions) {}

  /** Opens the connection. Safe to call twice. */
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;

    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }

  get connected(): boolean {
    return this.client !== undefined;
  }

  private async connect(): Promise<void> {
    // Collapse concurrent callers onto one dial, or a burst of reconnects opens
    // a connection per caller.
    this.connectingPromise ??= this.dial().finally(() => {
      this.connectingPromise = undefined;
    });

    return this.connectingPromise;
  }

  private async dial(): Promise<void> {
    if (this.stopped) return;

    // A dedicated connection, not one from the pool. A pooled connection is
    // handed back after each query and would take its `LISTEN` registration
    // with it — or worse, leave it on a connection later used for something
    // else entirely.
    const client = new pg.Client({ connectionString: this.options.url });

    client.on('notification', (message) => {
      if (message.channel !== this.options.channel || !message.payload) return;
      this.options.onPayload(message.payload);
    });

    client.on('error', (error) => {
      this.options.onError?.(error);
      this.scheduleReconnect();
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${this.options.channel}`);
      this.client = client;
      this.options.onConnect?.();
    } catch (error) {
      this.options.onError?.(error);
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  /**
   * Re-dials after a drop.
   *
   * Notifications raised during the gap are lost and cannot be recovered.
   * Reconnecting restores latency, not correctness — which is why every caller
   * needs its own backstop: a timeout for a parked poll, a re-read for a
   * stream. Treating this as reliable delivery is the mistake it invites.
   */
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    this.client = undefined;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, this.options.reconnectDelayMs ?? 1000);

    this.reconnectTimer.unref?.();
  }
}
