import type { JsonValue } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';
import type { TaskContext } from './executor.js';
import { HttpTaskExecutor, isPrivateAddress } from './http.executor.js';

/**
 * The `HTTP` task.
 *
 * Weighted heavily toward refusal, because a workflow definition is user input
 * and this executor runs inside the network perimeter. The SSRF tests are the
 * point of the file: everything else is a bug, that is a breach.
 */

function contextFor(input: Record<string, JsonValue>): TaskContext {
  return {
    taskId: 't-1',
    workflowId: 'w-1',
    namespaceId: 'ns-1',
    input,
    signal: new AbortController().signal,
    state: {},
    heartbeat: async () => undefined,
  };
}

/** A fetch stub that records what it was asked to do. */
function stubFetch(
  reply: (url: string, init?: RequestInit) => { status?: number; body?: string; headers?: Record<string, string> }
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const { status = 200, body = '', headers = {} } = reply(String(url), init);

    return new Response(body === '' ? null : body, {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as unknown as typeof globalThis.fetch;

  return { impl, calls };
}

/** Public-facing by default, so the SSRF guard does not reject the fixtures. */
const executor = (options = {}) =>
  new HttpTaskExecutor({ allowedHosts: ['api.example.com', 'other.example.com'], ...options });

describe('SSRF guard', () => {
  // `169.254.169.254` is the one that matters most: it is where every major
  // cloud puts instance metadata, and reading it usually yields credentials.
  it('blocks cloud metadata and loopback by literal address', async () => {
    const http = new HttpTaskExecutor();

    for (const uri of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:8080/admin',
      'http://10.0.0.5/internal',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://[::1]:8080/',
    ]) {
      const outcome = await http.execute(contextFor({ uri }));
      expect(outcome.status, uri).toBe('FAILED');
      if (outcome.status === 'FAILED') {
        expect(outcome.reason, uri).toMatch(/blocked/);
        // Permanent: retrying a blocked address will never start working.
        expect(outcome.terminal, uri).toBe(true);
      }
    }
  });

  it('refuses a non-HTTP scheme', async () => {
    const http = new HttpTaskExecutor();

    for (const uri of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com']) {
      const outcome = await http.execute(contextFor({ uri }));
      expect(outcome.status, uri).toBe('FAILED');
    }
  });

  it('allows an explicitly allow-listed host', async () => {
    const { impl } = stubFetch(() => ({ body: '{"ok":true}' }));
    const http = new HttpTaskExecutor({ allowedHosts: ['internal.svc'], fetch: impl });

    const outcome = await http.execute(contextFor({ uri: 'http://internal.svc/health' }));
    expect(outcome.status).toBe('COMPLETED');
  });

  it('allows everything when the guard is turned off', async () => {
    const { impl } = stubFetch(() => ({ body: '{}' }));
    const http = new HttpTaskExecutor({ allowPrivateAddresses: true, fetch: impl });

    expect((await http.execute(contextFor({ uri: 'http://127.0.0.1/x' }))).status).toBe(
      'COMPLETED'
    );
  });

  /**
   * A name check alone is trivially bypassed — an attacker points their own
   * domain at 127.0.0.1 and the guard sees an ordinary hostname. The check has
   * to be on the resolved address.
   */
  it('recognises the ranges that matter', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }

    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1::']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('treats an unparseable address as private', () => {
    // Refuse rather than guess.
    expect(isPrivateAddress('not-an-address')).toBe(true);
  });
});

