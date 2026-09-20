import { describe, expect, it } from 'vitest';
import { NodeFlowApiError, NodeFlowClient } from './client.js';

/**
 * The client, against a stubbed `fetch`.
 *
 * The integration suite proves the request shapes match the server. What only a
 * unit test can pin down cheaply is the logic *around* the request: token
 * caching and refresh, error mapping, and which failures are worth retrying.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch stub that records calls and replays scripted responses. */
function stubFetch(
  responses: Array<{ status?: number; body?: unknown }> | ((call: Call) => { status?: number; body?: unknown })
) {
  const calls: Call[] = [];
  let index = 0;

  const impl = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);

    const next = typeof responses === 'function' ? responses(call) : responses[index++];
    const status = next?.status ?? 200;

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'stub',
      text: async () => (next?.body === undefined ? '' : JSON.stringify(next.body)),
      json: async () => next?.body,
    } as Response;
  }) as unknown as typeof globalThis.fetch;

  return { impl, calls };
}

const base = { baseUrl: 'http://nf.test', namespace: 'acme' };

describe('construction', () => {
  it('requires credentials', () => {
    expect(() => new NodeFlowClient({ ...base })).toThrow(/apiKey or serviceAccount/);
  });

  it('tolerates a trailing slash on the base URL', async () => {
    const { impl, calls } = stubFetch([{ body: { tasks: [] } }]);
    const client = new NodeFlowClient({
      ...base,
      baseUrl: 'http://nf.test///',
      apiKey: 'k',
      fetch: impl,
    });

    await client.lease({ queue: 'a', workerId: 'w' });
    expect(calls[0].url).toBe('http://nf.test/v1/ns/acme/queues/a/lease');
  });

  it('escapes a queue name that needs it', async () => {
    const { impl, calls } = stubFetch([{ body: { tasks: [] } }]);
    const client = new NodeFlowClient({ ...base, apiKey: 'k', fetch: impl });

    await client.lease({ queue: 'charge/eu', workerId: 'w' });
    expect(calls[0].url).toContain('charge%2Feu');
  });
});

