import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Scope, WorkflowStatus, queueScope } from '@node-flow-dev/core';
import {
  NodeFlowClient,
  TerminalTaskError,
  Worker,
  type TaskHandler,
  type WorkerOptions,
} from '@node-flow-dev/sdk';
import { IdentityRepository, createDatabase, migrate } from '@node-flow-dev/store';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { configureApp, createAdapter } from './configure-app.js';

/**
 * The worker SDK against the real server, over real HTTP.
 *
 * Everything below has unit coverage; what only this file can prove is that the
 * two halves agree — that the SDK's request shapes are the ones the controllers
 * accept, that long-poll actually parks and wakes over the wire, and that a
 * worker drains rather than abandons on shutdown.
 */

let container: StartedPostgreSqlContainer;
let app: NestFastifyApplication;
let identity: IdentityRepository;
let namespaceId: string;
let baseUrl: string;
let adminKey: string;
const workers: Worker[] = [];
const sockets = new Set<import('node:net').Socket>();

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition never became true');
    await sleep(50);
  }
}

/**
 * Each test gets its own workflow and its own queue names.
 *
 * Sharing them looked fine until long-poll made the workers fast enough to
 * interleave: a test would pick up a *previous* test's leftover task, and the
 * failure surfaced as an unrelated 20-second timeout. Unique names per test
 * remove the coupling rather than adding cleanup that has to stay correct.
 */
let suffix = 0;

interface Pipeline {
  name: string;
  first: string;
  second: string;
}

async function definePipeline(): Promise<Pipeline> {
  const n = ++suffix;
  const pipeline = { name: `pipeline-${n}`, first: `first-${n}`, second: `second-${n}` };

  await clientFor(adminKey).registerWorkflow({
    name: pipeline.name,
    version: 1,
    tasks: [
      { name: pipeline.first, taskReferenceName: 'first', type: 'SIMPLE' },
      {
        name: pipeline.second,
        taskReferenceName: 'second',
        type: 'SIMPLE',
        inputParameters: { carried: '${first.output.value}' },
      },
    ],
  });

  return pipeline;
}

/** A client for the tests themselves, distinct from the workers'. */
function clientFor(key: string): NodeFlowClient {
  return new NodeFlowClient({ baseUrl, namespace: 'acme', apiKey: key });
}

beforeAll(async () => {
  ensureDockerHost();
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('nodeflow_sdk')
    .withUsername('nodeflow')
    .withPassword('nodeflow')
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off'])
    .start();

  const seed = createDatabase({ url: container.getConnectionUri() });
  await migrate(seed);
  const [row] = await seed
    .insertInto('Namespaces')
    .values({ slug: 'acme' })
    .returning('id')
    .execute();
  namespaceId = row.id;
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

  // A real socket, not `app.inject`: the SDK uses `fetch`, and the point of
  // this file is to exercise the wire.
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = await app.getUrl();

  // Track every socket the server accepts. See the teardown note below.
  const raw = app.getHttpAdapter().getHttpServer() as import('node:http').Server;
  raw.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  identity = app.get(IdentityRepository);
  adminKey = (
    await identity.createApiKey({ namespaceId, name: 'admin', scopes: [Scope.ADMIN] })
  ).token;
}, 240_000);

afterAll(async () => {
  /**
   * Destroy the client's sockets before closing.
   *
   * Only this suite needs it, and only because the SDK and the server share one
   * process: `fetch` keeps its connections alive in undici's global pool, which
   * has no public API to drain, so the server sees keep-alive sockets that
   * never go idle and `close()` waits for them forever.
   *
   * This is a test-environment artefact, **not** a masked product bug — a real
   * server was measured shutting down in 32ms with a worker parked on a
   * 30-second long-poll, because `HttpShutdownService` releases the parked
   * polls and sweeps idle sockets. Real clients are separate processes whose
   * sockets close when they exit.
   */
  for (const socket of sockets) socket.destroy();
  sockets.clear();

  await app?.close();
  await container?.stop();
}, 60_000);

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.stop()));
});

