/**
 * The loops that make the engine self-driving.
 *
 * Every sweeper, relay and reclaimer in this package exposes a single `run one
 * batch` method and nothing else — no timers, no scheduling, no lifecycle. That
 * is deliberate: a batch method is trivially testable and composes into
 * whatever process topology a deployment wants. This file is the one place that
 * turns them into running loops.
 *
 * Four properties every loop here has, each for a failure that is otherwise
 * silent:
 *
 *  - **Passes never overlap.** A pass that outlasts its interval must not have
 *    a second one start on top of it; two relays publishing the same batch, or
 *    two sweepers reclaiming the same lease, turns a slow database into a
 *    correctness problem instead of just a slow one.
 *  - **A throwing pass does not stop the loop.** An unhandled rejection in a
 *    sweeper would otherwise silently take that job out of service for the
 *    lifetime of the process, and everything would look healthy.
 *  - **A full batch runs again immediately.** After an outage there may be
 *    thousands of due timers; sleeping a full interval between fixed-size
 *    batches would take hours to drain what should take seconds.
 *  - **Intervals are jittered.** Ten replicas started by the same rollout
 *    otherwise sweep in lockstep forever, converting steady load into a
 *    periodic spike on exactly the rows that are already contended.
 */

/** One pass. Returns how many items it handled, which drives eager draining. */
export type BatchJob = () => Promise<number>;

export interface RunnerOptions {
  name: string;
  intervalMs: number;
  run: BatchJob;
  /**
   * Handle a pass that threw. Defaults to writing to stderr — a loop must never
   * die, but it must never fail silently either.
   */
  onError?: (error: unknown, name: string) => void;
  /**
   * Run again immediately when a pass returns at least this many items. Set to
   * 0 to always wait the full interval.
   */
  drainThreshold?: number;
  /** Fraction of the interval to randomise, 0–1. */
  jitter?: number;
}

export interface RunnerStats {
  name: string;
  passes: number;
  items: number;
  errors: number;
  running: boolean;
  lastError?: unknown;
  /** Delay until the next pass, as last scheduled. Undefined before the first. */
  nextDelayMs?: number;
}

export class BackgroundRunner {
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private stopped = true;
  private passes = 0;
  private items = 0;
  private errors = 0;
  private lastError?: unknown;
  private nextDelayMs?: number;
  /** A wake that arrived while a pass was running, honoured when it finishes. */
  private wakePending = false;

  constructor(private readonly options: RunnerOptions) {}

  get name(): string {
    return this.options.name;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  /**
   * Stops the loop and waits for any pass already in flight.
   *
   * Awaiting the in-flight pass is what makes shutdown graceful: a relay killed
   * mid-batch would leave events claimed but unpublished until their claim
   * expires, which looks like a stall to anyone watching.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  /** Runs one pass now, outside the schedule. For tests and manual triggers. */
  async runOnce(): Promise<number> {
    return this.options.run();
  }

  /**
   * Brings the next pass forward to now.
   *
   * This is what turns a polled loop into a triggered one. The decider's
   * interval exists so nothing is ever *missed*; it should not also decide how
   * quickly work is *noticed*, and without a wake-up every step of every
   * workflow pays half the interval in latency for no reason.
   *
   * A pass already in flight is not interrupted — it is about to re-read the
   * queue anyway. Instead the wake is remembered, so the pass that follows runs
   * immediately rather than sleeping through work that arrived while it ran.
   * Dropping it there is precisely the lost-wakeup shape this engine takes care
   * to avoid elsewhere.
   */
  wake(): void {
    if (this.stopped) return;
    if (this.inFlight) {
      this.wakePending = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.schedule(0);
  }

  stats(): RunnerStats {
    return {
      name: this.options.name,
      passes: this.passes,
      items: this.items,
      errors: this.errors,
      running: !this.stopped,
      lastError: this.lastError,
      nextDelayMs: this.nextDelayMs,
    };
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    // Recorded so operators — and tests — can see when a job will next run
    // without inferring it from a jittered interval.
    this.nextDelayMs = delayMs;

    this.timer = setTimeout(() => {
      // Held so `stop()` can await it. Assigned before the first `await` inside
      // `pass`, so there is no window where a pass is running but unobservable.
      this.inFlight = this.pass();
    }, delayMs);

    // A poller should never be the reason a process refuses to exit.
    this.timer.unref?.();
  }

  private async pass(): Promise<void> {
    let handled = 0;

    try {
      handled = await this.options.run();
      this.items += handled;
    } catch (error) {
      this.errors++;
      this.lastError = error;
      (this.options.onError ?? defaultOnError)(error, this.options.name);
    } finally {
      this.passes++;
      this.inFlight = undefined;
    }

    const threshold = this.options.drainThreshold ?? 0;
    const drain = threshold > 0 && handled >= threshold;
    const woken = this.wakePending;
    this.wakePending = false;
    this.schedule(drain || woken ? 0 : this.nextDelay());
  }

  private nextDelay(): number {
    const jitter = this.options.jitter ?? 0.2;
    if (jitter <= 0) return this.options.intervalMs;

    const spread = this.options.intervalMs * jitter;
    return Math.max(0, this.options.intervalMs - spread + Math.random() * spread * 2);
  }
}

function defaultOnError(error: unknown, name: string): void {
  console.error(`[node-flow] background runner "${name}" failed:`, error);
}

/**
 * A set of runners started and stopped together.
 *
 * Which runners a process holds is what `NODE_FLOW_ROLES` selects — see
 * {@link runnersForRoles}. Grouping them means shutdown is one await rather
 * than a list every caller has to keep in sync.
 */
export class RunnerHost {
  constructor(private readonly runners: BackgroundRunner[]) {}

  start(): void {
    for (const runner of this.runners) runner.start();
  }

  /** Stops every runner, waiting for all in-flight passes. */
  async stop(): Promise<void> {
    // Signalled in parallel, not in series: stopping ten runners one at a time
    // would take as long as the slowest ten passes back to back, and a
    // container gets a fixed grace period before it is killed.
    await Promise.all(this.runners.map((runner) => runner.stop()));
  }

  stats(): RunnerStats[] {
    return this.runners.map((runner) => runner.stats());
  }

  /**
   * Brings one runner's next pass forward, by name.
   *
   * Silently does nothing when this process does not hold that runner — an
   * `api`-only replica receiving a decide notification is the normal case, not
   * an error, and making it throw would mean every notifier needed to know the
   * process's roles.
   */
  wake(name: string): void {
    for (const runner of this.runners) {
      if (runner.name === name) runner.wake();
    }
  }
}
