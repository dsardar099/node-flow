import { TaskType, type JsonValue } from '@node-flow-dev/core';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';
import { HttpTaskExecutor, type HttpExecutorOptions } from './http.executor.js';
import { JsSandbox, type SandboxOptions } from './sandbox.js';

/**
 * `HTTP_POLL` — calls an endpoint repeatedly until a condition holds.
 *
 * The shape of every "kick off a job, wait for it to finish" integration:
 * submit a report, start a build, request an export, then poll until it is
 * ready. Doing it with `HTTP` means a `DO_WHILE` around a request and a `WAIT`,
 * which works and is three nodes of ceremony around one idea.
 *
 * ## It does not sleep in its execution slot
 *
 * The obvious implementation polls in a loop with a delay between attempts.
 * That holds a concurrency slot for the entire polling lifetime — an hour of
 * waiting on a slow export occupies a slot for an hour while doing nothing —
 * and loses all progress if the server restarts.
 *
 * So each pass makes **one** request and then either finishes or returns
 * `IN_PROGRESS`, which persists the poll count and hands the slot back until
 * the next attempt is due. The task keeps its row, its attempt and its
 * deadlines; only the slot is released. A restart mid-poll costs one request.
 *
 * The total lifetime is bounded twice over: by `pollCount`, and by the task's
 * own timeout, which keeps running across passes precisely because this is one
 * task rather than a retry loop.
 */

export type HttpPollExecutorOptions = HttpExecutorOptions & {
  /** Limits on the termination condition, which is user-supplied code. */
  sandbox?: SandboxOptions;
};

const DEFAULTS = {
  pollIntervalSeconds: 60,
  pollCount: 10,
};

export class HttpPollTaskExecutor implements TaskExecutor {
  readonly type = TaskType.HTTP_POLL;
  private readonly http: HttpTaskExecutor;
  private readonly sandbox: JsSandbox;

  constructor(options: HttpPollExecutorOptions = {}) {
    this.http = new HttpTaskExecutor(options);
    this.sandbox = new JsSandbox(options.sandbox);
  }

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const condition = context.input['terminationCondition'];
    if (typeof condition !== 'string' || condition.trim() === '') {
      return {
        status: 'FAILED',
        reason: 'HTTP_POLL requires a "terminationCondition"',
        terminal: true,
      };
    }

    const limit = readNumber(context.input['pollCount']) ?? DEFAULTS.pollCount;
    // Read from the task row, not from a field on this object: the previous
    // poll may well have run in a different process.
    const previous = readNumber(context.state['pollCount']) ?? 0;
    const attempt = previous + 1;

    const response = await this.http.execute({ ...context, input: context.input });

    // A transport failure — a refused connection, a 5xx — is not a reason to
    // stop polling. The endpoint being polled is, by construction, one that is
    // not ready yet, and treating a blip as terminal defeats the point.
    if (response.status === 'FAILED' && response.terminal) {
      return response;
    }

    const body = response.output ?? {};

    const decision = await this.sandbox.evaluate(condition, {
      // Bound as `$` — the same shape `INLINE` gets, so an author who has
      // written one already knows how to write the other.
      ...(body as Record<string, JsonValue>),
      pollCount: attempt,
    });

    if (!decision.ok) {
      // A condition that cannot be evaluated will not evaluate on the next poll
      // either, and continuing would poll until the count ran out while
      // reporting nothing useful.
      return {
        status: 'FAILED',
        reason: `termination condition failed: ${decision.reason}`,
        terminal: true,
      };
    }

    if (decision.value === true) {
      return { status: 'COMPLETED', output: { ...body, pollCount: attempt } };
    }

    if (attempt >= limit) {
      return {
        status: 'FAILED',
        reason: `polled ${attempt} times without the termination condition becoming true`,
        // Retryable: the endpoint may simply have been slower than the budget
        // allowed, and the retry policy is the right place to decide.
        terminal: false,
        output: { ...body, pollCount: attempt },
      };
    }

    return {
      status: 'IN_PROGRESS',
      callbackAfterSeconds: this.delayFor(context.input, attempt),
      // Persisted before the slot is released, so the next pass — possibly on
      // another server — knows how far along it is.
      output: { ...body, pollCount: attempt },
    };
  }

  /**
   * How long until the next poll.
   *
   * Backoff matters more here than for retries: a thousand workflows polling
   * the same export endpoint every second is a denial of service against a
   * dependency that is already known to be slow.
   */
  private delayFor(input: Record<string, JsonValue>, attempt: number): number {
    const base =
      readNumber(input['pollingInterval']) ??
      readNumber(input['pollIntervalSeconds']) ??
      DEFAULTS.pollIntervalSeconds;

    const strategy = String(input['pollingStrategy'] ?? 'FIXED').toUpperCase();

    switch (strategy) {
      case 'LINEAR_BACKOFF':
        return base * attempt;
      case 'EXPONENTIAL_BACKOFF':
        return base * 2 ** (attempt - 1);
      default:
        return base;
    }
  }
}

function readNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}
