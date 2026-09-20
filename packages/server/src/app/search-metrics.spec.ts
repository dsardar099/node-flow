import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Scope, WorkflowStatus } from '@node-flow-dev/core';
import { IdentityRepository, createDatabase, migrate } from '@node-flow-dev/store';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { configureApp, createAdapter } from './configure-app.js';

/**
 * Search and the metrics endpoint, over the real API.
 *
 * The repository tests cover the query semantics. What only this level can
 * check is the routing and the authorization: that `POST /executions/search`
 * does not collide with `POST /executions/{name}`, and that the scrape endpoint
 * is not readable by an ordinary tenant credential.
 */

let container: StartedPostgreSqlContainer;
let app: NestFastifyApplication;
let identity: IdentityRepository;
let namespaceId: string;
let adminKey: string;
let readerKey: string;
let scraperKey: string;

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

function call(
  method: 'GET' | 'POST',
  url: string,
  options: { key?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.key) headers['x-api-key'] = options.key;

  return app.inject({
    method,
    url,
    headers,
    ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
  });
}

const json = (response: { body: string }) => JSON.parse(response.body);

beforeAll(async () => {
  ensureDockerHost();
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('nodeflow_search')
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
    NODE_FLOW_ROLES: 'api',
    NODE_ENV: 'test',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);

  identity = app.get(IdentityRepository);
  adminKey = (await identity.createApiKey({ namespaceId, name: 'admin', scopes: [Scope.ADMIN] }))
    .token;
  readerKey = (
    await identity.createApiKey({
      namespaceId,
      name: 'reader',
      scopes: [Scope.EXECUTIONS_READ, Scope.EXECUTIONS_START, Scope.WORKFLOWS_WRITE],
    })
  ).token;
  scraperKey = (
    await identity.createApiKey({
      namespaceId,
      name: 'scraper',
      scopes: [Scope.METRICS_READ],
    })
  ).token;

  await call('POST', '/v1/ns/acme/metadata/workflows', {
    key: adminKey,
    body: {
      name: 'checkout',
      version: 1,
      tasks: [{ name: 'charge', taskReferenceName: 'charge', type: 'SIMPLE' }],
    },
  });

  for (let i = 0; i < 7; i++) {
    await call('POST', '/v1/ns/acme/executions/checkout', {
      key: adminKey,
      body: { correlationId: i < 3 ? 'batch-a' : 'batch-b' },
    });
  }
}, 240_000);

afterAll(async () => {
  await app?.close();
  await container?.stop();
}, 60_000);

describe('routing', () => {
  /**
   * `POST /executions/search` and `POST /executions/{name}` are both one
   * segment after `/executions`.
   *
   * If the parameterised route won, "search" would be read as a workflow name —
   * so a search request would either 404 or, worse, *start a workflow*. Fastify
   * prefers the static segment, but that is a property of the router rather
   * than of anything in this codebase, so it is worth pinning.
   */
  it('does not mistake search for a workflow name', async () => {
    const response = await call('POST', '/v1/ns/acme/executions/search', {
      key: readerKey,
      body: {},
    });

    expect(response.statusCode).toBe(200);
    expect(json(response)).toHaveProperty('executions');
    expect(json(response)).not.toHaveProperty('workflowId');
  });

  it('still starts a workflow on the parameterised route', async () => {
    const response = await call('POST', '/v1/ns/acme/executions/checkout', {
      key: readerKey,
      body: {},
    });

    expect(response.statusCode).toBe(201);
    expect(json(response)).toHaveProperty('workflowId');
  });
});

