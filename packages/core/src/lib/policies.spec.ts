import { describe, expect, it } from 'vitest';
import {
  computeRetryDelaySeconds,
  RetryLogic,
  retryPolicySchema,
  type RetryPolicy,
} from './policies.js';

/** Deterministic "random" so jitter is testable. 0.5 is the midpoint => no shift. */
const noJitter = () => 0.5;

function policy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return retryPolicySchema.parse({ jitter: 0, ...overrides });
}

describe('computeRetryDelaySeconds', () => {
  it('returns a constant delay for FIXED', () => {
    const p = policy({ retryLogic: RetryLogic.FIXED, retryDelaySeconds: 5 });
    expect([1, 2, 7].map((a) => computeRetryDelaySeconds(p, a, noJitter))).toEqual([5, 5, 5]);
  });

  it('grows linearly for LINEAR_BACKOFF', () => {
    const p = policy({
      retryLogic: RetryLogic.LINEAR_BACKOFF,
      retryDelaySeconds: 2,
      backoffScaleFactor: 3,
    });
    // base * factor * attempt
    expect([1, 2, 3].map((a) => computeRetryDelaySeconds(p, a, noJitter))).toEqual([6, 12, 18]);
  });

  it('doubles each attempt for EXPONENTIAL_BACKOFF', () => {
    const p = policy({
      retryLogic: RetryLogic.EXPONENTIAL_BACKOFF,
      retryDelaySeconds: 1,
      backoffScaleFactor: 2,
    });
    expect([1, 2, 3, 4].map((a) => computeRetryDelaySeconds(p, a, noJitter))).toEqual([1, 2, 4, 8]);
  });

  // The reason maxRetryDelaySeconds exists: without it, attempt 20 of an
  // exponential policy schedules a retry ~12 days out and the task looks lost.
  it('caps exponential growth at maxRetryDelaySeconds', () => {
    const p = policy({
      retryLogic: RetryLogic.EXPONENTIAL_BACKOFF,
      retryDelaySeconds: 1,
      backoffScaleFactor: 2,
      maxRetryDelaySeconds: 60,
    });
    expect(computeRetryDelaySeconds(p, 20, noJitter)).toBe(60);
    expect(computeRetryDelaySeconds(p, 100, noJitter)).toBe(60);
  });

  it('never exceeds the cap even with jitter applied', () => {
    const p = policy({
      retryLogic: RetryLogic.EXPONENTIAL_BACKOFF,
      retryDelaySeconds: 1,
      backoffScaleFactor: 2,
      maxRetryDelaySeconds: 10,
      jitter: 0.5,
    });
    // random() === 1 is the maximum upward jitter excursion.
    for (let attempt = 1; attempt <= 30; attempt++) {
      expect(computeRetryDelaySeconds(p, attempt, () => 1)).toBeLessThanOrEqual(10);
    }
  });

  it('spreads delays within the jitter band and never below zero', () => {
    const p = policy({ retryLogic: RetryLogic.FIXED, retryDelaySeconds: 10, jitter: 0.2 });
    expect(computeRetryDelaySeconds(p, 1, () => 0)).toBeCloseTo(8);
    expect(computeRetryDelaySeconds(p, 1, () => 0.5)).toBeCloseTo(10);
    expect(computeRetryDelaySeconds(p, 1, () => 1)).toBeCloseTo(12);
  });

  it('clamps to zero rather than returning a negative delay', () => {
    const p = policy({ retryLogic: RetryLogic.FIXED, retryDelaySeconds: 0, jitter: 1 });
    expect(computeRetryDelaySeconds(p, 1, () => 0)).toBe(0);
  });

  it('treats a zeroth attempt as no delay', () => {
    expect(computeRetryDelaySeconds(policy(), 0, noJitter)).toBe(0);
  });

  it('defaults to exponential backoff with jitter enabled', () => {
    const p = retryPolicySchema.parse({});
    expect(p.retryLogic).toBe(RetryLogic.EXPONENTIAL_BACKOFF);
    expect(p.jitter).toBeGreaterThan(0);
    expect(p.maxRetryDelaySeconds).toBeGreaterThan(0);
  });
});
