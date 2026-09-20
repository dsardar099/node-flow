import type { JsonValue } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import type { TaskContext, TaskOutcome } from './executor.js';
import { HttpPollTaskExecutor } from './http-poll.executor.js';

/**
 * `HTTP_POLL`.
 *
 * The property under test throughout is that polling **spans passes**: each
 * execution makes exactly one request and hands its slot back, carrying its
 * progress on the task row rather than in the executor. A loop-with-a-sleep
 * would pass most of the surface tests here and fail every one that checks the
 * request count or the returned status.
 */

const context = (
  input: Record<string, JsonValue>,
  state: Record<string, JsonValue> = {}
): TaskContext => ({
  taskId: 't-1',
  workflowId: 'w-1',
  namespaceId: 'ns-1',
  input,
  state,
  signal: new AbortController().signal,
  heartbeat: async () => undefined,
});

/** Counts requests, so "one request per pass" is verifiable rather than assumed. */
function stub(bodies: string[]) {
  const calls: string[] = [];

  const impl = (async (url: string | URL) => {
    const body = bodies[Math.min(calls.length, bodies.length - 1)];
    calls.push(String(url));
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;

  return { impl, calls };
}

const poller = (impl: typeof globalThis.fetch) =>
  new HttpPollTaskExecutor({ allowedHosts: ['api.example.com'], fetch: impl });

const base = {
  uri: 'https://api.example.com/jobs/1',
  terminationCondition: 'return $.body.status === "DONE"',
};

describe('a single pass', () => {
  it('completes when the condition already holds', async () => {
    const { impl, calls } = stub(['{"status":"DONE"}']);
    const outcome = await poller(impl).execute(context(base));

    expect(outcome.status).toBe('COMPLETED');
    expect(calls).toHaveLength(1);
  });

  // The load-bearing assertion: not finished is not the same as failed, and a
  // slot held across a polling interval is a slot wasted.
  it('returns IN_PROGRESS and yields its slot when the condition does not hold', async () => {
    const { impl, calls } = stub(['{"status":"RUNNING"}']);
    const outcome = await poller(impl).execute(context(base));

    expect(outcome.status).toBe('IN_PROGRESS');
    expect(calls).toHaveLength(1);
    if (outcome.status === 'IN_PROGRESS') {
      expect(outcome.callbackAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('makes exactly one request per pass', async () => {
    const { impl, calls } = stub(['{"status":"RUNNING"}']);
    await poller(impl).execute(context({ ...base, pollCount: 5 }));

    expect(calls).toHaveLength(1);
  });
});

describe('progress across passes', () => {
  /**
   * The count has to live on the task row, because the next pass may run in a
   * different process. An executor-held counter would silently restart at zero
   * after a deploy and poll forever.
   */
  it('carries the poll count forward through state', async () => {
    const { impl } = stub(['{"status":"RUNNING"}']);
    const executor = poller(impl);

    const first = await executor.execute(context(base));
    expect(first.output?.['pollCount']).toBe(1);

    const second = await executor.execute(context(base, first.output ?? {}));
    expect(second.output?.['pollCount']).toBe(2);
  });

  it('runs to completion when driven pass by pass', async () => {
    const { impl, calls } = stub(['{"status":"RUNNING"}', '{"status":"RUNNING"}', '{"status":"DONE"}']);
    const executor = poller(impl);

    let outcome: TaskOutcome = { status: 'IN_PROGRESS', callbackAfterSeconds: 0 };
    let state: Record<string, JsonValue> = {};

    for (let pass = 0; pass < 5 && outcome.status === 'IN_PROGRESS'; pass++) {
      outcome = await executor.execute(context(base, state));
      state = outcome.output ?? {};
    }

    expect(outcome.status).toBe('COMPLETED');
    expect(calls).toHaveLength(3);
    expect(outcome.output?.['pollCount']).toBe(3);
  });

  it('gives up once the poll count is spent', async () => {
    const { impl } = stub(['{"status":"RUNNING"}']);
    const outcome = await poller(impl).execute(
      context({ ...base, pollCount: 3 }, { pollCount: 2 })
    );

    expect(outcome.status).toBe('FAILED');
    // Retryable: the endpoint may simply have been slower than the budget.
    expect(outcome).toMatchObject({ terminal: false });
  });
});

describe('backoff', () => {
  const delayFor = async (input: Record<string, JsonValue>, state: Record<string, JsonValue>) => {
    const { impl } = stub(['{"status":"RUNNING"}']);
    const outcome = await poller(impl).execute(context({ ...base, ...input }, state));
    return outcome.status === 'IN_PROGRESS' ? outcome.callbackAfterSeconds : -1;
  };

  it('is fixed by default', async () => {
    expect(await delayFor({ pollingInterval: 30 }, {})).toBe(30);
    expect(await delayFor({ pollingInterval: 30 }, { pollCount: 4 })).toBe(30);
  });

  it('grows linearly when asked', async () => {
    const input = { pollingInterval: 10, pollingStrategy: 'LINEAR_BACKOFF' };
    expect(await delayFor(input, {})).toBe(10);
    expect(await delayFor(input, { pollCount: 2 })).toBe(30);
  });

  // A thousand workflows polling the same slow endpoint every second is a
  // denial of service against a dependency already known to be struggling.
  it('grows exponentially when asked', async () => {
    const input = { pollingInterval: 5, pollingStrategy: 'EXPONENTIAL_BACKOFF' };
    expect(await delayFor(input, {})).toBe(5);
    // Fourth attempt: 5 × 2³.
    expect(await delayFor(input, { pollCount: 3 })).toBe(40);
  });
});

describe('refusing', () => {
  it('fails terminally without a termination condition', async () => {
    const { impl, calls } = stub(['{}']);
    const outcome = await poller(impl).execute(context({ uri: base.uri }));

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    // Refused before any request went out.
    expect(calls).toHaveLength(0);
  });

  // A condition that cannot be evaluated will not evaluate next time either,
  // and polling on regardless reports nothing useful when the count runs out.
  it('fails terminally when the condition cannot be evaluated', async () => {
    const { impl } = stub(['{"status":"RUNNING"}']);
    const outcome = await poller(impl).execute(
      context({ ...base, terminationCondition: 'return $.nope.deeper' })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });

  // The endpoint is by construction one that is not ready yet; a blip must not
  // end the poll.
  it('keeps polling through a transient 5xx', async () => {
    const impl = (async () =>
      new Response('{}', { status: 503 })) as unknown as typeof globalThis.fetch;

    const outcome = await poller(impl).execute(context(base));
    expect(outcome.status).toBe('IN_PROGRESS');
  });

  // The polled URL is user-supplied like any other.
  it('is still behind the SSRF guard', async () => {
    const outcome = await new HttpPollTaskExecutor().execute(
      context({ ...base, uri: 'http://169.254.169.254/latest/meta-data/' })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    if (outcome.status === 'FAILED') expect(outcome.reason).toMatch(/blocked/);
  });
});