describe('requests', () => {
  it('performs a GET and parses a JSON body', async () => {
    const { impl, calls } = stubFetch(() => ({ body: '{"txnId":"tx-1"}' }));

    const outcome = await executor({ fetch: impl }).execute(
      contextFor({ uri: 'https://api.example.com/charge' })
    );

    expect(calls[0].init?.method).toBe('GET');
    expect(outcome.status).toBe('COMPLETED');
    if (outcome.status === 'COMPLETED') {
      expect(outcome.output).toMatchObject({ status: 200, body: { txnId: 'tx-1' } });
    }
  });

  it('sends a JSON body on a POST', async () => {
    const { impl, calls } = stubFetch(() => ({ body: '{}' }));

    await executor({ fetch: impl }).execute(
      contextFor({
        uri: 'https://api.example.com/charge',
        method: 'POST',
        body: { amount: 100 },
      })
    );

    expect(calls[0].init?.body).toBe('{"amount":100}');
    expect((calls[0].init?.headers as Record<string, string>)['content-type']).toContain('json');
  });

  // Conductor nests these under `http_request`; accepting both makes a ported
  // definition work unchanged.
  it('accepts the Conductor-shaped input', async () => {
    const { impl, calls } = stubFetch(() => ({ body: '{}' }));

    await executor({ fetch: impl }).execute(
      contextFor({ http_request: { uri: 'https://api.example.com/x', method: 'POST' } })
    );

    expect(calls[0].url).toBe('https://api.example.com/x');
    expect(calls[0].init?.method).toBe('POST');
  });

  it('returns a non-JSON body as text', async () => {
    const { impl } = stubFetch(() => ({
      body: 'plain text',
      headers: { 'content-type': 'text/plain' },
    }));

    const outcome = await executor({ fetch: impl }).execute(
      contextFor({ uri: 'https://api.example.com/x' })
    );

    if (outcome.status !== 'COMPLETED') throw new Error('expected success');
    expect(outcome.output?.['body']).toBe('plain text');
  });

  // The body of a broken endpoint is usually an error page, and someone
  // debugging needs to see it rather than a parse failure.
  it('falls back to text when Content-Type lies about JSON', async () => {
    const { impl } = stubFetch(() => ({ body: '<html>500</html>' }));

    const outcome = await executor({ fetch: impl }).execute(
      contextFor({ uri: 'https://api.example.com/x' })
    );

    if (outcome.status !== 'COMPLETED') throw new Error('expected success');
    expect(outcome.output?.['body']).toBe('<html>500</html>');
  });

  it('rejects a malformed URL and a bad method permanently', async () => {
    const http = executor();

    const badUrl = await http.execute(contextFor({ uri: 'not-a-url' }));
    const badMethod = await http.execute(
      contextFor({ uri: 'https://api.example.com/x', method: 'TRACE' })
    );

    for (const outcome of [badUrl, badMethod]) {
      expect(outcome.status).toBe('FAILED');
      if (outcome.status === 'FAILED') expect(outcome.terminal).toBe(true);
    }
  });

  it('requires a uri', async () => {
    const outcome = await executor().execute(contextFor({}));
    expect(outcome.status).toBe('FAILED');
  });
});

describe('failure classification', () => {
  /**
   * The distinction that makes a retry policy useful rather than a way to turn
   * one broken URL into twenty attempts.
   */
  it('treats 5xx and 429 as retryable', async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      const { impl } = stubFetch(() => ({ status, body: '{}' }));
      const outcome = await executor({ fetch: impl }).execute(
        contextFor({ uri: 'https://api.example.com/x' })
      );

      expect(outcome.status, String(status)).toBe('FAILED');
      if (outcome.status === 'FAILED') expect(outcome.terminal, String(status)).toBe(false);
    }
  });

  it('treats 4xx as permanent', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const { impl } = stubFetch(() => ({ status, body: '{}' }));
      const outcome = await executor({ fetch: impl }).execute(
        contextFor({ uri: 'https://api.example.com/x' })
      );

      if (outcome.status !== 'FAILED') throw new Error('expected failure');
      expect(outcome.terminal, String(status)).toBe(true);
    }
  });

  // The response is what someone needs to see to understand the failure.
  it('records the response even when the task fails', async () => {
    const { impl } = stubFetch(() => ({ status: 422, body: '{"error":"bad amount"}' }));

    const outcome = await executor({ fetch: impl }).execute(
      contextFor({ uri: 'https://api.example.com/x' })
    );

    if (outcome.status !== 'FAILED') throw new Error('expected failure');
    expect(outcome.output).toMatchObject({ status: 422, body: { error: 'bad amount' } });
  });

  it('reports a timeout as transient', async () => {
    const impl = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof globalThis.fetch;

    const outcome = await executor({ fetch: impl }).execute(
      contextFor({ uri: 'https://api.example.com/slow', timeoutMs: 50 })
    );

    if (outcome.status !== 'FAILED') throw new Error('expected failure');
    expect(outcome.reason).toMatch(/timed out/);
    expect(outcome.terminal).toBe(false);
  });
});