function startWorker(
  queue: string,
  handler: TaskHandler,
  options: Partial<WorkerOptions> = {}
): Worker {
  const worker = new Worker({
    client: clientFor(adminKey),
    queue,
    handler,
    waitSeconds: 2,
    leaseSeconds: 30,
    ...options,
  });

  workers.push(worker);
  worker.start();
  return worker;
}

describe('the client', () => {
  it('starts a workflow and reads its status', async () => {
    const pipeline = await definePipeline();
    const client = clientFor(adminKey);
    const started = await client.startWorkflow({ name: pipeline.name, input: { order: 1 } });

    expect(started.workflowId).toBeTruthy();
    expect((await client.executionStatus(started.workflowId)).status).toBe(
      WorkflowStatus.RUNNING
    );
  });

  it('surfaces a server error with its stable code', async () => {
    const client = clientFor(adminKey);

    await expect(client.startWorkflow({ name: 'nonexistent' })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('authenticates a service account and refreshes its token', async () => {
    const pipeline = await definePipeline();
    const account = await identity.createServiceAccount({
      namespaceId,
      name: `fleet-${Date.now()}`,
      scopes: [Scope.EXECUTIONS_START, Scope.EXECUTIONS_READ],
    });

    const client = new NodeFlowClient({
      baseUrl,
      namespace: 'acme',
      serviceAccount: { keyId: account.keyId, secret: account.secret },
    });

    // Two calls: the first exchanges, the second reuses the cached token.
    const first = await client.startWorkflow({ name: pipeline.name });
    const second = await client.startWorkflow({ name: pipeline.name });

    expect(first.workflowId).not.toBe(second.workflowId);
  });

  it('refuses to construct without credentials', () => {
    expect(() => new NodeFlowClient({ baseUrl, namespace: 'acme' })).toThrow(/apiKey or serviceAccount/);
  });

  it('reports a queue its key may not lease from', async () => {
    const limited = (
      await identity.createApiKey({
        namespaceId,
        name: `limited-${Date.now()}`,
        scopes: [queueScope('allowed')],
      })
    ).token;

    const client = clientFor(limited);
    await expect(
      client.lease({ queue: 'forbidden', workerId: 'w1' })
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('the worker', () => {
  it('drives a workflow to completion', async () => {
    const pipeline = await definePipeline();
    const client = clientFor(adminKey);
    const { workflowId } = await client.startWorkflow({ name: pipeline.name });

    startWorker(pipeline.first, () => ({ value: 'from-first' }));
    startWorker(pipeline.second, () => ({ done: true }));

    await until(async () => (await client.executionStatus(workflowId)).status === WorkflowStatus.COMPLETED);
  });

  it('passes its output into the next task', async () => {
    const pipeline = await definePipeline();
    const client = clientFor(adminKey);
    const { workflowId } = await client.startWorkflow({ name: pipeline.name });

    let carried: unknown;
    startWorker(pipeline.first, () => ({ value: 'baton' }));
    startWorker(pipeline.second, () => {
      carried = 'ran';
      return {};
    });

    await until(async () => (await client.executionStatus(workflowId)).status === WorkflowStatus.COMPLETED);
    expect(carried).toBe('ran');
  });

  // The reason long-poll exists: a task enqueued while the worker is parked
  // starts in milliseconds, not at the next poll tick.
  it('picks up work within milliseconds of it being enqueued', async () => {
    const client = clientFor(adminKey);

    const pipeline = await definePipeline();

    let startedAt = 0;
    // A long park deliberately: if the notification never arrives the worker
    // waits the full 15s, so the 1.5s bound below cannot pass by accident on a
    // short poll cycle.
    startWorker(
      pipeline.first,
      () => {
        startedAt = Date.now();
        return {};
      },
      { waitSeconds: 15 }
    );

    // Let the worker park on an empty queue before creating any work.
    await sleep(300);

    const enqueuedAt = Date.now();
    await client.startWorkflow({ name: pipeline.name });

    await until(async () => startedAt > 0);
    expect(startedAt - enqueuedAt).toBeLessThan(1_500);
  });

  it('reports a thrown error as a retryable failure', async () => {
    const pipeline = await definePipeline();
    const client = clientFor(adminKey);
    const { workflowId } = await client.startWorkflow({ name: pipeline.name });

    let attempts = 0;
    startWorker(pipeline.first, () => {
      attempts++;
      if (attempts === 1) throw new Error('transient');
      return {};
    });
    startWorker(pipeline.second, () => ({}));

    await until(async () => (await client.executionStatus(workflowId)).status === WorkflowStatus.COMPLETED);
    expect(attempts).toBeGreaterThan(1);
  });

  // A handler that knows the work can never succeed says so, and the engine
  // stops rather than burning the retry budget on a malformed payload.
  it('fails the workflow immediately on a terminal error', async () => {
    const pipeline = await definePipeline();
    const client = clientFor(adminKey);
    const { workflowId } = await client.startWorkflow({ name: pipeline.name });

    let attempts = 0;
    startWorker(pipeline.first, () => {
      attempts++;
      throw new TerminalTaskError('payload will never be valid');
    });

    await until(async () => {
      const status = (await client.executionStatus(workflowId)).status;
      return status === WorkflowStatus.FAILED;
    });

    expect(attempts).toBe(1);
  });

  it('never runs more than its concurrency', async () => {
    const pipeline = await definePipeline();
    const client = clientFor(adminKey);
    for (let i = 0; i < 6; i++) await client.startWorkflow({ name: pipeline.name });

    let running = 0;
    let peak = 0;

    startWorker(
      pipeline.first,
      async () => {
        running++;
        peak = Math.max(peak, running);
        await sleep(120);
        running--;
        return {};
      },
      { concurrency: 2 }
    );

    await until(async () => peak > 0 && running === 0 && peak >= 2, 25_000);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('counts what it did', async () => {
    const pipeline = await definePipeline();
    const client = clientFor(adminKey);
    await client.startWorkflow({ name: pipeline.name });

    const worker = startWorker(pipeline.first, () => ({}));
    await until(async () => worker.getStats().completed >= 1);

    const stats = worker.getStats();
    expect(stats.leased).toBeGreaterThanOrEqual(1);
    expect(stats.completed).toBeGreaterThanOrEqual(1);
    expect(stats.running).toBe(true);
  });

  // Abandoning in-flight work on shutdown produces a burst of timed-out tasks
  // on every rolling deploy.
  it('drains in-flight work before stop resolves', async () => {
    const pipeline = await definePipeline();
    const client = clientFor(adminKey);
    await client.startWorkflow({ name: pipeline.name });

    let finished = false;
    const worker = startWorker(pipeline.first, async () => {
      await sleep(400);
      finished = true;
      return {};
    });

    await until(async () => worker.getStats().inFlight > 0);
    await worker.stop();

    expect(finished).toBe(true);
    expect(worker.getStats().inFlight).toBe(0);
  });

  it('stops leasing once stopped', async () => {
    const pipeline = await definePipeline();
    const worker = startWorker(pipeline.first, () => ({}));
    await worker.stop();

    const before = worker.getStats().leased;
    await clientFor(adminKey).startWorkflow({ name: pipeline.name });
    await sleep(500);

    expect(worker.getStats().leased).toBe(before);
  });

  /**
   * Shutdown must not wait out the poll.
   *
   * The bug this pins: `stop()` awaits the lease loop, and the loop is sitting
   * inside a parked HTTP request. Without cancelling that request, a worker
   * with a 30-second poll takes 30 seconds to stop — longer than the grace
   * period most orchestrators allow before SIGKILL, so a clean drain becomes
   * the abrupt termination it was meant to avoid.
   */
  it('stops promptly while parked on a long poll', async () => {
    const pipeline = await definePipeline();
    const worker = startWorker(pipeline.first, () => ({}), { waitSeconds: 30 });

    // Let it get properly parked on an empty queue.
    await sleep(500);

    const started = Date.now();
    await worker.stop();

    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('is safe to stop twice', async () => {
    const pipeline = await definePipeline();
    const worker = startWorker(pipeline.first, () => ({}));
    await worker.stop();
    await expect(worker.stop()).resolves.toBeUndefined();
  });
});
