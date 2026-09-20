import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Scope } from '@node-flow-dev/core';
import { IdentityRepository, createDatabase, migrate } from '@node-flow-dev/store';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApp, createAdapter } from '../configure-app.js';

/**
 * The live execution stream, over a real socket.
 *
 * `app.inject()` is deliberately not used here. It buffers a response until it
 * ends, which means a stream that stays open — the entire point of this feature
 * — would simply hang, and the tests that did pass would be the ones exercising
 * the case where nothing streams at all. So this boots on a real port and reads
 * the body incrementally, the way a browser does.
 */

function ensureDockerHost(): void {
  if (process.env['DOCKER_HOST']) return;
  const home = homedir();
  const socket = [
    '/var/run/docker.sock',
    join(home, '.orbstack/run/docker.sock'),
    join(home, '.colima/default/docker.sock'),
    join(home, '.docker/run/docker.sock'),
    join(home, '.rd/docker.sock'),
  ].find((path) => existsSync(path));
  if (!socket) return;
  process.env['DOCKER_HOST'] = `unix://${socket}`;
  process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] ??= socket;
}

let container: StartedPostgreSqlContainer;
let app: NestFastifyApplication;
let identity: IdentityRepository;
let namespaceId: string;
let otherNamespaceId: string;
let base: string;
let adminKey: string;
let otherKey: string;

/**
 * A definition whose task names are unique per test.
 *
 * Queues are shared across every execution in the namespace, and tasks these
 * tests never lease stay in them — so a later test leasing `charge` can be
 * handed an earlier test's task, report it against the wrong workflow, and fail
 * with a 409 that says nothing about the actual cause. One queue per test
 * removes the interference rather than tolerating it.
 */
const definitionFor = (suffix: number) => ({
  name: `streamed-${suffix}`,
  version: 1,
  tasks: [
    { name: `charge-${suffix}`, taskReferenceName: 'charge', type: 'SIMPLE' },
    { name: `ship-${suffix}`, taskReferenceName: 'ship', type: 'SIMPLE' },
  ],
});