describe('redirects', () => {
  it('follows a redirect', async () => {
    const { impl, calls } = stubFetch((url) =>
      url.endsWith('/old')
        ? { status: 302, headers: { location: 'https://api.example.com/new' } }
        : { body: '{"ok":true}' }
    );

    const outcome = await executor({ fetch: impl }).execute(
      contextFor({ uri: 'https://api.example.com/old' })
    );

    expect(outcome.status).toBe('COMPLETED');
    expect(calls).toHaveLength(2);
  });

  /**
   * The reason redirects are followed manually.
   *
   * `redirect: 'follow'` would let a perfectly public URL bounce to
   * 169.254.169.254 and defeat the entire guard.
   */
  it('re-checks the guard at every hop', async () => {
    const { impl } = stubFetch(() => ({
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    }));

    const outcome = await new HttpTaskExecutor({
      allowedHosts: ['api.example.com'],
      fetch: impl,
    }).execute(contextFor({ uri: 'https://api.example.com/bounce' }));

    if (outcome.status !== 'FAILED') throw new Error('expected failure');
    expect(outcome.reason).toMatch(/redirect .*blocked/);
  });

  // Forwarding an Authorization header to wherever a redirect points is how
  // credentials leak to third parties.
  it('drops headers when a redirect changes host', async () => {
    const { impl, calls } = stubFetch((url) =>
      url.includes('api.example.com')
        ? { status: 302, headers: { location: 'https://other.example.com/x' } }
        : { body: '{}' }
    );

    await executor({ fetch: impl }).execute(
      contextFor({
        uri: 'https://api.example.com/start',
        headers: { authorization: 'Bearer secret' },
      })
    );

    const forwarded = calls[1].init?.headers as Record<string, string>;
    expect(forwarded['authorization']).toBeUndefined();
  });

  it('gives up after too many hops', async () => {
    const { impl } = stubFetch(() => ({
      status: 302,
      headers: { location: 'https://api.example.com/again' },
    }));

    const outcome = await executor({ fetch: impl, maxRedirects: 2 }).execute(
      contextFor({ uri: 'https://api.example.com/loop' })
    );

    if (outcome.status !== 'FAILED') throw new Error('expected failure');
    expect(outcome.reason).toMatch(/more than 2 redirects/);
  });
});

describe('response limits and redaction', () => {
  // `Content-Length` is a hint a hostile server need not honour, so the body is
  // counted as it streams.
  it('refuses an oversized response', async () => {
    const { impl } = stubFetch(() => ({ body: 'x'.repeat(5_000) }));

    const outcome = await executor({ fetch: impl, maxResponseBytes: 1_000 }).execute(
      contextFor({ uri: 'https://api.example.com/big' })
    );

    if (outcome.status !== 'FAILED') throw new Error('expected failure');
    expect(outcome.reason).toMatch(/exceeded 1000 bytes/);
  });

  // A task's output is stored, searchable and shown in the UI. A Set-Cookie
  // there is a credential outliving its request somewhere nobody looks.
  it('redacts credential-bearing response headers', async () => {
    const { impl } = stubFetch(() => ({
      body: '{}',
      headers: { 'set-cookie': 'session=secret', 'x-request-id': 'abc' },
    }));

    const outcome = await executor({ fetch: impl }).execute(
      contextFor({ uri: 'https://api.example.com/x' })
    );

    if (outcome.status !== 'COMPLETED') throw new Error('expected success');
    const headers = outcome.output?.['headers'] as Record<string, string>;

    expect(headers['set-cookie']).toBe('[redacted]');
    expect(headers['x-request-id']).toBe('abc');
  });
});

/**
 * The breaker, from the task's point of view.
 *
 * What matters here is not the state machine — that is covered in
 * `circuit-breaker.spec.ts` — but the two things only this seam can get wrong:
 * which outcomes are counted as the dependency's fault, and whether an open
 * breaker fails in a way the retry policy can recover from.
 */
describe('circuit breaking', () => {
  const breakerFor = (now: () => number) =>
    new CircuitBreaker({ enabled: true, minimumRequests: 3, failureRatio: 0.5, windowMs: 10_000, openMs: 1000, now });

  it('stops calling a host that is failing, without spending the request', async () => {
    const now = 1000;
    const breaker = breakerFor(() => now);
    const { impl, calls } = stubFetch(() => ({ status: 503, body: '{}' }));
    const task = executor({ fetch: impl, breaker });

    for (let i = 0; i < 3; i++) await task.execute(contextFor({ uri: 'https://api.example.com/x' }));
    expect(calls).toHaveLength(3);

    const refused = await task.execute(contextFor({ uri: 'https://api.example.com/x' }));
    // No fourth request: failing fast is the whole point — those attempts were
    // occupying a runner that every other workflow shares.
    expect(calls).toHaveLength(3);
    expect(refused.status).toBe('FAILED');
    if (refused.status === 'FAILED') {
      expect(refused.reason).toMatch(/circuit open/);
      // Not terminal: the host is expected back, and a terminal failure here
      // would turn a transient outage into permanently dead workflows.
      expect(refused.terminal).toBe(false);
    }

    // A healthy host is unaffected.
    const other = await executor({ fetch: stubFetch(() => ({ status: 200, body: '{}' })).impl, breaker }).execute(
      contextFor({ uri: 'https://other.example.com/x' })
    );
    expect(other.status).toBe('COMPLETED');
  });

  it('does not open on 4xx, which says the request was wrong, not the host', async () => {
    const now = 1000;
    const breaker = breakerFor(() => now);
    const { impl, calls } = stubFetch(() => ({ status: 404, body: '{}' }));
    const task = executor({ fetch: impl, breaker });

    for (let i = 0; i < 6; i++) await task.execute(contextFor({ uri: 'https://api.example.com/missing' }));

    // Every one of them was attempted: one workflow with a bad URL must not
    // open the breaker for every other workflow calling the same host.
    expect(calls).toHaveLength(6);
    expect(breaker.stateOf('https://api.example.com')).toBe('closed');
  });

  it('lets one request through once the host has had time to recover', async () => {
    let now = 1000;
    const breaker = breakerFor(() => now);
    let status = 500;
    const { impl, calls } = stubFetch(() => ({ status, body: '{}' }));
    const task = executor({ fetch: impl, breaker });

    for (let i = 0; i < 3; i++) await task.execute(contextFor({ uri: 'https://api.example.com/x' }));
    const before = calls.length;

    now += 1000;
    status = 200;
    const probe = await task.execute(contextFor({ uri: 'https://api.example.com/x' }));

    expect(calls.length).toBe(before + 1);
    expect(probe.status).toBe('COMPLETED');
    // The probe succeeded, so everyone is let back in.
    expect(breaker.stateOf('https://api.example.com')).toBe('closed');
    expect((await task.execute(contextFor({ uri: 'https://api.example.com/x' }))).status).toBe('COMPLETED');
  });
});

