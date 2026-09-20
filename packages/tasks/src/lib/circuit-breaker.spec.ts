import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError, hostKey } from './circuit-breaker.js';

/**
 * The breaker, tested against what it is for: keeping one dead dependency from
 * consuming the capacity every other workflow shares.
 *
 * Time is injected rather than slept through, so the window, the open period
 * and the doubling are asserted exactly instead of approximately.
 */

const breakerAt = (now: () => number, overrides = {}) =>
  new CircuitBreaker({
    enabled: true,
    windowMs: 1000,
    minimumRequests: 4,
    failureRatio: 0.5,
    openMs: 500,
    maxOpenMs: 2000,
    now,
    ...overrides,
  });

describe('circuit breaker', () => {
  it('does nothing at all until it is enabled', () => {
    const breaker = new CircuitBreaker({ minimumRequests: 1 });
    for (let i = 0; i < 20; i++) breaker.record('https://api.test', false);

    expect(breaker.enabled).toBe(false);
    expect(() => breaker.assertAllowed('https://api.test')).not.toThrow();
    expect(breaker.stateOf('https://api.test')).toBe('closed');
  });

  it('opens once enough of a sample has failed, and not before', () => {
    const now = 0;
    const breaker = breakerAt(() => now);
    const key = 'https://api.test';

    // Three failures is a small sample, and small samples lie.
    for (let i = 0; i < 3; i++) breaker.record(key, false);
    expect(breaker.stateOf(key)).toBe('closed');
    expect(() => breaker.assertAllowed(key)).not.toThrow();

    breaker.record(key, false);
    expect(breaker.stateOf(key)).toBe('open');
    expect(() => breaker.assertAllowed(key)).toThrow(CircuitOpenError);
  });

  it('stays closed when failures are a minority', () => {
    const now = 0;
    const breaker = breakerAt(() => now);
    const key = 'https://api.test';

    for (const ok of [true, true, true, false, true, false]) breaker.record(key, ok);
    expect(breaker.stateOf(key)).toBe('closed');
  });

  it('forgets outcomes older than the window, so an old outage cannot open it later', () => {
    let now = 0;
    const breaker = breakerAt(() => now);
    const key = 'https://api.test';

    breaker.record(key, false);
    breaker.record(key, false);
    now = 2000; // Both are now outside the 1s window.
    breaker.record(key, false);
    breaker.record(key, false);

    // Only two outcomes are live, which is under the minimum.
    expect(breaker.stateOf(key)).toBe('closed');
  });

  it('admits exactly one probe when the open period expires', () => {
    let now = 0;
    const breaker = breakerAt(() => now);
    const key = 'https://api.test';
    for (let i = 0; i < 4; i++) breaker.record(key, false);

    now = 400;
    expect(() => breaker.assertAllowed(key)).toThrow(/circuit open/);

    now = 500;
    expect(breaker.stateOf(key)).toBe('half-open');
    // The first caller through is the probe.
    expect(() => breaker.assertAllowed(key)).not.toThrow();
    // Everyone else keeps failing fast: releasing the backlog at once is how a
    // recovering service is knocked over again.
    expect(() => breaker.assertAllowed(key)).toThrow(/circuit open/);
  });

  it('closes on a successful probe and re-opens for longer on a failing one', () => {
    let now = 0;
    const breaker = breakerAt(() => now);
    const key = 'https://api.test';
    for (let i = 0; i < 4; i++) breaker.record(key, false);

    now = 500;
    breaker.assertAllowed(key);
    breaker.record(key, false);

    // Still down: the wait doubles rather than probing every 500ms forever.
    now = 900;
    expect(() => breaker.assertAllowed(key)).toThrow(/circuit open/);
    now = 1500;
    breaker.assertAllowed(key);
    breaker.record(key, true);

    expect(breaker.stateOf(key)).toBe('closed');
    expect(() => breaker.assertAllowed(key)).not.toThrow();
  });

  it('caps how long it waits between probes', () => {
    let now = 0;
    const breaker = breakerAt(() => now);
    const key = 'https://api.test';
    for (let i = 0; i < 4; i++) breaker.record(key, false);

    // 500 → 1000 → 2000 → capped at 2000.
    for (const at of [500, 1500, 3500, 5500]) {
      now = at;
      breaker.assertAllowed(key);
      breaker.record(key, false);
    }

    now = 5500 + 1999;
    expect(() => breaker.assertAllowed(key)).toThrow(/circuit open/);
    now = 5500 + 2000;
    expect(() => breaker.assertAllowed(key)).not.toThrow();
  });

  it('judges each host separately', () => {
    const now = 0;
    const breaker = breakerAt(() => now);
    for (let i = 0; i < 4; i++) breaker.record('https://down.test', false);

    expect(() => breaker.assertAllowed('https://down.test')).toThrow();
    expect(() => breaker.assertAllowed('https://fine.test')).not.toThrow();
  });

  it('keys on scheme, host and port so a second service on the same host is judged apart', () => {
    expect(hostKey('https://api.test/orders/1?x=2')).toBe('https://api.test');
    expect(hostKey(new URL('http://api.test:8080/x'))).toBe('http://api.test:8080');
    expect(hostKey('https://api.test:8443/x')).not.toBe(hostKey('https://api.test/x'));
  });
});