describe('authentication', () => {
  it('sends an API key as a header', async () => {
    const { impl, calls } = stubFetch([{ body: { tasks: [] } }]);
    const client = new NodeFlowClient({ ...base, apiKey: 'nf_secret', fetch: impl });

    await client.lease({ queue: 'a', workerId: 'w' });
    expect(calls[0].headers['x-api-key']).toBe('nf_secret');
  });

  it('exchanges a service account for a bearer token', async () => {
    const { impl, calls } = stubFetch([
      { body: { accessToken: 'tok-1', expiresIn: 3600 } },
      { body: { tasks: [] } },
    ]);
    const client = new NodeFlowClient({
      ...base,
      serviceAccount: { keyId: 'sa_1', secret: 's' },
      fetch: impl,
    });

    await client.lease({ queue: 'a', workerId: 'w' });

    expect(calls[0].url).toBe('http://nf.test/v1/auth/token');
    expect(calls[1].headers['authorization']).toBe('Bearer tok-1');
  });

  it('reuses a cached token rather than exchanging every call', async () => {
    const { impl, calls } = stubFetch((call) =>
      call.url.endsWith('/auth/token')
        ? { body: { accessToken: 'tok-1', expiresIn: 3600 } }
        : { body: { tasks: [] } }
    );
    const client = new NodeFlowClient({
      ...base,
      serviceAccount: { keyId: 'sa_1', secret: 's' },
      fetch: impl,
    });

    await client.lease({ queue: 'a', workerId: 'w' });
    await client.lease({ queue: 'a', workerId: 'w' });
    await client.lease({ queue: 'a', workerId: 'w' });

    expect(calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(1);
  });

  // Refreshed early, because a token that expires between the check and the
  // server receiving the request produces a 401 that looks like a credential
  // problem — and clock skew makes the exact boundary unknowable anyway.
  it('refreshes a token that is about to expire', async () => {
    const { impl, calls } = stubFetch((call) =>
      call.url.endsWith('/auth/token')
        ? { body: { accessToken: `tok-${calls.length}`, expiresIn: 30 } }
        : { body: { tasks: [] } }
    );
    const client = new NodeFlowClient({
      ...base,
      serviceAccount: { keyId: 'sa_1', secret: 's' },
      fetch: impl,
    });

    await client.lease({ queue: 'a', workerId: 'w' });
    await client.lease({ queue: 'a', workerId: 'w' });

    // A 30s lifetime is inside the 60s refresh margin, so every call re-exchanges.
    expect(calls.filter((c) => c.url.endsWith('/auth/token')).length).toBe(2);
  });

  // A worker leasing on several queues would otherwise mint one token per
  // queue the moment the old one expires.
  it('collapses concurrent refreshes into one exchange', async () => {
    const { impl, calls } = stubFetch((call) =>
      call.url.endsWith('/auth/token')
        ? { body: { accessToken: 'tok-1', expiresIn: 3600 } }
        : { body: { tasks: [] } }
    );
    const client = new NodeFlowClient({
      ...base,
      serviceAccount: { keyId: 'sa_1', secret: 's' },
      fetch: impl,
    });

    await Promise.all([
      client.lease({ queue: 'a', workerId: 'w' }),
      client.lease({ queue: 'b', workerId: 'w' }),
      client.lease({ queue: 'c', workerId: 'w' }),
    ]);

    expect(calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(1);
  });

  it('reports a rejected exchange clearly', async () => {
    const { impl } = stubFetch([{ status: 401, body: { error: 'invalid_credentials' } }]);
    const client = new NodeFlowClient({
      ...base,
      serviceAccount: { keyId: 'sa_1', secret: 'wrong' },
      fetch: impl,
    });

    await expect(client.lease({ queue: 'a', workerId: 'w' })).rejects.toThrow(
      /could not exchange/
    );
  });
});

describe('errors', () => {
  it('carries the server’s stable code, not just the status', async () => {
    const { impl } = stubFetch([
      { status: 409, body: { error: 'LEASE_EXPIRED', message: 'lease is gone' } },
    ]);
    const client = new NodeFlowClient({ ...base, apiKey: 'k', fetch: impl });

    await expect(
      client.report({
        taskId: 't',
        queueName: 'a',
        workflowId: 'w',
        leaseToken: 'l',
        status: 'COMPLETED',
      })
    ).rejects.toMatchObject({ status: 409, code: 'LEASE_EXPIRED', message: 'lease is gone' });
  });

  it('surfaces validation details', async () => {
    const { impl } = stubFetch([
      {
        status: 400,
        body: { error: 'validation_failed', issues: [{ path: 'name', message: 'required' }] },
      },
    ]);
    const client = new NodeFlowClient({ ...base, apiKey: 'k', fetch: impl });

    await expect(client.registerWorkflow({})).rejects.toMatchObject({
      details: [{ path: 'name', message: 'required' }],
    });
  });

  // Retrying a 4xx just makes the same mistake faster.
  it('marks only transient failures retryable', () => {
    expect(new NodeFlowApiError(500, 'x', 'm').retryable).toBe(true);
    expect(new NodeFlowApiError(503, 'x', 'm').retryable).toBe(true);
    expect(new NodeFlowApiError(429, 'x', 'm').retryable).toBe(true);

    expect(new NodeFlowApiError(400, 'x', 'm').retryable).toBe(false);
    expect(new NodeFlowApiError(401, 'x', 'm').retryable).toBe(false);
    expect(new NodeFlowApiError(404, 'x', 'm').retryable).toBe(false);
    expect(new NodeFlowApiError(409, 'x', 'm').retryable).toBe(false);
  });

  it('handles an empty 204 body', async () => {
    const { impl } = stubFetch([{ status: 204 }]);
    const client = new NodeFlowClient({ ...base, apiKey: 'k', fetch: impl });

    await expect(
      client.heartbeat({ taskId: 't', queueName: 'a', leaseToken: 'l' })
    ).resolves.toBeUndefined();
  });
});

describe('long-poll', () => {
  it('passes the wait through to the server', async () => {
    const { impl, calls } = stubFetch([{ body: { tasks: [] } }]);
    const client = new NodeFlowClient({ ...base, apiKey: 'k', fetch: impl });

    await client.lease({ queue: 'a', workerId: 'w', waitSeconds: 25 });
    expect(calls[0].body).toMatchObject({ waitSeconds: 25, workerId: 'w', count: 1 });
  });

  it('defaults to no wait', async () => {
    const { impl, calls } = stubFetch([{ body: { tasks: [] } }]);
    const client = new NodeFlowClient({ ...base, apiKey: 'k', fetch: impl });

    await client.lease({ queue: 'a', workerId: 'w' });
    expect(calls[0].body).toMatchObject({ waitSeconds: 0 });
  });

  // Without this the client's own timeout fires mid-poll and every long-poll
  // aborts itself — the request is *meant* to hang.
  it('gives a long poll a client timeout longer than the wait', async () => {
    let signalled = false;

    const impl = (async (_url: string, init?: RequestInit) => {
      // A 5s wait must not be aborted by a 100ms client timeout.
      await new Promise((r) => setTimeout(r, 150));
      signalled = init?.signal?.aborted ?? false;
      return {
        ok: true,
        status: 200,
        statusText: 'ok',
        text: async () => JSON.stringify({ tasks: [] }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const client = new NodeFlowClient({ ...base, apiKey: 'k', fetch: impl, timeoutMs: 100 });

    await client.lease({ queue: 'a', workerId: 'w', waitSeconds: 5 });
    expect(signalled).toBe(false);
  });

  it('aborts the poll when the caller’s signal fires', async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;

    const impl = (async (_url: string, init?: RequestInit) => {
      observed = init?.signal ?? undefined;
      controller.abort();
      return {
        ok: true,
        status: 200,
        statusText: 'ok',
        text: async () => JSON.stringify({ tasks: [] }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const client = new NodeFlowClient({ ...base, apiKey: 'k', fetch: impl });
    await client.lease({ queue: 'a', workerId: 'w', waitSeconds: 30, signal: controller.signal });

    expect(observed?.aborted).toBe(true);
  });
});

/**
 * `baseUrl` is the origin; the client appends `/v1` to every path.
 *
 * Worth pinning down because the README shipped the wrong form — `.../v1` —
 * which produced requests to `/v1/v1/...`. That fails as a 404 on the first
 * call, with nothing in the message pointing back at the constructor that
 * caused it, so the client now accepts and drops the suffix.
 */
describe('baseUrl', () => {
  it.each([
    ['http://nf.test', 'plain origin'],
    ['http://nf.test/', 'trailing slash'],
    ['http://nf.test/v1', 'API root — the documented mistake'],
    ['http://nf.test/v1/', 'API root with a trailing slash'],
  ])('%s (%s) addresses /v1 exactly once', async (baseUrl) => {
    const { impl, calls } = stubFetch([{ body: { status: 'RUNNING', workflowId: 'abc' } }]);
    const client = new NodeFlowClient({ ...base, baseUrl, apiKey: 'k', fetch: impl });

    await client.executionStatus('abc');

    expect(calls[0].url).toBe('http://nf.test/v1/ns/acme/executions/abc/status');
  });
});