beforeAll(async () => {
  ensureDockerHost();
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('nodeflow_realtime')
    .withUsername('nodeflow')
    .withPassword('nodeflow')
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off'])
    .start();

  const seed = createDatabase({ url: container.getConnectionUri() });
  await migrate(seed);
  const rows = await seed
    .insertInto('Namespaces')
    .values([{ slug: 'acme' }, { slug: 'other' }])
    .returning(['id', 'slug'])
    .execute();
  namespaceId = rows.find((r) => r.slug === 'acme')!.id;
  otherNamespaceId = rows.find((r) => r.slug === 'other')!.id;
  await seed.destroy();

  Object.assign(process.env, {
    DATABASE_URL: container.getConnectionUri(),
    NODE_FLOW_JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    NODE_FLOW_ROLES: 'api,decider,poller',
    NODE_ENV: 'test',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);

  // A real port, because the whole feature is about a connection that stays
  // open — see the note above.
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();

  identity = app.get(IdentityRepository);
}, 240_000);

afterAll(async () => {
  await app?.close();
  await container?.stop();
}, 60_000);

let seq = 0;

beforeEach(async () => {
  adminKey = (
    await identity.createApiKey({ namespaceId, name: `admin-${++seq}`, scopes: [Scope.ADMIN] })
  ).token;
  otherKey = (
    await identity.createApiKey({
      namespaceId: otherNamespaceId,
      name: `other-${seq}`,
      scopes: [Scope.ADMIN],
    })
  ).token;
});

const api = (path: string, key: string, init: RequestInit = {}) =>
  fetch(`${base}/v1/ns/acme${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      ...(init.headers ?? {}),
    },
  });

async function startExecution(): Promise<string> {
  await api('/metadata/workflows', adminKey, {
    method: 'POST',
    body: JSON.stringify(definitionFor(seq)),
  });

  const response = await api(`/executions/streamed-${seq}`, adminKey, {
    method: 'POST',
    body: JSON.stringify({ input: {} }),
  });

  return ((await response.json()) as { workflowId: string }).workflowId;
}

/**
 * Reads SSE frames until `count` have arrived or the stream ends.
 *
 * Parses frames rather than matching on substrings: `id:` and `event:` are the
 * fields that make the stream resumable, and a test that only looked at `data:`
 * would pass just as well with them missing.
 */
async function readEvents(
  response: Response,
  count: number,
  timeoutMs = 15_000
): Promise<{ id: string; event: string; data: Record<string, unknown> }[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: { id: string; event: string; data: Record<string, unknown> }[] = [];
  let buffer = '';

  const deadline = setTimeout(() => void reader.cancel(), timeoutMs);

  try {
    while (frames.length < count) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        const fields: Record<string, string> = {};
        for (const line of frame.split('\n')) {
          const colon = line.indexOf(':');
          if (colon <= 0) continue;
          fields[line.slice(0, colon)] = line.slice(colon + 1).trim();
        }

        if (fields['data'] === undefined) continue;
        frames.push({
          id: fields['id'] ?? '',
          event: fields['event'] ?? '',
          data: JSON.parse(fields['data']),
        });
      }
    }
  } finally {
    clearTimeout(deadline);
    await reader.cancel().catch(() => undefined);
  }

  return frames;
}

/** Leases one task, waiting for the decider to schedule it. */
async function leaseOne(
  queue: string,
  attempts = 40
): Promise<{ taskId: string; leaseToken: string } | undefined> {
  for (let i = 0; i < attempts; i++) {
    const response = await api(`/queues/${queue}/lease`, adminKey, {
      method: 'POST',
      body: JSON.stringify({ workerId: 'w-1', count: 1, leaseSeconds: 60 }),
    });

    const { tasks } = (await response.json()) as {
      tasks?: { taskId: string; leaseToken: string }[];
    };
    const [task] = tasks ?? [];
    if (task) return task;

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return undefined;
}

describe('the live execution stream', () => {
  it('opens as an event stream', async () => {
    const workflowId = await startExecution();
    const response = await api(`/executions/${workflowId}/stream`, adminKey);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    await response.body?.cancel();
  });

  it('delivers the events that already happened', async () => {
    const workflowId = await startExecution();

    const response = await api(`/executions/${workflowId}/stream`, adminKey);
    const frames = await readEvents(response, 2);

    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0].event).toBe('workflow.started');
    expect(frames.map((frame) => frame.data['seq'])).toEqual([1, 2]);
  });

  it('carries the sequence number as the event id, which is what makes it resumable', async () => {
    const workflowId = await startExecution();

    const response = await api(`/executions/${workflowId}/stream`, adminKey);
    const frames = await readEvents(response, 2);

    expect(frames.map((frame) => frame.id)).toEqual(['1', '2']);
  });

  it('resumes from Last-Event-ID, sending nothing already seen', async () => {
    const workflowId = await startExecution();

    const response = await api(`/executions/${workflowId}/stream`, adminKey, {
      headers: { 'last-event-id': '1' },
    });
    const frames = await readEvents(response, 1);

    expect(frames[0].data['seq']).toBe(2);
    expect(frames.some((frame) => frame.data['seq'] === 1)).toBe(false);
  });

  it('accepts the cursor as a query parameter too, for clients that are not EventSource', async () => {
    const workflowId = await startExecution();

    const response = await api(`/executions/${workflowId}/stream?lastEventId=1`, adminKey);
    const frames = await readEvents(response, 1);

    expect(frames[0].data['seq']).toBe(2);
  });

  it('treats a nonsense cursor as the beginning rather than trusting it', async () => {
    const workflowId = await startExecution();

    const response = await api(`/executions/${workflowId}/stream?lastEventId=-5`, adminKey);
    const frames = await readEvents(response, 1);

    expect(frames[0].data['seq']).toBe(1);
  });

  it('pushes an event that happens while the stream is open', async () => {
    const workflowId = await startExecution();

    // Opened *before* the task is completed, so what arrives is genuinely
    // pushed rather than read out of history at connect time. This is the
    // property the whole feature exists for, and the only one that fails if
    // the trigger, the listener or the fanout is broken.
    const response = await api(`/executions/${workflowId}/stream`, adminKey);
    const reader = readEvents(response, 3);

    // The decider schedules `charge` asynchronously, so the queue is empty for
    // a moment after the start returns. Leasing once and reading `tasks[0]`
    // undefined would make this test fail as a timeout with nothing to say
    // about why.
    const task = await leaseOne(`charge-${seq}`);
    expect(task, 'no task became leasable').toBeDefined();

    const reported = await api(`/tasks/${task!.taskId}/report`, adminKey, {
      method: 'POST',
      body: JSON.stringify({
        queueName: `charge-${seq}`,
        workflowId,
        leaseToken: task!.leaseToken,
        status: 'COMPLETED',
        output: {},
      }),
    });
    expect(reported.status).toBe(200);

    const frames = await reader;
    expect(frames.map((frame) => frame.event)).toContain('task.completed');
  });

  it('refuses a stream for another namespace’s execution', async () => {
    const workflowId = await startExecution();

    const response = await fetch(`${base}/v1/ns/other/executions/${workflowId}/stream`, {
      headers: { 'x-api-key': otherKey },
    });

    expect(response.status).toBe(404);
    await response.body?.cancel();
  });

  // Found as a flake: one run in several, this returned 200 and an open, empty
  // event stream instead of 404. Nest does not await an @Sse() handler before
  // starting the response, so a refusal thrown from inside the handler raced
  // the headers. No event data leaked — the refusal still prevented the
  // subscription — but an authorisation failure answered with a success is
  // wrong regardless, and an open stream per refused request is a resource
  // leak. Fifty concurrent attempts make the race reproducible on demand.
  it('refuses every concurrent attempt on another namespace’s execution, not most of them', async () => {
    const workflowId = await startExecution();

    const statuses = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const response = await fetch(`${base}/v1/ns/other/executions/${workflowId}/stream`, {
          headers: { 'x-api-key': otherKey },
        });
        await response.body?.cancel();
        return response.status;
      })
    );

    expect(statuses.filter((status) => status !== 404)).toEqual([]);
  });

  it('refuses an unauthenticated stream', async () => {
    const workflowId = await startExecution();

    const response = await fetch(`${base}/v1/ns/acme/executions/${workflowId}/stream`);

    expect(response.status).toBe(401);
    await response.body?.cancel();
  });

  it('404s a malformed id rather than failing with a driver error', async () => {
    const response = await api('/executions/not-a-uuid/stream', adminKey);

    expect(response.status).toBe(404);
    await response.body?.cancel();
  });
});

describe('masked fields on the stream', () => {
  it('sends event payloads with the definition’s masked fields hidden', async () => {
    const name = `masked-stream-${seq}`;
    await api('/metadata/workflows', adminKey, {
      method: 'POST',
      body: JSON.stringify({
        name,
        version: 1,
        maskedFields: ['password'],
        outputParameters: { password: '${workflow.input.password}' },
        tasks: [
          { name: 'remember', taskReferenceName: 'remember', type: 'SET_VARIABLE', inputParameters: { password: '${workflow.input.password}' } },
        ],
      }),
    });
    const started = await api(`/executions/${name}`, adminKey, {
      method: 'POST',
      body: JSON.stringify({ input: { password: 'hunter2' } }),
    });
    const { workflowId } = (await started.json()) as { workflowId: string };

    const frames = await readEvents(await api(`/executions/${workflowId}/stream`, adminKey), 50, 10_000);

    const variables = frames.find((frame) => frame.event === 'variables.set');
    const completed = frames.find((frame) => frame.event === 'workflow.completed');
    expect(variables?.data['payload']).toEqual({ password: '***' });
    expect(completed?.data['payload']).toEqual({ output: { password: '***' } });
    expect(JSON.stringify(frames)).not.toContain('hunter2');
  });
});