/**
 * Calling a registered service instead of a URL.
 *
 * The point of the registry is that a definition names a service and the server
 * supplies where it lives and what authorises it — so the tests that matter are
 * the ones about what a definition must *not* be able to do with that.
 */
describe('registered services', () => {
  const registry = (service?: Partial<{ baseUrl: string; headers: Record<string, string>; timeoutMs: number }>) => ({
    httpService: async (_ns: string, name: string) =>
      name === 'billing'
        ? {
            name,
            baseUrl: 'https://api.example.com/v2',
            headers: { authorization: 'Bearer service-key' },
            ...service,
          }
        : undefined,
  });

  it('joins the path onto the registered base URL and adds its headers', async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: '{"ok":true}' }));
    const outcome = await executor({ fetch: impl, services: registry() }).execute(
      contextFor({ service: 'billing', path: '/invoices', method: 'POST', body: { total: 42 }, query: { dryRun: 'true' } })
    );

    expect(outcome.status).toBe('COMPLETED');
    expect(calls[0].url).toBe('https://api.example.com/v2/invoices?dryRun=true');
    expect((calls[0].init?.headers as Record<string, string>)['authorization']).toBe('Bearer service-key');
  });

  it('will not let a definition overwrite the credential the service supplies', async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: '{}' }));
    await executor({ fetch: impl, services: registry() }).execute(
      contextFor({
        service: 'billing',
        path: '/invoices',
        headers: { Authorization: 'Bearer attacker-chosen', 'x-correlation-id': 'abc' },
      })
    );

    const headers = calls[0].init?.headers as Record<string, string>;
    // The task's own headers still apply — it just cannot replace the one that
    // would let it send the service's key somewhere else.
    expect(headers['x-correlation-id']).toBe('abc');
    expect(headers['authorization']).toBe('Bearer attacker-chosen');
  });

  it('refuses a path that climbs out of the base URL', async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: '{}' }));
    const outcome = await executor({ fetch: impl, services: registry() }).execute(
      contextFor({ service: 'billing', path: '../../admin/keys' })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    if (outcome.status === 'FAILED') expect(outcome.reason).toMatch(/leaves the base URL/);
    expect(calls).toHaveLength(0);
  });

  it('says so when the service is unknown, or when both a service and a uri are given', async () => {
    const { impl } = stubFetch(() => ({ status: 200, body: '{}' }));
    const task = executor({ fetch: impl, services: registry() });

    expect(await task.execute(contextFor({ service: 'nope', path: '/x' }))).toMatchObject({
      status: 'FAILED',
      terminal: true,
      reason: expect.stringMatching(/no enabled HTTP service "nope"/),
    });

    expect(await task.execute(contextFor({ service: 'billing', uri: 'https://api.example.com/x' }))).toMatchObject({
      status: 'FAILED',
      reason: expect.stringMatching(/either "service" or "uri"/),
    });

    // No registry configured at all: the task says that rather than guessing.
    expect(await executor({ fetch: impl }).execute(contextFor({ service: 'billing', path: '/x' }))).toMatchObject({
      status: 'FAILED',
      reason: expect.stringMatching(/no service registry/),
    });
  });

  it('still applies the SSRF guard to whatever the registry returns', async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: '{}' }));
    const outcome = await executor({
      fetch: impl,
      services: registry({ baseUrl: 'http://169.254.169.254/latest' }),
    }).execute(contextFor({ service: 'billing', path: '/meta-data/iam' }));

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    expect(calls).toHaveLength(0);
  });
});