describe('search', () => {
  it('returns executions newest first', async () => {
    const body = json(
      await call('POST', '/v1/ns/acme/executions/search', { key: readerKey, body: { limit: 3 } })
    );

    expect(body.executions).toHaveLength(3);
    expect(body.nextCursor).toBeDefined();
    const times = body.executions.map((e: { startedAt: string }) => Date.parse(e.startedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('pages with the cursor it returned', async () => {
    const first = json(
      await call('POST', '/v1/ns/acme/executions/search', { key: readerKey, body: { limit: 4 } })
    );
    const second = json(
      await call('POST', '/v1/ns/acme/executions/search', {
        key: readerKey,
        body: { limit: 4, cursor: first.nextCursor },
      })
    );

    const ids = [...first.executions, ...second.executions].map(
      (e: { workflowId: string }) => e.workflowId
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters by correlation id', async () => {
    const body = json(
      await call('POST', '/v1/ns/acme/executions/search', {
        key: readerKey,
        body: { correlationId: 'batch-a' },
      })
    );

    expect(body.executions.length).toBeGreaterThanOrEqual(3);
    expect(
      body.executions.every((e: { correlationId: string }) => e.correlationId === 'batch-a')
    ).toBe(true);
  });

  it('serves the correlation lookup', async () => {
    const body = json(
      await call('GET', '/v1/ns/acme/executions/by-correlation/batch-b', { key: readerKey })
    );

    expect(body.executions.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects an unknown status rather than ignoring it', async () => {
    const response = await call('POST', '/v1/ns/acme/executions/search', {
      key: readerKey,
      body: { status: ['NOT_A_STATUS'] },
    });

    // Silently dropping an unrecognised filter returns everything, which reads
    // as "no such executions exist" when it means "your filter was wrong".
    expect(response.statusCode).toBe(400);
  });

  // 400, not 500: a bad cursor is client input, and reporting it as a server
  // fault both misleads the caller and logs a real-looking error.
  it('rejects a malformed cursor as a client error', async () => {
    const response = await call('POST', '/v1/ns/acme/executions/search', {
      key: readerKey,
      body: { cursor: 'nonsense' },
    });

    expect(response.statusCode).toBe(400);
    expect(json(response).error).toBe('INVALID_ARGUMENT');
  });

  it('needs the read scope', async () => {
    const response = await call('POST', '/v1/ns/acme/executions/search', {
      key: scraperKey,
      body: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('accepts a status filter that matches nothing', async () => {
    const body = json(
      await call('POST', '/v1/ns/acme/executions/search', {
        key: readerKey,
        body: { status: [WorkflowStatus.TERMINATED] },
      })
    );

    expect(body.executions).toEqual([]);
    expect(body.nextCursor).toBeUndefined();
  });
});

describe('metrics', () => {
  it('serves Prometheus exposition to a scraper credential', async () => {
    const response = await call('GET', '/v1/metrics', { key: scraperKey });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('# HELP node_flow_decide_queue_depth');
    expect(response.body).toContain('# TYPE node_flow_decide_queue_depth gauge');
  });

  it('reports the engine gauges that matter', async () => {
    const body = (await call('GET', '/v1/metrics', { key: scraperKey })).body;

    for (const metric of [
      'node_flow_decide_queue_depth',
      'node_flow_decide_queue_oldest_seconds',
      'node_flow_tasks_ready',
      'node_flow_tasks_delayed',
      'node_flow_timers_overdue',
      'node_flow_outbox_pending',
      'node_flow_outbox_dead_lettered',
      'node_flow_workflows_running',
    ]) {
      expect(body, metric).toContain(metric);
    }
  });

  it('counts the executions it just created', async () => {
    const body = (await call('GET', '/v1/metrics', { key: scraperKey })).body;
    const line = body.split('\n').find((l) => l.startsWith('node_flow_workflows_running '));

    expect(Number(line?.split(' ')[1])).toBeGreaterThan(0);
  });

  // Event loop lag matters more here than in most services: the decider is
  // single-threaded, so lag is the difference between a workflow advancing and
  // it waiting.
  it('includes Node runtime metrics', async () => {
    const body = (await call('GET', '/v1/metrics', { key: scraperKey })).body;
    expect(body).toContain('node_flow_nodejs_eventloop_lag_seconds');
  });

  // The gauges describe install-wide backlog, which is not something an
  // ordinary tenant credential should be able to read.
  it('refuses a credential without the metrics scope', async () => {
    expect((await call('GET', '/v1/metrics', { key: readerKey })).statusCode).toBe(403);
  });

  it('refuses an unauthenticated scrape', async () => {
    expect((await call('GET', '/v1/metrics')).statusCode).toBe(401);
  });

  it('appears in the OpenAPI document', async () => {
    const document = json(await call('GET', '/v1/openapi.json'));
    expect(document.paths['/v1/metrics'].get['x-required-scopes']).toEqual([Scope.METRICS_READ]);
  });
});
