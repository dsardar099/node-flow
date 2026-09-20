import { z } from 'zod';

/**
 * Retry, timeout and concurrency policy.
 *
 * These are the execution controls from PLAN.md expressed as schemas. Two of
 * them exist because Conductor's absence of them causes real production
 * failures:
 *
 *  - `maxRetryDelaySeconds` caps exponential backoff. Without a cap, attempt 12
 *    of an exponential policy schedules a retry days into the future and the
 *    task looks silently lost.
 *  - `retryBudget` bounds the share of executions that may be retries. Without
 *    it, a degraded dependency induces retry traffic that keeps it degraded.
 */

export const RetryLogic = {
  FIXED: 'FIXED',
  LINEAR_BACKOFF: 'LINEAR_BACKOFF',
  EXPONENTIAL_BACKOFF: 'EXPONENTIAL_BACKOFF',
} as const;
export type RetryLogic = (typeof RetryLogic)[keyof typeof RetryLogic];

export const TimeoutPolicy = {
  /** Emit an event and let the task keep running. */
  ALERT_ONLY: 'ALERT_ONLY',
  /** Count the timeout as a failed attempt and retry if attempts remain. */
  RETRY: 'RETRY',
  /** Fail the whole workflow. */
  TIME_OUT_WF: 'TIME_OUT_WF',
} as const;
export type TimeoutPolicy = (typeof TimeoutPolicy)[keyof typeof TimeoutPolicy];

export const retryPolicySchema = z.object({
  /** Attempts *after* the first. 0 means run once, never retry. */
  retryCount: z.int().min(0).max(100).default(3),
  retryLogic: z.enum(RetryLogic).default(RetryLogic.EXPONENTIAL_BACKOFF),
  retryDelaySeconds: z.number().min(0).default(1),
  /** Growth factor for LINEAR_BACKOFF and EXPONENTIAL_BACKOFF. */
  backoffScaleFactor: z.number().min(1).default(2),
  /** Hard ceiling on any computed delay. Prevents runaway exponential growth. */
  maxRetryDelaySeconds: z.number().min(0).default(3600),
  /**
   * Proportional jitter, 0–1. Default 0.2 means the delay is randomised +/-20%.
   * On by default because synchronised retries from many workers are a
   * self-inflicted thundering herd.
   */
  jitter: z.number().min(0).max(1).default(0.2),
  /**
   * Maximum fraction of executions that may be retries before the budget trips
   * and further retries fail fast. 1 disables the budget.
   */
  retryBudget: z.number().min(0).max(1).default(0.3),
  /** Error codes that must never be retried, whatever retryCount allows. */
  nonRetryableErrors: z.array(z.string()).default([]),
});

export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export const timeoutPolicySchema = z.object({
  /** Total task budget, scheduled through to terminal. 0 disables. */
  timeoutSeconds: z.number().min(0).default(0),
  /**
   * Enqueued until leased by a worker. Catches "nobody is running this queue" —
   * a distinct failure from a slow worker, and one Conductor cannot express.
   */
  scheduleToStartTimeout: z.number().min(0).default(0),
  /** Leased until terminal. Catches a slow or wedged worker. */
  startToCloseTimeout: z.number().min(0).default(0),
  /** Maximum gap between heartbeats for long-running tasks. */
  heartbeatTimeout: z.number().min(0).default(0),
  /** Conductor-compatible alias over the lease duration. */
  responseTimeoutSeconds: z.number().min(0).default(3600),
  /** How long the server may hold a worker's long-poll connection open. */
  pollTimeoutSeconds: z.number().min(0).default(30),
  timeoutPolicy: z.enum(TimeoutPolicy).default(TimeoutPolicy.TIME_OUT_WF),
});

export type TimeoutSettings = z.infer<typeof timeoutPolicySchema>;

export const concurrencyPolicySchema = z.object({
  /** Global cap on in-flight executions of this task type. 0 disables. */
  concurrentExecLimit: z.int().min(0).default(0),
  /** Token bucket: how many may be dispatched per window. 0 disables. */
  rateLimitPerFrequency: z.int().min(0).default(0),
  /** Token bucket window, in seconds. */
  rateLimitFrequencySeconds: z.int().min(0).default(1),
  /**
   * Named semaphores this task must hold to run. Lets unrelated tasks across
   * different workflows share one cap on a fragile downstream dependency —
   * something a per-task-definition limit cannot express.
   */
  semaphores: z.array(z.string()).default([]),
});

export type ConcurrencyPolicy = z.infer<typeof concurrencyPolicySchema>;

/**
 * Delay before attempt N, honouring backoff shape, cap and jitter.
 *
 * `attempt` is 1-based: 1 is the delay before the first retry.
 * `random` is injected so the engine stays deterministic and testable — the
 * pure core never reaches for Math.random itself.
 */
export function computeRetryDelaySeconds(
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random
): number {
  if (attempt < 1) return 0;

  let delay: number;
  switch (policy.retryLogic) {
    case RetryLogic.FIXED:
      delay = policy.retryDelaySeconds;
      break;
    case RetryLogic.LINEAR_BACKOFF:
      delay = policy.retryDelaySeconds * policy.backoffScaleFactor * attempt;
      break;
    case RetryLogic.EXPONENTIAL_BACKOFF:
      delay = policy.retryDelaySeconds * Math.pow(policy.backoffScaleFactor, attempt - 1);
      break;
  }

  delay = Math.min(delay, policy.maxRetryDelaySeconds);

  if (policy.jitter > 0) {
    const spread = delay * policy.jitter;
    delay = delay - spread + random() * spread * 2;
  }

  // Clamp again *after* jitter. Capping only beforehand lets upward jitter push
  // the delay back over the ceiling, which defeats the point of having one.
  return Math.min(Math.max(0, delay), policy.maxRetryDelaySeconds);
}
