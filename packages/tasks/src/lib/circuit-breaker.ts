/**
 * Circuit breakers for the tasks that call something outside this process.
 *
 * The failure this exists for: a dependency goes down, every task calling it
 * starts taking its full timeout, and those tasks occupy the system-task runner
 * for thirty seconds each. One dead host then consumes the capacity that every
 * *other* workflow needs, and the outage spreads to work that had nothing to do
 * with it. Failing fast is what stops that, and it is also kinder to the
 * dependency, which is usually trying to recover under a retry storm.
 *
 * ## The decisions worth knowing
 *
 * **Per process, not cluster-wide.** A shared breaker would need shared state —
 * a second dependency — to protect against a dependency being down, and it
 * would make the breaker itself a thing that can fail. Every replica observes
 * the same outage within a window or two, so the benefit is small and the cost
 * is architectural. Envoy and Hystrix are per-instance for the same reason.
 *
 * **Only server-side failures count.** A 404 or a 422 is the caller's problem
 * and says nothing about the dependency's health; counting it would let one
 * workflow with a bad URL open the breaker for every other workflow calling the
 * same host. Timeouts, connection errors, 5xx and 429 count.
 *
 * **An open breaker fails the task, but never terminally.** The retry policy
 * still owns what happens next — backoff, jitter, the retry budget. A terminal
 * failure here would turn a transient outage into permanently dead workflows,
 * which is precisely the thing the breaker is supposed to prevent.
 *
 * **Half-open admits exactly one probe.** Letting the whole backlog through the
 * moment the window expires is how a recovering service is knocked over again.
 */

export interface CircuitBreakerOptions {
  /** Off by default: a breaker that nobody asked for changes failure behaviour. */
  enabled?: boolean;
  /** Outcomes older than this are forgotten. */
  windowMs?: number;
  /** Below this many outcomes in the window, never open — small samples lie. */
  minimumRequests?: number;
  /** Failure fraction at or above which the breaker opens. */
  failureRatio?: number;
  /** How long it stays open before admitting a probe. */
  openMs?: number;
  /** The ceiling when repeated probes keep failing and the wait doubles. */
  maxOpenMs?: number;
  now?: () => number;
}

const DEFAULTS = {
  windowMs: 30_000,
  minimumRequests: 10,
  failureRatio: 0.5,
  openMs: 5_000,
  maxOpenMs: 60_000,
};

export type CircuitState = 'closed' | 'open' | 'half-open';

interface Circuit {
  outcomes: { at: number; ok: boolean }[];
  openedAt?: number;
  /** Grows while probes keep failing, so a long outage is not probed every 5s. */
  openMs: number;
  /** True while a probe is in flight, so only one request tests the water. */
  probing: boolean;
}

export class CircuitOpenError extends Error {
  constructor(
    readonly key: string,
    readonly retryAfterMs: number
  ) {
    super(`circuit open for ${key}; not attempted (retry in ~${Math.ceil(retryAfterMs / 1000)}s)`);
  }
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, Circuit>();
  private readonly options: Required<Omit<CircuitBreakerOptions, 'enabled' | 'now'>> & {
    enabled: boolean;
    now: () => number;
  };

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      enabled: options.enabled ?? false,
      windowMs: options.windowMs ?? DEFAULTS.windowMs,
      minimumRequests: options.minimumRequests ?? DEFAULTS.minimumRequests,
      failureRatio: options.failureRatio ?? DEFAULTS.failureRatio,
      openMs: options.openMs ?? DEFAULTS.openMs,
      maxOpenMs: options.maxOpenMs ?? DEFAULTS.maxOpenMs,
      now: options.now ?? (() => Date.now()),
    };
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  /**
   * Throws `CircuitOpenError` when the call must not be attempted.
   *
   * Throwing rather than returning a boolean so a caller cannot forget to check
   * it — the one line that matters is impossible to leave out by accident.
   */
  assertAllowed(key: string): void {
    if (!this.options.enabled) return;

    const circuit = this.circuits.get(key);
    // `=== undefined`, not falsy: a breaker opened at timestamp 0 is open.
    if (circuit?.openedAt === undefined) return;

    const elapsed = this.options.now() - circuit.openedAt;
    if (elapsed < circuit.openMs) {
      throw new CircuitOpenError(key, circuit.openMs - elapsed);
    }

    // The window has passed. Exactly one caller gets through; everyone else
    // keeps failing fast until that probe reports back.
    if (circuit.probing) {
      throw new CircuitOpenError(key, Math.max(circuit.openMs - elapsed, 250));
    }
    circuit.probing = true;
  }

  /** The state a key is in, for metrics and for tests. */
  stateOf(key: string): CircuitState {
    const circuit = this.circuits.get(key);
    if (circuit?.openedAt === undefined) return 'closed';
    return this.options.now() - circuit.openedAt >= circuit.openMs ? 'half-open' : 'open';
  }

  record(key: string, ok: boolean): void {
    if (!this.options.enabled) return;

    const circuit = this.circuitFor(key);
    const now = this.options.now();

    // A probe's result decides the next state on its own: it is the only
    // evidence about *now*, where the window is full of evidence about the
    // outage.
    if (circuit.probing) {
      circuit.probing = false;
      if (ok) {
        circuit.openedAt = undefined;
        circuit.openMs = this.options.openMs;
        circuit.outcomes = [];
      } else {
        circuit.openedAt = now;
        circuit.openMs = Math.min(circuit.openMs * 2, this.options.maxOpenMs);
      }
      return;
    }

    circuit.outcomes.push({ at: now, ok });
    this.forgetOld(circuit, now);

    if (circuit.openedAt !== undefined) return;

    const total = circuit.outcomes.length;
    if (total < this.options.minimumRequests) return;

    const failures = circuit.outcomes.reduce((count, outcome) => count + (outcome.ok ? 0 : 1), 0);
    if (failures / total >= this.options.failureRatio) {
      circuit.openedAt = now;
      circuit.openMs = this.options.openMs;
      // Dropped, so the breaker judges what happens *after* it closes again
      // rather than re-opening immediately on the outage it already acted on.
      circuit.outcomes = [];
    }
  }

  /** Forgets everything. For tests, and for an operator resetting a breaker by hand. */
  reset(key?: string): void {
    if (key === undefined) this.circuits.clear();
    else this.circuits.delete(key);
  }

  private circuitFor(key: string): Circuit {
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = { outcomes: [], openMs: this.options.openMs, probing: false };
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  private forgetOld(circuit: Circuit, now: number): void {
    const cutoff = now - this.options.windowMs;
    while (circuit.outcomes.length > 0 && circuit.outcomes[0].at < cutoff) {
      circuit.outcomes.shift();
    }
  }
}

/**
 * The key a breaker trips on: the host, with its port and scheme.
 *
 * Per host rather than per URL, because a dependency is a host — one broken
 * path should not open the breaker for the rest of an API, and one healthy path
 * should not hold it closed while everything else times out. Port and scheme
 * are included so a staging service on another port is judged separately.
 */
export function hostKey(url: URL | string): string {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  return `${parsed.protocol}//${parsed.host}`;
}
