import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Io } from './commands.js';
import { run } from './main.js';

/** A recording Io with a scripted API behind fetch. */
function fakeIo(routes: Record<string, (body: unknown, call: number) => { status?: number; body: unknown }>) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
  const counts = new Map<string, number>();
  const io: Io = {
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    env: { NF_URL: 'http://api.test', NF_API_KEY: 'nf_key', NF_NAMESPACE: 'acme' },
    sleep: async () => undefined,
    fetch: (async (url: string, init: RequestInit) => {
      const path = `${init.method} ${url.replace('http://api.test/v1/ns/acme', '')}`;
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: String(init.method), url, headers: init.headers as Record<string, string>, body });
      const handler = routes[path];
      const n = counts.get(path) ?? 0;
      counts.set(path, n + 1);
      const reply = handler ? handler(body, n) : { status: 404, body: { message: `no route ${path}` } };
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }) as never,
  };
  return { io, out: () => out.join(''), err: () => err.join(''), calls };
}

describe('nf run', () => {
  it('starts with the configured key and namespace and waits for the result', async () => {
    const api = fakeIo({
      'POST /executions/checkout/execute': (body) => ({ body: { workflowId: 'wf-1', reached: true, status: 'COMPLETED', output: { total: 42 }, echoed: body } }),
    });
    const code = await run(['run', 'checkout', '--input', '{"qty":2}', '--wait', '10'], api.io);
    expect(code).toBe(0);
    expect(api.calls[0]).toMatchObject({ headers: { 'x-api-key': 'nf_key' }, body: { input: { qty: 2 }, waitForSeconds: 10 } });
    expect(api.out()).toContain('wf-1  COMPLETED');
    expect(api.out()).toContain('"total": 42');
  });

  it('exits 2 when the run did not finish in time, and 1 with the server message on an error', async () => {
    const slow = fakeIo({ 'POST /executions/slow/execute': () => ({ body: { workflowId: 'wf-2', reached: false, status: 'RUNNING' } }) });
    expect(await run(['run', 'slow', '--wait', '1'], slow.io)).toBe(2);
    const bad = fakeIo({ 'POST /executions/nope': () => ({ status: 404, body: { message: 'no workflow "nope" is registered' } }) });
    expect(await run(['run', 'nope'], bad.io)).toBe(1);
    expect(bad.err()).toContain('no workflow "nope" is registered');
    expect(await run(['run', 'x', '--input', 'not json'], bad.io)).toBe(1);
    expect(bad.err()).toContain('--input must be a JSON object');
  });
});

describe('nf tail', () => {
  it('prints each task change once and ends with the run', async () => {
    const states = [
      { status: 'RUNNING', tasks: [{ refName: 'charge', taskType: 'SIMPLE', status: 'SCHEDULED', attempt: 0, iteration: 0 }] },
      { status: 'RUNNING', tasks: [{ refName: 'charge', taskType: 'SIMPLE', status: 'SCHEDULED', attempt: 0, iteration: 0 }] },
      {
        status: 'FAILED',
        reasonForIncompletion: 'card declined',
        tasks: [{ refName: 'charge', taskType: 'SIMPLE', status: 'FAILED', attempt: 0, iteration: 0, reasonForIncompletion: 'card declined' }],
      },
    ];
    const api = fakeIo({ 'GET /executions/wf-9': (_b, n) => ({ body: states[Math.min(n, 2)] }) });
    expect(await run(['tail', 'wf-9', '--json'], api.io)).toBe(1);
    const lines = api.out().trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.status)).toEqual(['SCHEDULED', 'FAILED']);
    expect(lines[1]).toMatchObject({ task: 'charge', reason: 'card declined' });
  });
});

describe('nf test', () => {
  it('runs workflow tests offline and fails the build on a broken expectation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nf-test-'));
    const definition = {
      name: 'quote',
      version: 1,
      tasks: [{ name: 'price', taskReferenceName: 'price', type: 'SIMPLE' }],
      outputParameters: { total: '${price.output.total}' },
    };
    await writeFile(join(dir, 'passes.json'), JSON.stringify({ definition, mocks: { price: { output: { total: 9 } } }, expect: { status: 'COMPLETED', output: { total: 9 }, tasks: { price: 'COMPLETED' } } }));
    await writeFile(join(dir, 'fails.json'), JSON.stringify({ definition, mocks: { price: { status: 'FAILED', reason: 'down' } }, expect: { status: 'COMPLETED' } }));
    await writeFile(join(dir, 'notes.txt'), 'ignored');

    const api = fakeIo({});
    expect(await run(['test', dir], api.io)).toBe(1);
    expect(api.out()).toContain('✗');
    expect(api.out()).toContain('✓');
    expect(api.out()).toContain('status FAILED, expected COMPLETED');
    expect(api.out()).toContain('1 passed, 1 failed');
    // Offline: nothing was fetched.
    expect(api.calls).toEqual([]);
  });
});

describe('nf replay and workflows', () => {
  it('reports divergences and lists latest versions', async () => {
    const api = fakeIo({
      'POST /executions/wf-1/replay': () => ({ body: { matches: false, replayedVersion: 2, recordedVersion: 1, divergences: [{ message: 'ship was COMPLETED, replayed as SKIPPED' }] } }),
      'GET /metadata/workflows': () => ({ body: [{ name: 'a', version: 1, tags: [] }, { name: 'a', version: 3, tags: ['team:x'] }, { name: 'b', version: 2, tags: [] }] }),
    });
    expect(await run(['replay', 'wf-1', '--version', '2'], api.io)).toBe(1);
    expect(api.calls[0].body).toEqual({ version: 2 });
    expect(api.out()).toContain('ship was COMPLETED, replayed as SKIPPED');
    expect(await run(['workflows', 'list'], api.io)).toBe(0);
    expect(api.out()).toMatch(/a\s+v3\s+team:x/);
    expect(api.out()).not.toMatch(/a\s+v1/);
  });

  it('names what is missing when there is no key', async () => {
    const api = fakeIo({});
    api.io.env = {};
    expect(await run(['workflows', 'list'], api.io)).toBe(1);
    expect(api.err()).toContain('missing --api-key (or $NF_API_KEY)');
  });
});
