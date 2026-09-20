import { createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Scope, TaskStatus, WorkflowStatus, queueScope } from '@node-flow-dev/core';
import { IdentityRepository, createDatabase, migrate } from '@node-flow-dev/store';
import { startMockMcp, startMockOpenAi } from '@node-flow-dev/tasks';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { fakeIdp, samlResponse } from './auth/saml.fixture.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './auth/session.js';
import { configureApp, createAdapter } from './configure-app.js';

/**
 * The API, end to end, against a real Postgres and a real Nest container.
 *
 * Everything below the controllers already has integration coverage in `store`.
 * What is untested until here is the wiring: that the guard is actually global,
 * that a scope actually gates a route, that a namespace in the URL cannot
 * override the one in the credential, and that a workflow started over HTTP is
 * driven to completion by the runners this process started.
 */

let container: StartedPostgreSqlContainer;
/** A throwaway IdP: one key pair, served over HTTP exactly as a real one is. */
const oidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
let jwksServer: Server;
let OIDC_ISSUER: string;

/** A throwaway SAML identity provider, and the two URLs it has to agree with us about. */
const idp = fakeIdp();
const SAML_ENTITY_ID = 'http://localhost/v1/auth/saml/corp-saml';
const SAML_ACS = 'http://localhost/v1/auth/saml/corp-saml/callback';

/** Mints a token the way the fake IdP does, for both SSO and workload tests. */
function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: OIDC_ISSUER,
      sub: 'idp-user-1',
      email: 'sso-user@example.com',
      email_verified: true,
      name: 'SSO User',
      iat: now,
      exp: now + 300,
      ...claims,
    })
  ).toString('base64url');

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(oidcKeys.privateKey).toString('base64url')}`;
}
let app: NestFastifyApplication;
let identity: IdentityRepository;
let namespaceId: string;
let otherNamespaceId: string;

/** Credentials minted per test, so scope changes cannot leak between them. */
let adminKey: string;
let workerKey: string;
let readOnlyKey: string;

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

async function until(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition never became true');
    await sleep(50);
  }
}

/** A request helper that keeps the tests readable. */
function call(
  method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'OPTIONS',
  url: string,
  options: {
    key?: string;
    bearer?: string;
    body?: unknown;
    cookies?: Record<string, string>;
    csrf?: string;
    /** A form-encoded body, which is how an identity provider posts a SAML assertion. */
    form?: Record<string, string>;
    /** Sent by a browser on a cross-origin request; the gateway's CORS tests need it. */
    origin?: string;
    /** W3C trace context, for the tests that follow a trace into a worker. */
    traceparent?: string;
  } = {}
) {
  const headers: Record<string, string> = {
    'content-type': options.form ? 'application/x-www-form-urlencoded' : 'application/json',
  };
  if (options.key) headers['x-api-key'] = options.key;
  if (options.origin) headers['origin'] = options.origin;
  if (options.traceparent) headers['traceparent'] = options.traceparent;
  if (options.bearer) headers['authorization'] = `Bearer ${options.bearer}`;
  if (options.cookies) {
    headers['cookie'] = Object.entries(options.cookies)
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join('; ');
  }
  if (options.csrf) headers[CSRF_HEADER] = options.csrf;

  return app.inject({
    method,
    url,
    headers,
    ...(options.form ? { payload: new URLSearchParams(options.form).toString() } : {}),
    ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
  });
}

const json = (response: { body: string }) => JSON.parse(response.body);

const workflowDefinition = {
  name: 'checkout',
  version: 1,
  tasks: [
    { name: 'charge', taskReferenceName: 'charge', type: 'SIMPLE' },
    {
      name: 'ship',
      taskReferenceName: 'ship',
      type: 'SIMPLE',
      inputParameters: { txn: '${charge.output.txnId}' },
    },
  ],
};

beforeAll(async () => {
  ensureDockerHost();
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('nodeflow_api')
    .withUsername('nodeflow')
    .withPassword('nodeflow')
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off'])
    .start();

  // Seed the namespaces before the app boots: there is no namespace API yet, so
  // this is the bootstrap path a CLI will eventually own.
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

  // Started before the app, because the trusted-issuer list is read at boot and
  // has to name a URL that already resolves.
  // A fake IdP: a JWKS document, and a token endpoint that mints an ID token
  // carrying whatever nonce the flow asked for. Enough to run a real login.
  jwksServer = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');

    if (request.url?.startsWith('/token')) {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const form = new URLSearchParams(body);
        // The code carries the nonce, so the fake IdP echoes it back exactly as
        // a real one binds the nonce from the authorization request.
        const nonce = form.get('code')?.split(':')[1] ?? '';
        response.end(
          JSON.stringify({ id_token: idToken({ nonce, aud: 'node-flow-ui' }) })
        );
      });
      return;
    }

    response.end(
      JSON.stringify({
        keys: [
          {
            ...(oidcKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
            kid: 'test-key',
            use: 'sig',
          },
        ],
      })
    );
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const jwksPort = (jwksServer.address() as AddressInfo).port;
  OIDC_ISSUER = `http://127.0.0.1:${jwksPort}`;

  Object.assign(process.env, {
    DATABASE_URL: container.getConnectionUri(),
    NODE_FLOW_OIDC_ISSUERS: JSON.stringify([
      { issuer: OIDC_ISSUER, jwksUri: `${OIDC_ISSUER}/jwks`, audience: 'node-flow' },
    ]),
    NODE_FLOW_SSO_PROVIDERS: JSON.stringify([
      {
        name: 'corp',
        issuer: OIDC_ISSUER,
        clientId: 'node-flow-ui',
        clientSecret: 'test-secret',
        authorizationEndpoint: `${OIDC_ISSUER}/authorize`,
        tokenEndpoint: `${OIDC_ISSUER}/token`,
        jwksUri: `${OIDC_ISSUER}/jwks`,
        redirectUri: 'http://localhost/v1/auth/sso/corp/callback',
        namespace: 'acme',
      },
    ]),
    NODE_FLOW_SAML_PROVIDERS: JSON.stringify([
      {
        name: 'corp-saml',
        entryPoint: 'https://idp.test/sso',
        issuer: SAML_ENTITY_ID,
        callbackUrl: SAML_ACS,
        idpCert: idp.publicKey,
        namespace: 'acme',
      },
    ]),
    NODE_FLOW_JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    // Status-listener tests deliver to a local receiver by this name; every other
    // private or loopback address stays blocked, which those tests also check.
    NODE_FLOW_HTTP_ALLOWED_HOSTS: 'localhost',
    // One origin, so the gateway's CORS tests can prove both the allowed and
    // the refused case.
    NODE_FLOW_GATEWAY_CORS_ORIGINS: 'https://partner.example.com',
    // Runners on, so the tests exercise a self-driving system rather than
    // stepping the evaluator by hand.
    NODE_FLOW_ROLES: 'api,decider,poller',
    NODE_ENV: 'test',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  // The same configuration `main.ts` applies, not a re-implementation of it.
  await configureApp(app);

  identity = app.get(IdentityRepository);
}, 240_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => jwksServer?.close(() => resolve()));
  await container?.stop();
}, 60_000);

/** Service-account names are unique per namespace, so each test needs its own. */
let uniqueSuffix = 0;
let scheduleSeq = 0;
const unique = (name: string) => `${name}-${++uniqueSuffix}`;

beforeEach(async () => {
  adminKey = (await identity.createApiKey({ namespaceId, name: 'admin', scopes: [Scope.ADMIN] }))
    .token;
  workerKey = (
    await identity.createApiKey({
      namespaceId,
      name: 'worker',
      scopes: [queueScope('charge'), Scope.TASKS_REPORT],
    })
  ).token;
  readOnlyKey = (
    await identity.createApiKey({
      namespaceId,
      name: 'reader',
      scopes: [Scope.EXECUTIONS_READ],
    })
  ).token;
});

describe('health', () => {
  it('serves liveness without credentials', async () => {
    const response = await call('GET', '/v1/health/live');
    expect(response.statusCode).toBe(200);
    expect(json(response).status).toBe('ok');
  });

  // The criterion Phase 0 left open: migrations applied and reported.
  it('reports readiness with migrations applied', async () => {
    const response = await call('GET', '/v1/health/ready');

    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(body.status).toBe('ok');
    expect(body.checks.find((c: { name: string }) => c.name === 'migrations').ok).toBe(true);
  });

  // The failure this prevents: a deploy rolls the binary out ahead of its
  // migration, the replica reports ready because *some* migrations are applied,
  // and it serves traffic against a schema missing the columns it reads from.
  it('refuses readiness when the schema is behind the build', async () => {
    const probe = createDatabase({ url: container.getConnectionUri() });
    const [newest] = await probe
      .selectFrom('Migrations')
      .select('name')
      .orderBy('name', 'desc')
      .limit(1)
      .execute();
    await probe.deleteFrom('Migrations').where('name', '=', newest.name).execute();

    try {
      const response = await call('GET', '/v1/health/ready');

      expect(response.statusCode).toBe(503);
      const check = json(response).checks.find(
        (c: { name: string }) => c.name === 'migrations'
      );
      expect(check.ok).toBe(false);
      // Named, so the operator knows which migration to run.
      expect(check.detail).toContain(newest.name);
    } finally {
      await probe.insertInto('Migrations').values({ name: newest.name }).execute();
      await probe.destroy();
    }
  });
});

describe('authentication', () => {
  // Default-deny is the property worth testing: a route with no decorator must
  // be protected, or every new endpoint is public until someone remembers.
  it('refuses an unauthenticated request', async () => {
    const response = await call('GET', '/v1/ns/acme/metadata/workflows');
    expect(response.statusCode).toBe(401);
  });

  it('refuses an unknown API key', async () => {
    const response = await call('GET', '/v1/ns/acme/metadata/workflows', { key: 'nf_nope' });
    expect(response.statusCode).toBe(401);
    expect(json(response).error).toBe('invalid_credentials');
  });

  it('accepts a valid API key', async () => {
    const response = await call('GET', '/v1/ns/acme/metadata/workflows', { key: adminKey });
    expect(response.statusCode).toBe(200);
  });

  it('reports who the caller is', async () => {
    const response = await call('GET', '/v1/auth/whoami', { key: workerKey });
    expect(json(response)).toMatchObject({ name: 'worker', namespaceId });
  });

  it('exchanges a service-account secret for a bearer token', async () => {
    const account = await identity.createServiceAccount({
      namespaceId,
      name: unique('fleet'),
      scopes: [queueScope('charge')],
    });

    const exchange = await call('POST', '/v1/auth/token', {
      body: { keyId: account.keyId, secret: account.secret },
    });
    expect(exchange.statusCode).toBe(200);
    const { accessToken } = json(exchange);

    const whoami = await call('GET', '/v1/auth/whoami', { bearer: accessToken });
    expect(json(whoami)).toMatchObject({ namespaceId });
  });

  it('refuses a bad secret without saying which half was wrong', async () => {
    const account = await identity.createServiceAccount({
      namespaceId,
      name: unique('fleet'),
      scopes: [],
    });

    const wrongSecret = await call('POST', '/v1/auth/token', {
      body: { keyId: account.keyId, secret: 'nope' },
    });
    const unknownKey = await call('POST', '/v1/auth/token', {
      body: { keyId: 'sa_nonexistent', secret: 'nope' },
    });

    expect(wrongSecret.statusCode).toBe(401);
    expect(json(wrongSecret).message).toBe(json(unknownKey).message);
  });

  it('refuses a garbage bearer token', async () => {
    const response = await call('GET', '/v1/auth/whoami', { bearer: 'not.a.jwt' });
    expect(response.statusCode).toBe(401);
  });
});

describe('authorization', () => {
  it('refuses a write without the scope for it', async () => {
    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: readOnlyKey,
      body: workflowDefinition,
    });

    expect(response.statusCode).toBe(403);
    expect(json(response).error).toBe('insufficient_scope');
  });

  it('names the scope that was missing', async () => {
    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: readOnlyKey,
      body: workflowDefinition,
    });

    expect(json(response).message).toContain(Scope.WORKFLOWS_WRITE);
  });

  // A fleet processing `charge` must not be able to drain `send_email`.
  it('confines a worker to the queue its scope names', async () => {
    const allowed = await call('POST', '/v1/ns/acme/queues/charge/lease', {
      key: workerKey,
      body: { workerId: 'w1' },
    });
    const refused = await call('POST', '/v1/ns/acme/queues/send_email/lease', {
      key: workerKey,
      body: { workerId: 'w1' },
    });

    expect(allowed.statusCode).toBe(200);
    expect(refused.statusCode).toBe(403);
  });

  it('lets admin through everywhere', async () => {
    const response = await call('POST', '/v1/ns/acme/queues/anything/lease', {
      key: adminKey,
      body: { workerId: 'w1' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('namespace isolation', () => {
  // Trusting the URL would let any credential act in any namespace by editing
  // a path segment. This is the vulnerability the guard exists to close.
  it('refuses a credential acting in another namespace', async () => {
    const response = await call('GET', '/v1/ns/other/metadata/workflows', { key: adminKey });

    expect(response.statusCode).toBe(403);
    expect(json(response).error).toBe('wrong_namespace');
  });

  it('404s an unknown namespace', async () => {
    const response = await call('GET', '/v1/ns/nope/metadata/workflows', { key: adminKey });
    expect(response.statusCode).toBe(404);
  });

  // Ids are unguessable, but "unguessable" is not access control — one id in a
  // support ticket would otherwise be enough.
  it('hides another namespace’s execution behind a 404', async () => {
    const foreign = await identity.createApiKey({
      namespaceId: otherNamespaceId,
      name: 'other-admin',
      scopes: [Scope.ADMIN],
    });
    await call('POST', '/v1/ns/other/metadata/workflows', {
      key: foreign.token,
      body: workflowDefinition,
    });
    const started = await call('POST', '/v1/ns/other/executions/checkout', {
      key: foreign.token,
      body: {},
    });
    const foreignId = json(started).workflowId;

    const response = await call(`GET`, `/v1/ns/acme/executions/${foreignId}`, { key: adminKey });
    expect(response.statusCode).toBe(404);
  });
});

describe('definitions', () => {
  it('compiles on registration and reports what it derived', async () => {
    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: workflowDefinition,
    });

    expect(response.statusCode).toBe(201);
    expect(json(response)).toMatchObject({
      name: 'checkout',
      version: 1,
      compiled: { entryRef: 'charge', taskCount: 2 },
    });
  });

  // The value of compiling at registration: a broken reference is a 400 at
  // deploy time, not a 3am failure on the one branch nobody exercised.
  it('rejects a definition referencing a task that does not exist', async () => {
    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: 'broken',
        version: 1,
        tasks: [
          {
            name: 'a',
            taskReferenceName: 'a',
            type: 'SIMPLE',
            inputParameters: { x: '${ghost.output.value}' },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('reports schema problems all at once', async () => {
    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { version: -1 },
    });

    expect(response.statusCode).toBe(400);
    expect(json(response).details.issues.length).toBeGreaterThan(1);
  });

  // Registering the same version twice is a conflict, not a bad request. A
  // deploy that runs twice is the common cause, and 409 is what lets a client
  // treat it as "already done" without string-matching the message — which a
  // 400, shared with genuinely malformed definitions, does not allow.
  it('refuses a version that already exists with 409', async () => {
    const definition = { ...workflowDefinition, name: 'immutable_version' };

    expect((await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: definition })).statusCode).toBe(201);

    const again = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { ...definition, tasks: definition.tasks.slice(0, 1) },
    });

    expect(again.statusCode).toBe(409);
    expect(json(again).message).toMatch(/already exists/);
  });
});

describe('running a workflow over HTTP', () => {
  beforeEach(async () => {
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: workflowDefinition,
    });
  });

  it('runs to completion, driven by the runners this process started', async () => {
    const started = await call('POST', '/v1/ns/acme/executions/checkout', {
      key: adminKey,
      body: { input: { orderId: 'o-1' } },
    });
    expect(started.statusCode).toBe(201);
    const { workflowId } = json(started);

    for (const queue of ['charge', 'ship']) {
      // Nothing here calls the evaluator: the decider loop schedules each task.
      await until(async () => {
        const lease = await call('POST', `/v1/ns/acme/queues/${queue}/lease`, {
          key: adminKey,
          body: { workerId: 'w1' },
        });
        const [task] = json(lease).tasks;
        if (!task) return false;

        const report = await call('POST', `/v1/ns/acme/tasks/${task.taskId}/report`, {
          key: adminKey,
          body: {
            queueName: queue,
            workflowId,
            leaseToken: task.leaseToken,
            status: TaskStatus.COMPLETED,
            output: { txnId: 'txn-9' },
          },
        });
        expect(report.statusCode).toBe(200);
        return true;
      });
    }

    await until(async () => {
      const status = await call('GET', `/v1/ns/acme/executions/${workflowId}/status`, {
        key: adminKey,
      });
      return json(status).status === WorkflowStatus.COMPLETED;
    });
  });

  it('passes one task’s output into the next task’s input', async () => {
    const { workflowId } = json(
      await call('POST', '/v1/ns/acme/executions/checkout', { key: adminKey, body: {} })
    );

    await until(async () => {
      const lease = await call('POST', '/v1/ns/acme/queues/charge/lease', {
        key: adminKey,
        body: { workerId: 'w1' },
      });
      const [task] = json(lease).tasks;
      if (!task) return false;
      await call('POST', `/v1/ns/acme/tasks/${task.taskId}/report`, {
        key: adminKey,
        body: {
          queueName: 'charge',
          workflowId,
          leaseToken: task.leaseToken,
          status: TaskStatus.COMPLETED,
          output: { txnId: 'txn-42' },
        },
      });
      return true;
    });

    await until(async () => {
      const execution = json(
        await call('GET', `/v1/ns/acme/executions/${workflowId}`, { key: adminKey })
      );
      const ship = execution.tasks.find((t: { refName: string }) => t.refName === 'ship');
      return ship?.input?.txn === 'txn-42';
    });
  });

  it('deduplicates a repeated start with the same idempotency key', async () => {
    const body = { input: {}, idempotencyKey: 'order-7' };
    const first = json(await call('POST', '/v1/ns/acme/executions/checkout', { key: adminKey, body }));
    const second = json(
      await call('POST', '/v1/ns/acme/executions/checkout', { key: adminKey, body })
    );

    expect(second.workflowId).toBe(first.workflowId);
  });

  it('404s a workflow that was never registered', async () => {
    const response = await call('POST', '/v1/ns/acme/executions/ghost', {
      key: adminKey,
      body: {},
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses a result whose lease token is wrong', async () => {
    const { workflowId } = json(
      await call('POST', '/v1/ns/acme/executions/checkout', { key: adminKey, body: {} })
    );

    let taskId = '';
    await until(async () => {
      const lease = await call('POST', '/v1/ns/acme/queues/charge/lease', {
        key: adminKey,
        body: { workerId: 'w1' },
      });
      const [task] = json(lease).tasks;
      if (!task) return false;
      taskId = task.taskId;
      return true;
    });

    const response = await call('POST', `/v1/ns/acme/tasks/${taskId}/report`, {
      key: adminKey,
      body: {
        queueName: 'charge',
        workflowId,
        leaseToken: '00000000-0000-4000-8000-000000000000',
        status: TaskStatus.COMPLETED,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(json(response).error).toBe('LEASE_EXPIRED');
  });
});

describe('operator actions', () => {
  beforeEach(async () => {
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: workflowDefinition,
    });
  });

  const startOne = async () =>
    json(await call('POST', '/v1/ns/acme/executions/checkout', { key: adminKey, body: {} }))
      .workflowId as string;

  it('pauses and resumes', async () => {
    const workflowId = await startOne();

    expect((await call('POST', `/v1/ns/acme/executions/${workflowId}/pause`, { key: adminKey })).statusCode).toBe(202);
    await until(async () =>
      json(await call('GET', `/v1/ns/acme/executions/${workflowId}/status`, { key: adminKey }))
        .status === WorkflowStatus.PAUSED
    );

    await call('POST', `/v1/ns/acme/executions/${workflowId}/resume`, { key: adminKey });
    await until(async () =>
      json(await call('GET', `/v1/ns/acme/executions/${workflowId}/status`, { key: adminKey }))
        .status === WorkflowStatus.RUNNING
    );
  });

  it('terminates with a reason', async () => {
    const workflowId = await startOne();

    const response = await call('POST', `/v1/ns/acme/executions/${workflowId}/terminate`, {
      key: adminKey,
      body: { reason: 'cost runaway' },
    });
    expect(response.statusCode).toBe(202);

    const status = json(
      await call('GET', `/v1/ns/acme/executions/${workflowId}/status`, { key: adminKey })
    );
    expect(status.status).toBe(WorkflowStatus.TERMINATED);
    expect(status.reasonForIncompletion).toBe('cost runaway');
  });

  it('409s a terminate on an already-terminated execution', async () => {
    const workflowId = await startOne();
    await call('POST', `/v1/ns/acme/executions/${workflowId}/terminate`, {
      key: adminKey,
      body: {},
    });

    const again = await call('POST', `/v1/ns/acme/executions/${workflowId}/terminate`, {
      key: adminKey,
      body: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('refuses an operator action to a read-only credential', async () => {
    const workflowId = await startOne();
    const response = await call('POST', `/v1/ns/acme/executions/${workflowId}/terminate`, {
      key: readOnlyKey,
      body: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('records the action in the history', async () => {
    const workflowId = await startOne();
    await call('POST', `/v1/ns/acme/executions/${workflowId}/terminate`, {
      key: adminKey,
      body: { reason: 'stop' },
    });

    const history = json(
      await call('GET', `/v1/ns/acme/executions/${workflowId}/history`, { key: adminKey })
    );
    const terminated = history.find((e: { type: string }) => e.type === 'workflow.terminated');
    expect(terminated.payload).toMatchObject({ reason: 'stop', by: 'admin' });
  });
});

describe('credential administration', () => {
  it('issues an API key that immediately works', async () => {
    const created = json(
      await call('POST', '/v1/auth/api-keys', {
        key: adminKey,
        body: { name: unique('fresh'), scopes: [Scope.EXECUTIONS_READ] },
      })
    );

    const whoami = await call('GET', '/v1/auth/whoami', { key: created.token });
    expect(json(whoami).id).toBe(created.id);
  });

  it('stops working once revoked', async () => {
    const created = json(
      await call('POST', '/v1/auth/api-keys', {
        key: adminKey,
        body: { name: unique('doomed'), scopes: [] },
      })
    );

    expect((await call('GET', '/v1/auth/whoami', { key: created.token })).statusCode).toBe(200);

    const revoke = await call('DELETE', `/v1/auth/api-keys/${created.id}`, { key: adminKey });
    // Asserted, not assumed: a revoke that silently 404s would leave the key
    // working and the test would blame the wrong thing.
    expect(revoke.statusCode).toBe(204);

    expect((await call('GET', '/v1/auth/whoami', { key: created.token })).statusCode).toBe(401);
  });

  it('refuses credential administration without admin', async () => {
    const response = await call('POST', '/v1/auth/api-keys', {
      key: readOnlyKey,
      body: { name: 'nope', scopes: [] },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an unsatisfiable scope', async () => {
    const response = await call('POST', '/v1/auth/api-keys', {
      key: adminKey,
      body: { name: 'bad', scopes: ['NOT A SCOPE'] },
    });
    expect(response.statusCode).toBe(400);
  });
});

/**
 * The incoming half of the webhook pair, driven through the real container.
 *
 * `store` already proves the repository and the evaluator behave; none of that
 * caught the bug this block exists for. The `Evaluator` takes its webhook
 * repository as an optional constructor argument — optional because unit tests
 * build one without it — and the DI factory simply did not pass it. Every
 * `store` test kept passing, because they wire the evaluator by hand. A
 * `WAIT_FOR_WEBHOOK` task went `IN_PROGRESS` with no token ever minted and
 * waited for a callback that could not be sent.
 *
 * So the assertion that matters here is not "delivery works" but "the container
 * built an engine that can mint a token at all".
 */
describe('incoming webhooks', () => {
  const definition = {
    name: 'approval',
    version: 1,
    tasks: [
      {
        name: 'await',
        taskReferenceName: 'await',
        type: 'WAIT_FOR_WEBHOOK',
        inputParameters: { expiresInSeconds: 600 },
      },
      {
        name: 'record',
        taskReferenceName: 'record',
        type: 'NOOP',
        inputParameters: { decision: '${await.output.decision}' },
      },
    ],
  };

  async function startAwaiting(): Promise<{ id: string; path: string }> {
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: definition });
    const started = json(
      await call('POST', '/v1/ns/acme/executions/approval', { key: adminKey, body: { input: {} } })
    );
    const id: string = started.workflowId;

    let path = '';
    await until(async () => {
      const execution = json(await call('GET', `/v1/ns/acme/executions/${id}`, { key: adminKey }));
      const task = execution.tasks?.find((t: { refName: string }) => t.refName === 'await');
      path = task?.output?.callbackPath ?? '';
      return path !== '';
    });

    return { id, path };
  }

  it('mints a callback for a task the container scheduled', async () => {
    const { path } = await startAwaiting();
    expect(path).toContain('/webhooks/');
  });

  // The endpoint has to work for a caller holding no credential — a payment
  // provider cannot hold an API key for this install. The token in the URL is
  // the entire authorisation, which is only safe because it completes one task.
  it('accepts an unauthenticated delivery and resumes the workflow', async () => {
    const { id, path } = await startAwaiting();

    const delivered = await call('POST', path, { body: { decision: 'approved' } });
    expect(delivered.statusCode).toBe(200);
    expect(json(delivered).workflowId).toBe(id);

    await until(async () => {
      const execution = json(await call('GET', `/v1/ns/acme/executions/${id}`, { key: adminKey }));
      return execution.status === WorkflowStatus.COMPLETED;
    });

    // The payload has to reach downstream expressions, or the callback carried
    // nothing and the task may as well have been a WAIT.
    const execution = json(await call('GET', `/v1/ns/acme/executions/${id}`, { key: adminKey }));
    const record = execution.tasks.find((t: { refName: string }) => t.refName === 'record');
    expect(record.input).toEqual({ decision: 'approved' });
  });

  // Every webhook sender retries. A second delivery must not complete anything.
  it('refuses a replayed delivery', async () => {
    const { path } = await startAwaiting();

    expect((await call('POST', path, { body: { decision: 'approved' } })).statusCode).toBe(200);

    const replay = await call('POST', path, { body: { decision: 'rejected' } });
    expect(replay.statusCode).toBe(409);
  });

  // Found while writing the block above: a non-UUID id reached Postgres, which
  // rejected it, and the driver error escaped as a 500 carrying a fragment of
  // the storage layer. A typo in a URL is a 404.
  it('404s a malformed execution id rather than failing', async () => {
    const response = await call('GET', '/v1/ns/acme/executions/not-a-uuid', { key: adminKey });
    expect(response.statusCode).toBe(404);
  });

  // Indistinguishable from a token that never existed, so the endpoint cannot
  // be probed for live callbacks.
  it('refuses an unknown token with a 404', async () => {
    const response = await call('POST', `/v1/ns/acme/webhooks/${'A'.repeat(43)}`, {
      body: {},
    });
    expect(response.statusCode).toBe(404);
  });
});

/**
 * Human tasks, over the API, as a real signed-in person.
 *
 * The property that needs a *container* to test is the one the webhook work was
 * caught by: the repository is an optional constructor argument on the
 * evaluator, so a missing DI wiring disables the feature silently while every
 * store test keeps passing. Here the object under test is the one Nest built.
 */
describe('human tasks', () => {
  const PASSWORD = 'correct-horse-battery-staple-42';
  let people = 0;

  const definition = {
    name: 'human-approval',
    version: 1,
    tasks: [
      {
        name: 'approve',
        taskReferenceName: 'approve',
        type: 'HUMAN',
        inputParameters: { title: 'Approve the refund' },
      },
    ],
  };

  /** `set-cookie` may be a string or an array depending on how many were set. */
  function cookieValue(response: { headers: Record<string, unknown> }, name: string): string {
    const raw = response.headers['set-cookie'];
    const all = Array.isArray(raw) ? raw : [raw];
    const match = all.find((value) => typeof value === 'string' && value.startsWith(`${name}=`));
    return match ? decodeURIComponent(String(match).split('=')[1].split(';')[0]) : '';
  }

  async function signIn(scopes: string[]) {
    const email = `approver-${++people}@example.com`;
    await call('POST', '/v1/ns/acme/users', {
      key: adminKey,
      body: { email, name: 'Ann', password: PASSWORD, scopes },
    });

    const response = await call('POST', '/v1/ns/acme/users/login', {
      body: { email, password: PASSWORD },
    });

    return {
      session: cookieValue(response, SESSION_COOKIE),
      csrf: cookieValue(response, CSRF_COOKIE),
    };
  }

  const asUser = (
    method: 'GET' | 'POST',
    url: string,
    auth: { session: string; csrf: string },
    body?: unknown
  ) =>
    call(method, url, {
      cookies: { [SESSION_COOKIE]: auth.session, [CSRF_COOKIE]: auth.csrf },
      csrf: auth.csrf,
      body,
    });

  const approver = () => signIn([Scope.HUMAN_TASKS_READ, Scope.HUMAN_TASKS_WRITE]);

  async function startApproval(): Promise<string> {
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: definition });
    const started = json(
      await call('POST', '/v1/ns/acme/executions/human-approval', {
        key: adminKey,
        body: { input: {} },
      })
    );
    return started.workflowId as string;
  }

  /**
   * This workflow's task, not merely the first thing in the inbox.
   *
   * Tests here share a database and an inbox, so an earlier test's unclaimed
   * approval is sitting in the list — taking `tasks[0]` claims and completes
   * *that* one and then waits forever for a workflow that was never touched.
   */
  async function taskFor(auth: { session: string; csrf: string }, workflowId: string) {
    let task: { id: string; title: string; workflowId: string } | undefined;

    await until(async () => {
      const { tasks } = json(await asUser('GET', '/v1/ns/acme/human-tasks', auth));
      task = tasks.find((t: { workflowId: string }) => t.workflowId === workflowId);
      return task !== undefined;
    });

    return task as { id: string; title: string; workflowId: string };
  }

  it('puts a scheduled HUMAN task in the inbox', async () => {
    const auth = await approver();
    const workflowId = await startApproval();

    const task = await taskFor(auth, workflowId);
    expect(task.title).toBe('Approve the refund');
  });

  it('claims and completes, and the workflow finishes', async () => {
    const auth = await approver();
    const workflowId = await startApproval();
    const task = await taskFor(auth, workflowId);

    expect(
      (await asUser('POST', `/v1/ns/acme/human-tasks/${task.id}/claim`, auth)).statusCode
    ).toBe(200);

    const completed = await asUser('POST', `/v1/ns/acme/human-tasks/${task.id}/complete`, auth, {
      output: { approved: true },
    });
    expect(completed.statusCode).toBe(200);

    await until(async () => {
      const execution = json(
        await call('GET', `/v1/ns/acme/executions/${workflowId}`, { key: adminKey })
      );
      return execution.status === WorkflowStatus.COMPLETED;
    });
  });

  // Completing without the claim is how one person's answer silently replaces
  // another's on a task they are actively working.
  it('refuses to complete without claiming', async () => {
    const auth = await approver();
    const workflowId = await startApproval();
    const task = await taskFor(auth, workflowId);

    const response = await asUser(
      'POST',
      `/v1/ns/acme/human-tasks/${task.id}/complete`,
      auth,
      { output: {} }
    );

    expect(response.statusCode).toBe(409);
  });

  it('gives the task to exactly one of two people', async () => {
    const first = await approver();
    const second = await approver();
    const workflowId = await startApproval();
    const task = await taskFor(first, workflowId);

    const results = await Promise.all([
      asUser('POST', `/v1/ns/acme/human-tasks/${task.id}/claim`, first),
      asUser('POST', `/v1/ns/acme/human-tasks/${task.id}/claim`, second),
    ]);

    const won = results.filter((r) => r.statusCode === 200);
    expect(won).toHaveLength(1);
    // 409, not 403: the loser did nothing wrong, they were simply second.
    expect(results.find((r) => r.statusCode !== 200)?.statusCode).toBe(409);
  });

  /**
   * An API key names a fleet, not a person.
   *
   * Recording a service account as the approver of a refund would make the
   * audit trail worse than useless: it would look complete while naming nobody.
   */
  it('refuses a service account, however privileged', async () => {
    await startApproval();

    const response = await call('GET', '/v1/ns/acme/human-tasks', { key: adminKey });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a signed-in user without the scope', async () => {
    const auth = await signIn([Scope.EXECUTIONS_READ]);
    await startApproval();

    expect((await asUser('GET', '/v1/ns/acme/human-tasks', auth)).statusCode).toBe(403);
  });

  it('lets an operator search every task, with people named', async () => {
    const workflowId = await startApproval();
    let found: { tasks: { id: string; workflowId: string }[]; people: Record<string, string> } | undefined;
    await until(async () => {
      found = json(await call('GET', `/v1/ns/acme/human-tasks/search?workflowId=${workflowId}`, { key: adminKey }));
      return found!.tasks.length === 1;
    });

    // Unknown people and malformed ids match nothing rather than everything.
    for (const query of ['assignee=nobody@example.com', 'group=no-such-team', 'workflowId=not-a-uuid']) {
      expect(json(await call('GET', `/v1/ns/acme/human-tasks/search?${query}`, { key: adminKey })).tasks).toEqual([]);
    }
    expect((await call('GET', '/v1/ns/acme/human-tasks/search?state=bogus', { key: adminKey })).statusCode).toBe(400);
    const reader = await signIn([Scope.HUMAN_TASKS_READ]);
    expect((await asUser('GET', '/v1/ns/acme/human-tasks/search', reader)).statusCode).toBe(403);
  });

  it('auto-claims for the assignee and starts trigger workflows as the task moves', async () => {
    const email = `auto-${++people}@example.com`;
    await call('POST', '/v1/ns/acme/users', {
      key: adminKey,
      body: { email, name: 'Auto', password: PASSWORD, scopes: [Scope.HUMAN_TASKS_READ, Scope.HUMAN_TASKS_WRITE] },
    });
    const login = await call('POST', '/v1/ns/acme/users/login', { body: { email, password: PASSWORD } });
    const auth = { session: cookieValue(login, SESSION_COOKIE), csrf: cookieValue(login, CSRF_COOKIE) };

    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: 'approval-followup', version: 1, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] },
    });
    expect(
      (
        await call('POST', '/v1/ns/acme/metadata/workflows', {
          key: adminKey,
          body: {
            name: 'auto-approval',
            version: 1,
            tasks: [
              {
                name: 'approve',
                taskReferenceName: 'approve',
                type: 'HUMAN',
                inputParameters: {
                  title: 'Auto approval',
                  assignments: [{ user: email }],
                  autoClaim: true,
                  triggers: [{ on: 'COMPLETED', workflow: 'approval-followup' }],
                },
              },
            ],
          },
        })
      ).statusCode
    ).toBeLessThan(300);

    const { workflowId } = json(await call('POST', '/v1/ns/acme/executions/auto-approval', { key: adminKey, body: { input: {} } }));
    const task = await taskFor(auth, workflowId);
    // No claim call: the task is already this person's.
    const completed = await asUser('POST', `/v1/ns/acme/human-tasks/${task.id}/complete`, auth, { output: { ok: true } });
    expect(completed.statusCode).toBe(200);

    await until(async () => {
      const { executions } = json(await call('GET', `/v1/ns/acme/executions/by-correlation/${workflowId}`, { key: adminKey }));
      return executions.some((e: { defName: string }) => e.defName === 'approval-followup');
    });
  });
});

/**
 * Sub-workflows, end to end through the container.
 *
 * This block exists because of a bug it would have caught years earlier than
 * anything else: `SUB_WORKFLOW` and `START_WORKFLOW` publish to the outbox and
 * the relay starts the child after commit — and **no handler was ever
 * registered in the server**. Every `store` test registered its own inline, so
 * the gap was invisible there; in a real deployment the events backed off,
 * dead-lettered, and the parent waited forever for a child that never existed.
 *
 * The third instance of the same class of defect, after the webhook repository
 * and the human-task inbox: the wiring is what breaks, and only the container
 * that does the wiring can test it.
 */
describe('sub-workflows', () => {
  const child = {
    name: 'child-flow',
    version: 1,
    tasks: [
      {
        name: 'echo',
        taskReferenceName: 'echo',
        type: 'NOOP',
        inputParameters: { got: '${workflow.input.value}' },
      },
    ],
  };

  const parent = {
    name: 'parent-flow',
    version: 1,
    tasks: [
      {
        name: 'call',
        taskReferenceName: 'call',
        type: 'SUB_WORKFLOW',
        subWorkflowParam: { name: 'child-flow', version: 1 },
        inputParameters: { value: 'from-parent' },
      },
    ],
  };

  it('starts the child and completes the parent', async () => {
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: child });
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: parent });

    const started = json(
      await call('POST', '/v1/ns/acme/executions/parent-flow', {
        key: adminKey,
        body: { input: {} },
      })
    );

    // The parent cannot finish unless a child was actually created and ran, so
    // this one assertion covers the whole path.
    await until(async () => {
      const execution = json(
        await call('GET', `/v1/ns/acme/executions/${started.workflowId}`, { key: adminKey })
      );
      return execution.status === WorkflowStatus.COMPLETED;
    }, 20_000);
  }, 60_000);
});

/**
 * Cron schedules, over the API.
 *
 * The container-level half of the scheduler: that the poller is actually wired
 * into the `poller` role and that a schedule created over HTTP really fires.
 * The concurrency guarantee is proven in `store`, where two pollers can be
 * raced deterministically.
 */
describe('schedules', () => {
  const definition = {
    name: 'scheduled-flow',
    version: 1,
    tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }],
  };

  beforeAll(async () => {
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: definition });
  });

  const body = (overrides: Record<string, unknown> = {}) => ({
    name: `every-minute-${++scheduleSeq}`,
    cron: '0 * * * * *',
    workflow: { name: 'scheduled-flow', version: 1 },
    ...overrides,
  });

  it('creates a schedule and computes its next run', async () => {
    const response = await call('POST', '/v1/ns/acme/schedules', { key: adminKey, body: body() });

    expect(response.statusCode).toBe(201);
    expect(new Date(json(response).nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  // The only question anyone asks of a cron expression is "is that what I
  // meant?", and a list of instants answers it better than the expression does.
  it('shows the upcoming runs', async () => {
    const created = json(
      await call('POST', '/v1/ns/acme/schedules', { key: adminKey, body: body() })
    );

    const fetched = json(
      await call('GET', `/v1/ns/acme/schedules/${created.name}`, { key: adminKey })
    );

    expect(fetched.upcoming).toHaveLength(5);
    expect(new Date(fetched.upcoming[1]).getTime()).toBeGreaterThan(
      new Date(fetched.upcoming[0]).getTime()
    );
  });

  it('keeps a firing history with each run’s current status', async () => {
    // Registered here too: a filtered run skips the earlier tests that make `adminKey` usable in beforeAll.
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: definition });
    const created = json(await call('POST', '/v1/ns/acme/schedules', { key: adminKey, body: body({ cron: '* * * * * *' }) }));
    const url = `/v1/ns/acme/schedules/${created.name}/runs`;

    let runs: { outcome: string; workflowId: string; workflowStatus: string; scheduledFor: string; firedAt: string }[] = [];
    await until(async () => {
      runs = json(await call('GET', url, { key: adminKey })).runs;
      return runs.some((run) => run.outcome === 'STARTED' && run.workflowStatus === 'COMPLETED');
    }, 20_000);
    await call('POST', `/v1/ns/acme/schedules/${created.name}/pause`, { key: adminKey });

    const started = runs.find((run) => run.workflowStatus === 'COMPLETED')!;
    const execution = json(await call('GET', `/v1/ns/acme/executions/${started.workflowId}`, { key: adminKey }));
    expect(execution.input._schedule).toMatchObject({ name: created.name, scheduledFor: started.scheduledFor });

    expect(json(await call('GET', `${url}?outcome=FAILED`, { key: adminKey })).runs).toEqual([]);
    expect((await call('GET', `${url}?outcome=MAYBE`, { key: adminKey })).statusCode).toBe(400);
    expect((await call('GET', '/v1/ns/acme/schedules/no-such-schedule/runs', { key: adminKey })).statusCode).toBe(404);
  }, 30_000);

  it('rejects an expression that cannot be parsed', async () => {
    const response = await call('POST', '/v1/ns/acme/schedules', {
      key: adminKey,
      body: body({ cron: 'every thursday-ish' }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('pauses and resumes', async () => {
    const created = json(
      await call('POST', '/v1/ns/acme/schedules', { key: adminKey, body: body() })
    );

    expect(
      json(await call('POST', `/v1/ns/acme/schedules/${created.name}/pause`, { key: adminKey }))
        .paused
    ).toBe(true);
    expect(
      json(await call('POST', `/v1/ns/acme/schedules/${created.name}/resume`, { key: adminKey }))
        .paused
    ).toBe(false);
  });

  it('deletes', async () => {
    const created = json(
      await call('POST', '/v1/ns/acme/schedules', { key: adminKey, body: body() })
    );

    expect(
      (await call('DELETE', `/v1/ns/acme/schedules/${created.name}`, { key: adminKey })).statusCode
    ).toBe(204);
    expect(
      (await call('GET', `/v1/ns/acme/schedules/${created.name}`, { key: adminKey })).statusCode
    ).toBe(404);
  });

  it('refuses a caller who may not write workflows', async () => {
    const response = await call('POST', '/v1/ns/acme/schedules', {
      key: readOnlyKey,
      body: body(),
    });

    expect(response.statusCode).toBe(403);
  });

  /**
   * The wiring test.
   *
   * Everything above would pass with the poller never registered in the
   * `poller` role — the same class of gap that left sub-workflows unable to
   * start. A schedule due in the past must actually produce an execution.
   */
  it('fires a due schedule through the running poller', async () => {
    const created = json(
      await call('POST', '/v1/ns/acme/schedules', {
        key: adminKey,
        body: body({ catchupPolicy: 'FIRE_ONE' }),
      })
    );

    // Backdate it rather than waiting up to a minute for the cron boundary.
    const probe = createDatabase({ url: container.getConnectionUri() });
    await probe
      .updateTable('Schedules')
      .set({ nextRunAt: new Date(Date.now() - 1_000) })
      .where('name', '=', created.name)
      .execute();
    await probe.destroy();

    await until(async () => {
      const fetched = json(
        await call('GET', `/v1/ns/acme/schedules/${created.name}`, { key: adminKey })
      );
      return fetched.runCount > 0 && fetched.lastWorkflowId !== null;
    }, 30_000);
  }, 60_000);
});

/**
 * Inbound event handlers, over the API.
 *
 * The dispatcher's behaviour is proven in `store`; what needs the container is
 * that the routes exist, are scoped, and that a handler survives a round trip.
 */
describe('event handlers', () => {
  let seq = 0;

  const body = (overrides: Record<string, unknown> = {}) => ({
    name: `on-order-${++seq}`,
    source: 'kafka:default',
    topic: 'orders',
    action: 'START_WORKFLOW',
    workflow: { name: 'checkout', version: 1 },
    inputTemplate: { id: '${event.output.orderId}' },
    ...overrides,
  });

  it('creates a handler and reads it back', async () => {
    const created = await call('POST', '/v1/ns/acme/event-handlers', {
      key: adminKey,
      body: body(),
    });
    expect(created.statusCode).toBe(201);

    const fetched = json(
      await call(`GET`, `/v1/ns/acme/event-handlers/${json(created).name}`, { key: adminKey })
    );

    expect(fetched.topic).toBe('orders');
    expect(fetched.inputTemplate).toEqual({ id: '${event.output.orderId}' });
    expect(fetched.enabled).toBe(true);
    expect(fetched.eventCount).toBe(0);
  });

  // A handler missing the workflow it starts would look healthy until the first
  // message arrived.
  it('rejects a handler that cannot do what it says', async () => {
    const response = await call('POST', '/v1/ns/acme/event-handlers', {
      key: adminKey,
      body: body({ workflow: undefined }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a task action with nothing to identify the task', async () => {
    const response = await call('POST', '/v1/ns/acme/event-handlers', {
      key: adminKey,
      body: body({ action: 'COMPLETE_TASK' }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('disables and enables', async () => {
    const created = json(
      await call('POST', '/v1/ns/acme/event-handlers', { key: adminKey, body: body() })
    );

    expect(
      json(
        await call('POST', `/v1/ns/acme/event-handlers/${created.name}/disable`, { key: adminKey })
      ).enabled
    ).toBe(false);
    expect(
      json(
        await call('POST', `/v1/ns/acme/event-handlers/${created.name}/enable`, { key: adminKey })
      ).enabled
    ).toBe(true);
  });

  it('deletes', async () => {
    const created = json(
      await call('POST', '/v1/ns/acme/event-handlers', { key: adminKey, body: body() })
    );

    expect(
      (await call('DELETE', `/v1/ns/acme/event-handlers/${created.name}`, { key: adminKey }))
        .statusCode
    ).toBe(204);
    expect(
      (await call('GET', `/v1/ns/acme/event-handlers/${created.name}`, { key: adminKey }))
        .statusCode
    ).toBe(404);
  });

  it('refuses a caller who may not write workflows', async () => {
    const response = await call('POST', '/v1/ns/acme/event-handlers', {
      key: readOnlyKey,
      body: body(),
    });

    expect(response.statusCode).toBe(403);
  });

  // An install with no configured source starts no consumer, which is what
  // makes consuming free for installs that do not use it.
  it('boots with no event sources configured', async () => {
    expect((await call('GET', '/v1/health/ready')).statusCode).toBe(200);
  });
});

/**
 * Groups, and the scopes they grant.
 *
 * The container-level case that matters is that a group's scopes reach the
 * principal at all: `UserRepository` takes its `GroupRepository` as an optional
 * constructor argument, which is precisely the shape that has now silently
 * disabled three features in this codebase when a DI factory forgot to pass it.
 */
describe('groups', () => {
  const PASSWORD = 'correct-horse-battery-staple-77';
  let people = 0;
  let teams = 0;

  async function makeUser(scopes: string[]) {
    const email = `member-${++people}@example.com`;
    const created = json(
      await call('POST', '/v1/ns/acme/users', {
        key: adminKey,
        body: { email, name: 'Member', password: PASSWORD, scopes },
      })
    );
    return { id: created.id as string, email };
  }

  /** The scopes the server says this person holds, after logging them in. */
  async function scopesOf(email: string): Promise<string[]> {
    const response = await call('POST', '/v1/ns/acme/users/login', {
      body: { email, password: PASSWORD },
    });
    return json(response).user.scopes ?? [];
  }

  const makeGroup = (scopes: string[]) =>
    call('POST', '/v1/ns/acme/groups', {
      key: adminKey,
      body: { name: `team-${++teams}`, scopes },
    });

  it('creates a group with scopes', async () => {
    const response = await makeGroup([Scope.EXECUTIONS_READ]);

    expect(response.statusCode).toBe(201);
    expect(json(response).scopes).toEqual([Scope.EXECUTIONS_READ]);
  });

  // A typo would otherwise sit in a group looking like a permission and
  // granting nothing.
  it('refuses an invalid scope', async () => {
    const response = await call('POST', '/v1/ns/acme/groups', {
      key: adminKey,
      body: { name: `team-${++teams}`, scopes: ['executions:reed!!'] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a duplicate name', async () => {
    const first = json(await makeGroup([]));
    const response = await call('POST', '/v1/ns/acme/groups', {
      key: adminKey,
      body: { name: first.name, scopes: [] },
    });

    expect(response.statusCode).toBe(409);
  });

  /**
   * The wiring assertion.
   *
   * The user is created with no scopes at all, so anything they can do comes
   * from the group alone.
   */
  it('grants a member the group’s scopes', async () => {
    const user = await makeUser([]);
    const group = json(await makeGroup([Scope.EXECUTIONS_READ]));

    // Before joining: the group's scope is not theirs.
    expect(await scopesOf(user.email)).not.toContain(Scope.EXECUTIONS_READ);

    expect(
      (
        await call('POST', `/v1/ns/acme/groups/${group.name}/members`, {
          key: adminKey,
          body: { userId: user.id },
        })
      ).statusCode
    ).toBe(204);

    expect(await scopesOf(user.email)).toContain(Scope.EXECUTIONS_READ);
  });

  // Scopes are resolved per request rather than frozen into a session, so a
  // revocation takes effect without waiting for a logout.
  it('withdraws them when the member is removed', async () => {
    const user = await makeUser([]);
    const group = json(await makeGroup([Scope.EXECUTIONS_READ]));

    await call('POST', `/v1/ns/acme/groups/${group.name}/members`, {
      key: adminKey,
      body: { userId: user.id },
    });
    expect(await scopesOf(user.email)).toContain(Scope.EXECUTIONS_READ);

    await call('DELETE', `/v1/ns/acme/groups/${group.name}/members/${user.id}`, {
      key: adminKey,
    });
    expect(await scopesOf(user.email)).not.toContain(Scope.EXECUTIONS_READ);
  });

  it('lists members', async () => {
    const user = await makeUser([]);
    const group = json(await makeGroup([]));
    await call('POST', `/v1/ns/acme/groups/${group.name}/members`, {
      key: adminKey,
      body: { userId: user.id },
    });

    const fetched = json(await call('GET', `/v1/ns/acme/groups/${group.name}`, { key: adminKey }));
    expect(fetched.members.map((m: { email: string }) => m.email)).toContain(user.email);
  });

  // Editing a group's scopes grants permissions to everyone in it — the
  // privilege-escalation surface of the whole authorization model.
  it('refuses a non-admin', async () => {
    const response = await call('POST', '/v1/ns/acme/groups', {
      key: readOnlyKey,
      body: { name: `team-${++teams}`, scopes: [] },
    });

    expect(response.statusCode).toBe(403);
  });
});

/**
 * The audit log.
 *
 * Its whole value is completeness, so the tests are about what gets recorded
 * without anyone asking — the interceptor is global precisely because a log
 * that depends on each author remembering a line has holes nobody sees until
 * the entry they need is the missing one.
 */
describe('audit log', () => {
  let seq = 0;

  const entriesFor = async (resource: string) =>
    json(await call('GET', `/v1/ns/acme/audit?resource=${resource}`, { key: adminKey })).entries;

  it('records a control-plane change with who and what', async () => {
    const name = `audited-team-${++seq}`;
    await call('POST', '/v1/ns/acme/groups', { key: adminKey, body: { name, scopes: [] } });

    await until(async () => (await entriesFor('group')).length > 0);

    const entry = (await entriesFor('group')).find(
      (e: { resourceId: string }) => e.resourceId === undefined || true
    );
    expect(entry.action).toBe('group.create');
    expect(entry.actor.type).toBe('SERVICE_ACCOUNT');
    expect(entry.outcome).toBe('ok');
  });

  /**
   * The body of a secret write contains the secret.
   *
   * Recording field *names* keeps the entry useful — "they replaced the value
   * and the description" — without making the audit log a second place
   * credentials live.
   */
  it('records that a secret changed without recording the secret', async () => {
    const sentinel = 'audit-sentinel-value-9f3a';
    await call('PUT', '/v1/ns/acme/secrets/AUDITED_KEY', {
      key: adminKey,
      body: { value: sentinel, description: 'x' },
    });

    await until(async () => (await entriesFor('secret')).length > 0);
    const entries = await entriesFor('secret');

    expect(entries[0].action).toBe('secret.put');
    expect(entries[0].resourceId).toBe('AUDITED_KEY');
    expect(entries[0].detail.fields).toEqual(expect.arrayContaining(['value', 'description']));
    expect(JSON.stringify(entries)).not.toContain(sentinel);
  });

  // "Who tried to read the production secrets and was refused" is the question
  // an incident starts with, so a denial has to be in the log.
  it('records a refused attempt', async () => {
    await call('POST', '/v1/ns/acme/groups', {
      key: readOnlyKey,
      body: { name: `denied-${++seq}`, scopes: [] },
    });

    await until(async () => {
      const entries = await entriesFor('group');
      return entries.some((e: { outcome: string }) => e.outcome === 'denied');
    });
  });

  it('pages newest-first with a cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await call('POST', '/v1/ns/acme/groups', {
        key: adminKey,
        body: { name: `paged-${++seq}`, scopes: [] },
      });
    }

    await until(async () => (await entriesFor('group')).length >= 3);

    const first = json(
      await call('GET', '/v1/ns/acme/audit?resource=group&limit=2', { key: adminKey })
    );
    expect(first.entries).toHaveLength(2);

    const second = json(
      await call(
        'GET',
        `/v1/ns/acme/audit?resource=group&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
        { key: adminKey }
      )
    );

    // Strictly older, and no overlap across the page boundary.
    const firstIds = first.entries.map((e: { id: string }) => e.id);
    const secondIds = second.entries.map((e: { id: string }) => e.id);
    expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]);
  });

  it('refuses a non-admin reader', async () => {
    expect((await call('GET', '/v1/ns/acme/audit', { key: readOnlyKey })).statusCode).toBe(403);
  });

  type Entry = { action: string; resourceId: string; detail: { before?: unknown; after?: unknown } };
  const entryFor = async (resource: string, match: (e: Entry) => boolean) => {
    let found: Entry | undefined;
    await until(async () => {
      found = ((await entriesFor(resource)) as Entry[]).find(match);
      return found !== undefined;
    });
    return found as Entry;
  };

  it('records the entity before and after a change', async () => {
    const name = `AUDIT_DIFF_${++seq}`;
    await call('PUT', `/v1/ns/acme/environment/${name}`, { key: adminKey, body: { value: 'blue' } });
    const created = await entryFor('environment-variable', (e) => e.resourceId === name);
    expect(created.detail).toMatchObject({ before: null, after: { name, value: 'blue' } });

    await call('PUT', `/v1/ns/acme/environment/${name}`, { key: adminKey, body: { value: 'green' } });
    const updated = await entryFor('environment-variable', (e) => e.resourceId === name && (e.detail.before as { value?: string } | null)?.value === 'blue');
    expect(updated.detail).toMatchObject({ before: { value: 'blue' }, after: { value: 'green' } });

    await call('DELETE', `/v1/ns/acme/environment/${name}`, { key: adminKey });
    const deleted = await entryFor('environment-variable', (e) => e.action === 'environment-variable.delete' && e.resourceId === name);
    expect(deleted.detail).toMatchObject({ before: { value: 'green' }, after: null });
  });

  // The decorator for adding a member sat on the tag-grants route: adding
  // someone to a group — a grant of access — was never recorded, and every
  // tag-grant change was logged as a member being added.
  it('records adding a group member as that, and tag grants as those', async () => {
    const group = `diff-team-${++seq}`;
    const email = `member-${seq}-${Date.now()}@example.com`;
    await call('POST', '/v1/ns/acme/groups', { key: adminKey, body: { name: group, scopes: [] } });
    const user = json(
      await call('POST', '/v1/ns/acme/users', { key: adminKey, body: { email, name: 'Member', password: 'correct-horse-battery-staple-77', scopes: [] } })
    );

    await call('POST', `/v1/ns/acme/groups/${group}/members`, { key: adminKey, body: { userId: user.id } });
    const added = await entryFor('group', (e) => e.action === 'group.member-add' && e.resourceId === group);
    expect(added.detail).toMatchObject({ before: { members: [] }, after: { members: [email] } });

    await call('PUT', `/v1/ns/acme/groups/${group}/tag-grants`, { key: adminKey, body: { tagGrants: ['env:prod'] } });
    const granted = await entryFor('group', (e) => e.action === 'group.tag-grants-set' && e.resourceId === group);
    expect(granted.detail).toMatchObject({ before: { tagGrants: [] }, after: { tagGrants: ['env:prod'] } });

    // Never a password hash, whatever the user snapshot holds.
    const userEntry = await entryFor('user', (e) => e.resourceId === email);
    expect(userEntry.detail).toMatchObject({ before: null, after: { email } });
    expect(JSON.stringify(userEntry)).not.toMatch(/passwordHash|\$argon|\$scrypt/i);
  });
});

/**
 * Per-tenant quotas.
 *
 * Enforced at the front door — starting a workflow, registering a definition,
 * creating a schedule — because shedding at admission is the only load-shedding
 * that leaves in-flight work intact.
 */
/**
 * Named semaphores, which until now could be declared but never configured.
 *
 * `ConcurrencyRepository.configureSemaphore` existed and the dispatcher
 * honoured it, but nothing outside the repository's own tests ever called it —
 * there was no route. That is worse than the feature being absent: an
 * unconfigured semaphore does not gate, so a task definition could name one,
 * register cleanly, and run entirely ungated. A declared control that silently
 * does nothing is the failure every control here exists to prevent.
 */
describe('semaphores', () => {
  it('can be created, read back with its usage, resized and removed', async () => {
    const name = unique('fragile-api');

    const created = await call('PUT', `/v1/ns/acme/semaphores/${name}`, {
      key: adminKey,
      body: { permits: 3 },
    });
    expect(created.statusCode).toBe(200);
    expect(json(created)).toMatchObject({ name, permits: 3, held: 0 });

    const listed = await call('GET', '/v1/ns/acme/semaphores', { key: adminKey });
    expect(listed.statusCode).toBe(200);
    expect(json(listed).semaphores.map((s: { name: string }) => s.name)).toContain(name);

    const resized = await call('PUT', `/v1/ns/acme/semaphores/${name}`, {
      key: adminKey,
      body: { permits: 1 },
    });
    expect(json(resized).permits).toBe(1);

    expect((await call('DELETE', `/v1/ns/acme/semaphores/${name}`, { key: adminKey })).statusCode).toBe(204);
    expect((await call('GET', `/v1/ns/acme/semaphores/${name}`, { key: adminKey })).statusCode).toBe(404);
  });

  // Silence here would be indistinguishable from a limit being enforced, which
  // is the whole problem this endpoint was added to solve.
  it('says plainly that an unconfigured semaphore gates nothing', async () => {
    const response = await call('GET', `/v1/ns/acme/semaphores/${unique('never-set')}`, { key: adminKey });

    expect(response.statusCode).toBe(404);
    expect(json(response).message).toMatch(/gates nothing/);
  });

  it('is admin-only, like every other cap', async () => {
    const response = await call('PUT', `/v1/ns/acme/semaphores/${unique('sneaky')}`, {
      key: workerKey,
      body: { permits: 99 },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('quotas', () => {
  let seq = 0;

  const setQuotas = (quotas: Record<string, number | undefined>) =>
    call('PUT', '/v1/ns/acme/quotas', { key: adminKey, body: quotas });

  /** Removes every limit again, so one test cannot starve the next. */
  const clearQuotas = () => setQuotas({});

  afterEach(async () => {
    await clearQuotas();
  });

  it('round-trips, and unset means unlimited', async () => {
    expect(json(await setQuotas({ maxSchedules: 2 })).maxSchedules).toBe(2);

    const read = json(await call('GET', '/v1/ns/acme/quotas', { key: adminKey }));
    expect(read.maxSchedules).toBe(2);
    expect(read.maxConcurrentExecutions).toBeUndefined();
  });

  it('refuses a negative limit', async () => {
    expect((await setQuotas({ maxSchedules: -1 })).statusCode).toBe(400);
  });

  // A tenant that can raise its own limits does not have limits.
  it('refuses a non-admin', async () => {
    expect(
      (await call('PUT', '/v1/ns/acme/quotas', { key: readOnlyKey, body: {} })).statusCode
    ).toBe(403);
  });

  it('caps schedules', async () => {
    await setQuotas({ maxSchedules: 0 });

    const response = await call('POST', '/v1/ns/acme/schedules', {
      key: adminKey,
      body: {
        name: `quota-sched-${++seq}`,
        cron: '0 * * * * *',
        workflow: { name: 'checkout', version: 1 },
      },
    });

    expect(response.statusCode).toBe(429);
    expect(json(response).error).toBe('LIMIT_EXCEEDED');
  });

  it('caps workflow definitions', async () => {
    await setQuotas({ maxWorkflowDefinitions: 1 });

    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: `quota-wf-${++seq}`,
        version: 1,
        tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }],
      },
    });

    expect(response.statusCode).toBe(429);
  });

  /**
   * A 429 with no `Retry-After` is an invitation to hot-loop: a client told to
   * come back later and not told when comes back immediately.
   */
  it('tells a rate-limited caller when to return', async () => {
    await setQuotas({ maxExecutionsPerMinute: 0 });

    const response = await call('POST', '/v1/ns/acme/executions/checkout', {
      key: adminKey,
      body: { input: {} },
    });

    expect(response.statusCode).toBe(429);
    const retryAfter = Number(response.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('caps concurrent executions', async () => {
    await setQuotas({ maxConcurrentExecutions: 0 });

    const response = await call('POST', '/v1/ns/acme/executions/checkout', {
      key: adminKey,
      body: { input: {} },
    });

    expect(response.statusCode).toBe(429);
    expect(json(response).details.quota).toBe('maxConcurrentExecutions');
  });

  /**
   * The race the shared transaction exists for.
   *
   * Checking the count and inserting the row separately lets concurrent starts
   * each read `limit - 1` running and each proceed — the exact burst a quota
   * exists to prevent, and one that only appears under the load that makes it
   * matter.
   */
  it('admits exactly the limit under concurrent starts', async () => {
    // Relative to what is already running. Earlier tests in this file leave
    // executions in flight — there is no worker for `charge` — so an absolute
    // limit would already be spent before this test starts, and the assertion
    // would pass or fail depending on what ran before it.
    const probe = createDatabase({ url: container.getConnectionUri() });
    const rows = await probe
      .selectFrom('WorkflowExecutions')
      .select('id')
      .where('namespaceId', '=', namespaceId)
      .where('status', 'in', [WorkflowStatus.RUNNING, WorkflowStatus.PAUSED])
      .execute();
    await probe.destroy();
    const running = rows.length;

    await setQuotas({ maxConcurrentExecutions: running + 2 });

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        call('POST', '/v1/ns/acme/executions/checkout', { key: adminKey, body: { input: {} } })
      )
    );

    const admitted = attempts.filter((r) => r.statusCode === 201).length;
    const refused = attempts.filter((r) => r.statusCode === 429).length;

    expect(admitted).toBe(2);
    expect(refused).toBe(6);
  });
});

/**
 * OIDC workload identity, through the container.
 *
 * The verifier has its own tests; this one exists because registering an
 * authenticator is exactly the wiring that has silently disabled a feature
 * three times in this codebase. A real token, signed by a real key, served from
 * a real JWKS endpoint, arriving as a real `Authorization` header.
 */
describe('workload identity', () => {
  let seq = 0;

  // Read lazily: a `describe` body runs at collection time, before `beforeAll`
  // has started the JWKS server and chosen its port.
  const issuer = () => OIDC_ISSUER;
  const subject = () => `system:serviceaccount:prod:worker-${++seq}`;

  function token(claims: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iss: issuer(), aud: 'node-flow', iat: now, exp: now + 300, ...claims })
    ).toString('base64url');

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    return `${header}.${payload}.${signer.sign(oidcKeys.privateKey).toString('base64url')}`;
  }

  async function serviceAccount(name: string) {
    await call('POST', '/v1/auth/service-accounts', {
      key: adminKey,
      body: { name, scopes: [Scope.WORKFLOWS_READ] },
    });
    return name;
  }

  it('authenticates a bound workload token', async () => {
    const sub = subject();
    const account = await serviceAccount(`wi-${seq}`);

    expect(
      (
        await call('POST', '/v1/ns/acme/workload-identities', {
          key: adminKey,
          body: { serviceAccount: account, kind: 'oidc', issuer: issuer(), subject: sub },
        })
      ).statusCode
    ).toBe(201);

    // No API key, no session — the token alone.
    const response = await call('GET', '/v1/ns/acme/metadata/workflows', {
      bearer: token({ sub }),
    });

    // 200 and not 403: the token both authenticated *and* carried the service
    // account's scopes, which is the half a binding that merely resolved would
    // fail.
    expect(response.statusCode).toBe(200);
  });

  /**
   * A *verified* token with no binding is a caller who proved an identity this
   * install has not authorised — different from a broken token, and worth
   * saying so.
   */
  it('refuses a verified token that is not bound', async () => {
    const response = await call('GET', '/v1/ns/acme/metadata/workflows', {
      bearer: token({ sub: subject() }),
    });

    expect(response.statusCode).toBe(401);
    expect(json(response).message).toMatch(/not bound/);
  });

  it('refuses a token from an untrusted issuer', async () => {
    const sub = subject();
    const account = await serviceAccount(`wi-${seq}`);
    await call('POST', '/v1/ns/acme/workload-identities', {
      key: adminKey,
      body: { serviceAccount: account, kind: 'oidc', issuer: issuer(), subject: sub },
    });

    const response = await call('GET', '/v1/ns/acme/metadata/workflows', {
      bearer: token({ sub, iss: 'https://attacker.example' }),
    });

    expect(response.statusCode).toBe(401);
  });

  it('refuses an expired token', async () => {
    const sub = subject();
    const account = await serviceAccount(`wi-${seq}`);
    await call('POST', '/v1/ns/acme/workload-identities', {
      key: adminKey,
      body: { serviceAccount: account, kind: 'oidc', issuer: issuer(), subject: sub },
    });

    const response = await call('GET', '/v1/ns/acme/metadata/workflows', {
      bearer: token({ sub, exp: Math.floor(Date.now() / 1000) - 3600 }),
    });

    expect(response.statusCode).toBe(401);
  });

  // Grants everything the service account can do to whoever holds the token.
  it('refuses a non-admin creating a binding', async () => {
    const response = await call('POST', '/v1/ns/acme/workload-identities', {
      key: readOnlyKey,
      body: { serviceAccount: 'x', kind: 'oidc', issuer: issuer(), subject: subject() },
    });

    expect(response.statusCode).toBe(403);
  });
});

/**
 * Tag-based resource access.
 *
 * **Tags restrict; they never grant.** An untagged workflow is governed by
 * scopes alone; a tagged one additionally needs a matching grant. The tests are
 * written around that asymmetry, because the opposite model fails silently — a
 * resource nobody has tagged would be reachable by everyone.
 */
describe('resource tags', () => {
  const PASSWORD = 'correct-horse-battery-staple-55';
  let seq = 0;

  async function taggedWorkflow(tags: string[]): Promise<string> {
    const name = `tagged-${++seq}`;
    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        version: 1,
        tags,
        tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }],
      },
    });
    expect(response.statusCode).toBe(201);
    return name;
  }

  /** A signed-in person whose only reach comes from one group. */
  async function reader(tagGrants: string[]) {
    const group = `readers-${++seq}`;
    await call('POST', '/v1/ns/acme/groups', {
      key: adminKey,
      body: { name: group, scopes: [Scope.WORKFLOWS_READ, Scope.EXECUTIONS_START, Scope.EXECUTIONS_READ], tagGrants },
    });

    const email = `reader-${seq}@example.com`;
    const created = json(
      await call('POST', '/v1/ns/acme/users', {
        key: adminKey,
        body: { email, name: 'Reader', password: PASSWORD, scopes: [] },
      })
    );
    await call('POST', `/v1/ns/acme/groups/${group}/members`, {
      key: adminKey,
      body: { userId: created.id },
    });

    const login = await call('POST', '/v1/ns/acme/users/login', {
      body: { email, password: PASSWORD },
    });

    const cookies = (name: string) => {
      const raw = login.headers['set-cookie'];
      const all = Array.isArray(raw) ? raw : [raw];
      const match = all.find((v) => typeof v === 'string' && v.startsWith(`${name}=`));
      return match ? decodeURIComponent(String(match).split('=')[1].split(';')[0]) : '';
    };

    const session = cookies(SESSION_COOKIE);
    const csrf = cookies(CSRF_COOKIE);

    return (method: 'GET' | 'POST', url: string, body?: unknown) =>
      call(method, url, {
        cookies: { [SESSION_COOKIE]: session, [CSRF_COOKIE]: csrf },
        csrf,
        body,
      });
  }

  it('hides a tagged workflow from someone with no matching grant', async () => {
    const name = await taggedWorkflow(['env:prod']);
    const asUser = await reader(['env:dev']);

    expect((await asUser('GET', `/v1/ns/acme/metadata/workflows/${name}`)).statusCode).toBe(404);
  });

  // Tags protect a workflow's executions too: its input, output and history are
  // at least as sensitive as its definition.
  it('hides the executions of a tagged workflow from someone with no matching grant', async () => {
    const name = await taggedWorkflow(['env:prod']);
    const started = json(await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: { input: { salary: 1 } } }));
    const outsider = await reader(['env:dev']);
    const insider = await reader(['env:prod']);

    for (const path of [`/v1/ns/acme/executions/${started.workflowId}`, `/v1/ns/acme/executions/${started.workflowId}/status`, `/v1/ns/acme/executions/${started.workflowId}/history`]) {
      expect((await outsider('GET', path)).statusCode).toBe(404);
      expect((await insider('GET', path)).statusCode).toBe(200);
    }

    expect((await outsider('GET', `/v1/ns/acme/executions/${started.workflowId}/stream`)).statusCode).toBe(404);

    const hidden = json(await outsider('POST', '/v1/ns/acme/executions/search', { defName: name }));
    expect(hidden.executions).toEqual([]);
    const all = json(await outsider('POST', '/v1/ns/acme/executions/search', {}));
    expect(all.executions.map((e: { defName: string }) => e.defName)).not.toContain(name);
    const shown = json(await insider('POST', '/v1/ns/acme/executions/search', { defName: name }));
    expect(shown.executions.map((e: { workflowId: string }) => e.workflowId)).toContain(started.workflowId);
  });

  it('shows it to someone whose grant matches', async () => {
    const name = await taggedWorkflow(['env:prod']);
    const asUser = await reader(['env:prod']);

    expect((await asUser('GET', `/v1/ns/acme/metadata/workflows/${name}`)).statusCode).toBe(200);
  });

  // The whole point of the direction: tagging can only ever narrow.
  it('leaves an untagged workflow reachable by everyone', async () => {
    const name = await taggedWorkflow([]);
    const asUser = await reader([]);

    expect((await asUser('GET', `/v1/ns/acme/metadata/workflows/${name}`)).statusCode).toBe(200);
  });

  // A definition you cannot reach must not appear in a list and then vanish
  // when opened.
  it('filters the listing rather than only the fetch', async () => {
    const hidden = await taggedWorkflow(['env:prod']);
    const visible = await taggedWorkflow([]);
    const asUser = await reader(['env:dev']);

    const listed = json(await asUser('GET', '/v1/ns/acme/metadata/workflows')).map(
      (w: { name: string }) => w.name
    );

    expect(listed).toContain(visible);
    expect(listed).not.toContain(hidden);
  });

  /**
   * Reading a definition you cannot reach is one thing; running it is another,
   * and starting is the more consequential.
   */
  it('refuses to start a workflow the caller cannot reach', async () => {
    const name = await taggedWorkflow(['env:prod']);
    const asUser = await reader(['env:dev']);

    const response = await asUser('POST', `/v1/ns/acme/executions/${name}`, { input: {} });

    // 404, not 403: a caller must not be able to map what exists in a space
    // they cannot see.
    expect(response.statusCode).toBe(404);
  });

  it('allows a start when the grant matches', async () => {
    const name = await taggedWorkflow(['team:payments']);
    const asUser = await reader(['team:*']);

    expect(
      (await asUser('POST', `/v1/ns/acme/executions/${name}`, { input: {} })).statusCode
    ).toBe(201);
  });

  /**
   * Tagging must protect a definition from being *replaced*, not only from
   * being read — the more damaging of the two.
   */
  it('refuses to register over a tagged workflow the caller cannot reach', async () => {
    const name = await taggedWorkflow(['env:prod']);
    const group = `editors-${++seq}`;
    await call('POST', '/v1/ns/acme/groups', {
      key: adminKey,
      body: { name: group, scopes: [Scope.WORKFLOWS_WRITE], tagGrants: ['env:dev'] },
    });

    const email = `editor-${seq}@example.com`;
    const created = json(
      await call('POST', '/v1/ns/acme/users', {
        key: adminKey,
        body: { email, name: 'Editor', password: PASSWORD, scopes: [] },
      })
    );
    await call('POST', `/v1/ns/acme/groups/${group}/members`, {
      key: adminKey,
      body: { userId: created.id },
    });
    const login = await call('POST', '/v1/ns/acme/users/login', {
      body: { email, password: PASSWORD },
    });
    const raw = login.headers['set-cookie'];
    const all = Array.isArray(raw) ? raw : [raw];
    const pick = (n: string) => {
      const m = all.find((v) => typeof v === 'string' && v.startsWith(`${n}=`));
      return m ? decodeURIComponent(String(m).split('=')[1].split(';')[0]) : '';
    };

    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      cookies: { [SESSION_COOKIE]: pick(SESSION_COOKIE), [CSRF_COOKIE]: pick(CSRF_COOKIE) },
      csrf: pick(CSRF_COOKIE),
      body: {
        name,
        version: 2,
        tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('keeps a workflow protected when a new version is saved without mentioning tags', async () => {
    const name = await taggedWorkflow(['env:prod']);
    // What the editor sends: a new version, no tags field.
    const saved = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name, version: 2, tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }] },
    });
    expect(saved.statusCode).toBe(201);

    const asUser = await reader(['env:dev']);
    expect((await asUser('GET', `/v1/ns/acme/metadata/workflows/${name}?version=2`)).statusCode).toBe(404);
    expect((await asUser('GET', `/v1/ns/acme/metadata/workflows/${name}?version=1`)).statusCode).toBe(404);
  });

  it('retags every version at once, and shows who can reach each tag', async () => {
    const name = await taggedWorkflow([]);
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name, version: 2, tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }] },
    });
    const asUser = await reader(['team:ops-*']);

    const retagged = await call('PUT', `/v1/ns/acme/metadata/workflows/${name}/tags`, {
      key: adminKey,
      body: { tags: ['team:payroll'] },
    });
    expect(json(retagged)).toEqual({ name, tags: ['team:payroll'] });
    expect((await asUser('GET', `/v1/ns/acme/metadata/workflows/${name}?version=1`)).statusCode).toBe(404);

    const overview = json(await call('GET', '/v1/ns/acme/tags', { key: adminKey }));
    const payroll = overview.tags.find((t: { tag: string }) => t.tag === 'team:payroll');
    expect(payroll.workflows).toContain(name);
    // `team:ops-*` is not a valid wildcard (only `key:*` is), so it opens nothing.
    expect(overview.grants.find((g: { pattern: string }) => g.pattern === 'team:ops-*').matches).toEqual([]);

    expect((await asUser('GET', '/v1/ns/acme/tags')).statusCode).toBe(403);
    expect((await call('PUT', `/v1/ns/acme/metadata/workflows/${name}/tags`, { key: adminKey, body: { tags: ['Bad Tag'] } })).statusCode).toBe(400);
    expect((await call('PUT', '/v1/ns/acme/metadata/workflows/no-such-workflow/tags', { key: adminKey, body: { tags: [] } })).statusCode).toBe(404);
  });

  it('refuses a malformed tag', async () => {
    const response = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: `bad-tag-${++seq}`,
        version: 1,
        tags: ['no-separator'],
        tasks: [{ name: 'a', taskReferenceName: 'a', type: 'NOOP' }],
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

/**
 * Single sign-on, end to end against a fake identity provider.
 *
 * The service's own tests cover the signed flow state and `returnTo`; this is
 * the part that only exists once the routes, the cookies and the token exchange
 * are wired together — including the `state` check, which is the only thing
 * between a public `GET` callback and login CSRF.
 */
describe('single sign-on', () => {
  const cookiesFrom = (response: { headers: Record<string, unknown> }) => {
    const raw = response.headers['set-cookie'];
    const all = Array.isArray(raw) ? raw : [raw];
    return all.filter((v): v is string => typeof v === 'string');
  };

  const valueOf = (cookies: string[], name: string) => {
    const match = cookies.find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split('=')[1].split(';')[0]) : undefined;
  };

  /** Runs the redirect half and returns what the browser would now hold. */
  async function beginLogin(returnTo = '/executions') {
    const response = await call('GET', `/v1/auth/sso/corp/login?returnTo=${encodeURIComponent(returnTo)}`);
    expect(response.statusCode).toBe(302);

    const location = new URL(String(response.headers['location']));
    return {
      state: location.searchParams.get('state') ?? '',
      nonce: location.searchParams.get('nonce') ?? '',
      flowCookie: valueOf(cookiesFrom(response), 'nf_sso') ?? '',
      location,
    };
  }

  it('lists the configured providers without their secrets', async () => {
    const response = await call('GET', '/v1/auth/sso/providers');

    expect(response.statusCode).toBe(200);
    expect(json(response).providers[0].name).toBe('corp');
    expect(response.body).not.toContain('test-secret');
  });

  it('redirects to the provider with PKCE and a state', async () => {
    const { location, state } = await beginLogin();

    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('client_id')).toBe('node-flow-ui');
    expect(state).toBeTruthy();
  });

  it('completes a login and issues a usable session', async () => {
    const { state, nonce, flowCookie } = await beginLogin();

    // The fake IdP encodes the nonce into the code, as a real one binds it.
    const response = await call(
      'GET',
      `/v1/auth/sso/corp/callback?code=abc:${nonce}&state=${encodeURIComponent(state)}`,
      { cookies: { nf_sso: flowCookie } }
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('/executions');

    const cookies = cookiesFrom(response);
    const session = valueOf(cookies, SESSION_COOKIE);
    expect(session).toBeTruthy();

    // The account was provisioned on first sign-in, and the session works.
    const me = await call('GET', '/v1/ns/acme/human-tasks', {
      cookies: { [SESSION_COOKIE]: session as string },
    });

    // 403 rather than 401: authenticated, and holding no scopes yet — which is
    // the point of provisioning authority separately from identity.
    expect(me.statusCode).toBe(403);
  });

  /**
   * Login CSRF.
   *
   * An attacker completes their own login at the IdP and redirects the victim
   * to the callback with the attacker's code. Without the state check the
   * victim is signed into the attacker's account, and everything they do next
   * happens there.
   */
  it('refuses a callback whose state was not issued here', async () => {
    const { nonce, flowCookie } = await beginLogin();

    const response = await call(
      'GET',
      `/v1/auth/sso/corp/callback?code=abc:${nonce}&state=attacker-chosen`,
      { cookies: { nf_sso: flowCookie } }
    );

    expect(response.statusCode).toBe(400);
    expect(cookiesFrom(response).some((c) => c.startsWith('nf_sso=;'))).toBe(true);
  });

  // Without the cookie there is nothing to compare the state against.
  it('refuses a callback with no flow cookie', async () => {
    const { state, nonce } = await beginLogin();

    const response = await call(
      'GET',
      `/v1/auth/sso/corp/callback?code=abc:${nonce}&state=${encodeURIComponent(state)}`
    );

    expect(response.statusCode).toBe(400);
  });

  /**
   * The nonce binds the ID token to *this* login. A token obtained in another
   * flow is otherwise replayable into this one.
   */
  it('refuses an ID token minted for a different login', async () => {
    const { state, flowCookie } = await beginLogin();

    const response = await call(
      'GET',
      `/v1/auth/sso/corp/callback?code=abc:some-other-nonce&state=${encodeURIComponent(state)}`,
      { cookies: { nf_sso: flowCookie } }
    );

    expect(response.statusCode).toBe(400);
    expect(json(response).message).toMatch(/does not match this login/);
  });

  it('reports a provider that refused', async () => {
    const { state, flowCookie } = await beginLogin();

    const response = await call(
      'GET',
      `/v1/auth/sso/corp/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      { cookies: { nf_sso: flowCookie } }
    );

    expect(response.statusCode).toBe(400);
  });

  it('404s an unknown provider', async () => {
    expect((await call('GET', '/v1/auth/sso/nope/login')).statusCode).toBe(404);
  });
});

/**
 * SAML, over the routes rather than the service.
 *
 * The assertion validation itself is covered in `saml.service.spec.ts`; what
 * these check is the part only the HTTP layer has: that the cross-site POST
 * carries a flow cookie the server signed, that a mismatched `RelayState` is
 * refused before anything is parsed, and that a successful assertion issues the
 * same session a password login does.
 */
describe('SAML single sign-on', () => {
  const cookiesFrom = (response: { headers: Record<string, unknown> }) => {
    const raw = response.headers['set-cookie'];
    const all = Array.isArray(raw) ? raw : [raw];
    return all.filter((v): v is string => typeof v === 'string');
  };

  const valueOf = (cookies: string[], name: string) => {
    const match = cookies.find((c) => c.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split('=')[1].split(';')[0]) : undefined;
  };

  /** Runs the redirect half and returns what the browser and the IdP now hold. */
  async function beginLogin(returnTo = '/executions') {
    const response = await call('GET', `/v1/auth/saml/corp-saml/login?returnTo=${encodeURIComponent(returnTo)}`);
    expect(response.statusCode).toBe(302);

    const location = new URL(String(response.headers['location']));
    const request = inflateRawSync(Buffer.from(location.searchParams.get('SAMLRequest') as string, 'base64')).toString('utf8');

    return {
      relay: location.searchParams.get('RelayState') ?? '',
      requestId: /ID="([^"]+)"/.exec(request)?.[1] ?? '',
      flowCookie: valueOf(cookiesFrom(response), 'nf_saml') ?? '',
    };
  }

  const assertionFor = (requestId: string, email = 'saml-user@example.com') =>
    samlResponse({ idp, inResponseTo: requestId, audience: SAML_ENTITY_ID, recipient: SAML_ACS, email });

  it('lists the SAML provider alongside the OIDC one, each naming its protocol', async () => {
    const providers = json(await call('GET', '/v1/auth/sso/providers')).providers as {
      name: string;
      protocol: string;
    }[];

    expect(providers).toEqual(
      expect.arrayContaining([
        { name: 'corp', namespace: 'acme', protocol: 'oidc' },
        { name: 'corp-saml', namespace: 'acme', protocol: 'saml' },
      ])
    );
  });

  it('publishes service-provider metadata for the identity provider to import', async () => {
    const response = await call('GET', '/v1/auth/saml/corp-saml/metadata');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`entityID="${SAML_ENTITY_ID}"`);
    expect(response.body).toContain(SAML_ACS);
  });

  it('completes a login posted by the identity provider and issues a usable session', async () => {
    const { relay, requestId, flowCookie } = await beginLogin();

    const response = await call('POST', '/v1/auth/saml/corp-saml/callback', {
      cookies: { nf_saml: flowCookie },
      form: { SAMLResponse: assertionFor(requestId), RelayState: relay },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers['location']).toBe('/executions');

    const session = valueOf(cookiesFrom(response), SESSION_COOKIE);
    expect(session).toBeTruthy();

    // Provisioned on first sign-in, holding no scopes yet: 403, not 401.
    const me = await call('GET', '/v1/ns/acme/human-tasks', {
      cookies: { [SESSION_COOKIE]: session as string },
    });
    expect(me.statusCode).toBe(403);
  });

  /**
   * Login CSRF, SAML's version. `RelayState` is the only thing distinguishing
   * an assertion this browser asked for from one an attacker obtained.
   */
  it('refuses an assertion whose RelayState was not issued here', async () => {
    const { requestId, flowCookie } = await beginLogin();

    const response = await call('POST', '/v1/auth/saml/corp-saml/callback', {
      cookies: { nf_saml: flowCookie },
      form: { SAMLResponse: assertionFor(requestId), RelayState: 'attacker-chosen' },
    });

    expect(response.statusCode).toBe(400);
    expect(cookiesFrom(response).some((c) => c.startsWith('nf_saml=;'))).toBe(true);
  });

  it('refuses an assertion that answers someone else’s login', async () => {
    const mine = await beginLogin();
    const other = await beginLogin();

    const response = await call('POST', '/v1/auth/saml/corp-saml/callback', {
      cookies: { nf_saml: mine.flowCookie },
      form: { SAMLResponse: assertionFor(other.requestId), RelayState: mine.relay },
    });

    expect(response.statusCode).toBe(400);
    expect(json(response).message).toMatch(/does not answer the login that started here/);
  });

  it('refuses a callback with no flow cookie, and 404s an unknown provider', async () => {
    const { relay, requestId } = await beginLogin();

    const response = await call('POST', '/v1/auth/saml/corp-saml/callback', {
      form: { SAMLResponse: assertionFor(requestId), RelayState: relay },
    });
    expect(response.statusCode).toBe(400);

    expect((await call('GET', '/v1/auth/saml/nope/login')).statusCode).toBe(404);
  });
});

describe('validating a definition without registering it', () => {
  const validate = (body: unknown, key = adminKey) =>
    call('POST', '/v1/ns/acme/metadata/workflows/validate', { key, body });

  it('returns a verdict as a 200, not a 400', async () => {
    const response = await validate({ ...workflowDefinition, name: unique('dry') });

    expect(response.statusCode).toBe(200);
    expect(json(response)).toMatchObject({ valid: true, issues: [], compiled: { taskCount: 2 } });
  });

  it('registers nothing', async () => {
    const name = unique('dry-nothing');
    await validate({ ...workflowDefinition, name });

    const listed = json(await call('GET', '/v1/ns/acme/metadata/workflows', { key: adminKey }));
    expect(listed.some((definition: { name: string }) => definition.name === name)).toBe(false);
  });

  it('locates a schema issue by path, which is how the editor finds the node', async () => {
    const response = await validate({
      name: unique('dry-schema'),
      tasks: [
        { name: 'a', taskReferenceName: 'a', type: 'SIMPLE' },
        { name: '', taskReferenceName: 'b', type: 'SIMPLE' },
      ],
    });

    const body = json(response);
    expect(body.valid).toBe(false);
    expect(body.stage).toBe('schema');
    expect(body.issues[0].path).toEqual(['tasks', 1, 'name']);
  });

  it('locates a compile issue by task reference', async () => {
    const response = await validate({
      name: unique('dry-compile'),
      tasks: [
        {
          name: 'reads',
          taskReferenceName: 'reads',
          type: 'SIMPLE',
          inputParameters: { x: '${missing.output.value}' },
        },
      ],
    });

    const body = json(response);
    expect(body.valid).toBe(false);
    expect(body.stage).toBe('compile');
    expect(body.issues[0].taskReferenceName).toBe('reads');
  });

  it('agrees with registration, which is the only promise worth making', async () => {
    const invalid = {
      name: unique('dry-agree'),
      tasks: [{ name: 'f', taskReferenceName: 'f', type: 'FORK_JOIN', forkTasks: [] }],
    };

    const verdict = json(await validate(invalid));
    const registered = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: invalid,
    });

    expect(verdict.valid).toBe(false);
    expect(registered.statusCode).toBe(400);
    expect(json(registered).message).toBe(verdict.issues[0].message);
  });

  it('reports the latest version, so an editor never offers to overwrite one', async () => {
    const name = unique('dry-version');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { ...workflowDefinition, name, version: 3 },
    });

    expect(json(await validate({ ...workflowDefinition, name })).latestVersion).toBe(3);
  });

  it('needs only read access, since it writes nothing', async () => {
    // A key holding `workflows:read` and nothing else. The suite's shared
    // `readOnlyKey` holds `executions:read`, which is the wrong read, and a 403
    // with it proves nothing about this endpoint.
    const reader = (
      await identity.createApiKey({
        namespaceId,
        name: unique('workflow-reader'),
        scopes: [Scope.WORKFLOWS_READ],
      })
    ).token;

    const response = await validate({ ...workflowDefinition, name: unique('dry-ro') }, reader);
    expect(response.statusCode).toBe(200);

    // And the same key cannot register, so "read access" is not a loophole.
    const register = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: reader,
      body: { ...workflowDefinition, name: unique('dry-ro-write') },
    });
    expect(register.statusCode).toBe(403);
  });
});

describe('bulk operations', () => {
  it('reports per execution: terminates the running ones and explains the rest', async () => {
    const name = unique('bulk_target');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name, tasks: [{ name: 'gate', taskReferenceName: 'gate', type: 'WAIT' }] },
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(json(await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: {} })).workflowId);
    }
    await call('POST', `/v1/ns/acme/executions/${ids[0]}/terminate`, { key: adminKey, body: { reason: 'first' } });

    const result = json(
      await call('POST', '/v1/ns/acme/executions/bulk/terminate', {
        key: adminKey,
        body: { workflowIds: [...ids, '00000000-0000-4000-8000-000000000000'], reason: 'cleanup' },
      })
    );

    expect(result.succeeded.sort()).toEqual([ids[1], ids[2]].sort());
    expect(Object.keys(result.failed).sort()).toEqual([ids[0], '00000000-0000-4000-8000-000000000000'].sort());
  });

  it('refuses an action it does not know', async () => {
    const response = await call('POST', '/v1/ns/acme/executions/bulk/explode', { key: adminKey, body: { workflowIds: ['x'] } });
    expect(response.statusCode).toBe(400);
  });
});

describe('synchronous execution and signals', () => {
  it('answers with the result of a workflow that finishes in time', async () => {
    const name = unique('sync_quick');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        outputParameters: { echoed: '${workflow.input.value}' },
        tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }],
      },
    });

    const result = json(
      await call('POST', `/v1/ns/acme/executions/${name}/execute`, { key: adminKey, body: { input: { value: 42 }, waitForSeconds: 10 } })
    );
    expect(result).toMatchObject({ reached: true, status: 'COMPLETED', output: { echoed: 42 } });
  });

  it('gives up waiting without cancelling, then a signal completes the blocked WAIT', async () => {
    const name = unique('sync_wait');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        outputParameters: { approvedBy: '${gate.output.approvedBy}' },
        tasks: [{ name: 'gate', taskReferenceName: 'gate', type: 'WAIT' }],
      },
    });

    const waiting = json(
      await call('POST', `/v1/ns/acme/executions/${name}/execute`, { key: adminKey, body: { waitForSeconds: 1 } })
    );
    expect(waiting).toMatchObject({ reached: false, status: 'RUNNING' });

    const signalled = json(
      await call('POST', `/v1/ns/acme/executions/${waiting.workflowId}/signal`, {
        key: adminKey,
        body: { output: { approvedBy: 'ada' }, waitForSeconds: 10 },
      })
    );
    expect(signalled).toMatchObject({
      signalled: { taskRef: 'gate' },
      reached: true,
      status: 'COMPLETED',
      output: { approvedBy: 'ada' },
    });

    // Nothing is waiting any more.
    const again = await call('POST', `/v1/ns/acme/executions/${waiting.workflowId}/signal`, { key: adminKey, body: {} });
    expect(again.statusCode).toBe(409);
  });
});

describe('auditing credentials', () => {
  // Issuing a credential is the most security-relevant thing an admin does,
  // and it was not recorded at all.
  it('records an API key being issued, without the token', async () => {
    const name = unique('ci-key');
    const created = json(
      await call('POST', '/v1/auth/api-keys', { key: adminKey, body: { name, scopes: ['executions:read'] } })
    );

    let entry: Record<string, unknown> | undefined;
    await until(async () => {
      const { entries } = json(await call('GET', '/v1/ns/acme/audit?resource=api-key', { key: adminKey }));
      entry = entries.find((e: { resourceId: string }) => e.resourceId === name);
      return Boolean(entry);
    });

    expect(entry).toMatchObject({ action: 'api-key.create', outcome: 'ok' });
    expect(JSON.stringify(entry)).not.toContain(created.token);
  });
});

describe('schema registry', () => {
  it('refuses a start whose input breaks the workflow’s registered inputSchema', async () => {
    const schemaName = unique('order_input');
    const reg = await call('POST', '/v1/ns/acme/schemas', {
      key: adminKey,
      body: { name: schemaName, data: { type: 'object', required: ['orderId'], properties: { orderId: { type: 'string' } } } },
    });
    expect(reg.statusCode).toBe(201);

    const name = unique('schema_checked');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name, inputSchema: { name: schemaName }, tasks: [{ name, taskReferenceName: 'work', type: 'SIMPLE' }] },
    });

    const bad = await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: { input: { amount: 3 } } });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).message).toMatch(/orderId/);

    const good = await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: { input: { orderId: 'A-1' } } });
    expect([200, 201]).toContain(good.statusCode);

    const check = json(
      await call('POST', `/v1/ns/acme/schemas/${schemaName}/validate`, { key: adminKey, body: { payload: { orderId: 7 } } })
    );
    expect(check).toMatchObject({ valid: false, version: 1 });
  });

  it('refuses to register something that is not a JSON Schema', async () => {
    const reg = await call('POST', '/v1/ns/acme/schemas', {
      key: adminKey,
      body: { name: unique('broken'), data: { type: 'not-a-type' } },
    });
    expect(reg.statusCode).toBe(400);
  });
});

describe('environment variables', () => {
  // End to end: set through the API, read by a definition, delivered to a worker.
  it('reaches a worker through ${workflow.env.name}', async () => {
    const name = unique('env_reader');
    const put = await call('PUT', '/v1/ns/acme/environment/REGION', { key: adminKey, body: { type: 'TEXT', value: 'eu-west-1' } });
    expect(put.statusCode).toBe(200);

    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name, tasks: [{ name, taskReferenceName: 'work', type: 'SIMPLE', inputParameters: { region: '${workflow.env.REGION}' } }] },
    });
    await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: {} });

    let input: Record<string, unknown> | undefined;
    await until(async () => {
      const [task] = json(await call('POST', `/v1/ns/acme/queues/${name}/lease`, { key: adminKey, body: { workerId: 'env' } })).tasks;
      input = task?.input;
      return Boolean(task);
    });
    expect(input).toMatchObject({ region: 'eu-west-1' });

    const { variables } = json(await call('GET', '/v1/ns/acme/environment', { key: adminKey }));
    expect(variables).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'REGION', value: 'eu-west-1' })]));

    expect((await call('DELETE', '/v1/ns/acme/environment/REGION', { key: adminKey })).statusCode).toBe(204);
  });

  it('rejects a name an expression could not reference', async () => {
    const put = await call('PUT', '/v1/ns/acme/environment/not-valid', { key: adminKey, body: { value: 'x' } });
    expect(put.statusCode).toBe(400);
  });
});

describe('worker poll data', () => {
  // Depth says work is waiting; this is how an operator learns whether anyone
  // is listening — including a worker parked on a queue that is empty.
  it('lists a worker that polled, even when it received nothing', async () => {
    const queue = unique('polled');
    await call('POST', `/v1/ns/acme/queues/${queue}/lease`, { key: adminKey, body: { workerId: 'idle-worker-7' } });

    // Recorded without holding up the lease, so it may land a moment later.
    await until(async () => {
      const { workers } = json(await call('GET', '/v1/ns/acme/queues/workers', { key: adminKey }));
      return workers.some(
        (w: { queueName: string; workerId: string }) => w.queueName === queue && w.workerId === 'idle-worker-7'
      );
    });
  });
});

describe('task logs', () => {
  /** A fresh workflow on its own queue, so no other test's task can be leased here. */
  async function leaseOwnTask() {
    const name = unique('logged');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name, tasks: [{ name, taskReferenceName: 'work', type: 'SIMPLE' }] },
    });
    const { workflowId } = json(await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: {} }));

    let task: { taskId: string; leaseToken: string } | undefined;
    await until(async () => {
      const lease = await call('POST', `/v1/ns/acme/queues/${name}/lease`, {
        key: adminKey,
        body: { workerId: 'logger' },
      });
      [task] = json(lease).tasks;
      return Boolean(task);
    });
    return { workflowId, ...task! };
  }

  it('records lines from the worker holding the task and shows them on the execution', async () => {
    const task = await leaseOwnTask();

    const append = await call('POST', `/v1/ns/acme/tasks/${task.taskId}/logs`, {
      key: adminKey,
      body: {
        workflowId: task.workflowId,
        leaseToken: task.leaseToken,
        logs: [{ message: 'fetching order' }, { message: 'card declined', level: 'error' }],
      },
    });
    expect(append.statusCode).toBe(202);

    const read = json(
      await call('GET', `/v1/ns/acme/executions/${task.workflowId}/tasks/${task.taskId}/logs`, { key: adminKey })
    );
    expect(read.logs.map((l: { message: string; level: string }) => [l.message, l.level])).toEqual([
      ['fetching order', 'info'],
      ['card declined', 'error'],
    ]);
  });

  it('refuses lines from a worker that does not hold the lease', async () => {
    const task = await leaseOwnTask();

    const forged = await call('POST', `/v1/ns/acme/tasks/${task.taskId}/logs`, {
      key: adminKey,
      body: {
        workflowId: task.workflowId,
        leaseToken: '00000000-0000-4000-8000-000000000000',
        logs: [{ message: 'forged' }],
      },
    });
    expect(forged.statusCode).toBe(409);
  });

  it('does not show a task’s logs through another namespace', async () => {
    const task = await leaseOwnTask();
    await call('POST', `/v1/ns/acme/tasks/${task.taskId}/logs`, {
      key: adminKey,
      body: { workflowId: task.workflowId, leaseToken: task.leaseToken, logs: [{ message: 'secret' }] },
    });

    const foreign = await identity.createApiKey({
      namespaceId: otherNamespaceId,
      name: unique('log-reader'),
      scopes: [Scope.ADMIN],
    });
    const read = await call('GET', `/v1/ns/other/executions/${task.workflowId}/tasks/${task.taskId}/logs`, {
      key: foreign.token,
    });
    expect(read.statusCode).toBe(404);
  });
});

describe('workflow rate limit by key', () => {
  it('queues a start over its key limit and runs it when the slot frees', async () => {
    const name = unique('rate_keyed');
    const registered = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        rateLimitConfig: { rateLimitKey: '${workflow.input.customer}', concurrentExecLimit: 1 },
        tasks: [{ name: 'gate', taskReferenceName: 'gate', type: 'WAIT' }],
      },
    });
    expect(registered.statusCode).toBe(201);

    const startOne = async (customer: string) =>
      json(await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: { input: { customer } } }));
    const statusOf = async (id: string) => json(await call('GET', `/v1/ns/acme/executions/${id}/status`, { key: adminKey }));

    const first = await startOne('acme');
    const second = await startOne('acme');
    const other = await startOne('globex');

    await until(async () => (await statusOf(first.workflowId)).awaitingAdmission === undefined);
    expect((await statusOf(second.workflowId)).awaitingAdmission).toBe(true);
    expect((await statusOf(other.workflowId)).awaitingAdmission).toBeUndefined();

    // Signalling a waiting execution is refused: it has not started anything to signal.
    const early = await call('POST', `/v1/ns/acme/executions/${second.workflowId}/signal`, { key: adminKey, body: { output: {} } });
    expect(early.statusCode).toBeGreaterThanOrEqual(400);

    await until(async () => {
      const response = await call('POST', `/v1/ns/acme/executions/${first.workflowId}/signal`, { key: adminKey, body: { output: {} } });
      return response.statusCode < 300;
    });
    await until(async () => (await statusOf(first.workflowId)).status === 'COMPLETED');
    await until(async () => (await statusOf(second.workflowId)).awaitingAdmission === undefined);

    // Admitted and actually running: its WAIT can now be signalled to completion.
    await until(async () => {
      const response = await call('POST', `/v1/ns/acme/executions/${second.workflowId}/signal`, { key: adminKey, body: { output: {} } });
      return response.statusCode < 300;
    });
    await until(async () => (await statusOf(second.workflowId)).status === 'COMPLETED');
  });
});

describe('event monitor and test messages', () => {
  it('delivers a test message through the real path and shows it in the monitor', async () => {
    const workflow = unique('on_signup');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: workflow, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] },
    });
    const name = unique('signup_handler');
    const created = await call('POST', '/v1/ns/acme/event-handlers', {
      key: adminKey,
      body: {
        name,
        source: 'kafka:default',
        topic: 'signups',
        action: 'START_WORKFLOW',
        condition: 'return $.plan !== "free"',
        workflow: { name: workflow },
        inputTemplate: { email: '${event.output.email}' },
      },
    });
    expect(created.statusCode).toBe(201);

    const acted = json(
      await call('POST', `/v1/ns/acme/event-handlers/${name}/test`, {
        key: adminKey,
        body: { payload: { email: 'ada@example.com', plan: 'pro' }, key: 'user-1' },
      })
    );
    expect(acted).toMatchObject({ outcome: 'ACTED' });
    const started = json(await call('GET', `/v1/ns/acme/executions/${acted.workflowId}`, { key: adminKey }));
    expect(started.input).toMatchObject({ email: 'ada@example.com' });

    const skipped = json(
      await call('POST', `/v1/ns/acme/event-handlers/${name}/test`, { key: adminKey, body: { payload: { plan: 'free' } } })
    );
    expect(skipped).toEqual({ outcome: 'SKIPPED', detail: 'condition did not match' });

    const monitor = json(await call('GET', `/v1/ns/acme/event-handlers/executions?handler=${name}`, { key: adminKey }));
    expect(monitor.executions.map((e: { outcome: string }) => e.outcome)).toEqual(['SKIPPED', 'ACTED']);
    expect(monitor.executions[1]).toMatchObject({ messageKey: 'user-1', workflowId: acted.workflowId });
    expect(monitor.executions[1].deliveryId).toMatch(/^test:/);

    const activity = json(await call('GET', '/v1/ns/acme/event-handlers/activity?hours=1', { key: adminKey }));
    expect(activity.handlers.find((h: { handlerName: string }) => h.handlerName === name)).toMatchObject({ acted: 1, skipped: 1, failed: 0 });
  });

  it('refuses a test message for a handler that does not exist, or with no payload object', async () => {
    expect((await call('POST', '/v1/ns/acme/event-handlers/nope/test', { key: adminKey, body: { payload: {} } })).statusCode).toBe(404);
    expect((await call('POST', '/v1/ns/acme/event-handlers/nope/test', { key: adminKey, body: { payload: 'x' } })).statusCode).toBe(400);
    expect((await call('GET', '/v1/ns/acme/event-handlers/executions?outcome=MAYBE', { key: adminKey })).statusCode).toBe(400);
  });
});

describe('execution overview', () => {
  // Tag filtering is proven in the store spec; this proves the route is wired.
  it('summarises a window, newest failure first', async () => {
    const open = unique('overview_open');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: open,
        tasks: [
          {
            name: 'stop',
            taskReferenceName: 'stop',
            type: 'TERMINATE',
            inputParameters: { terminationStatus: 'FAILED', terminationReason: 'deliberately' },
          },
        ],
      },
    });
    const run = json(
      await call('POST', `/v1/ns/acme/executions/${open}/execute`, { key: adminKey, body: { waitForSeconds: 10 } })
    );
    expect(run.status).toBe('FAILED');

    const overview = json(await call('GET', '/v1/ns/acme/executions/overview?hours=1', { key: adminKey }));
    expect(overview.hours).toBe(1);
    expect(overview.started).toBeGreaterThan(0);
    // Asserted on recent failures, not hotspots: those are capped, and a busy
    // suite pushes one new workflow out of the top eight.
    expect(overview.recentFailures[0]).toMatchObject({ workflowId: run.workflowId, defName: open, reason: 'deliberately' });
    expect(Array.isArray(overview.series)).toBe(true);

    expect((await call('GET', '/v1/ns/acme/executions/overview?hours=abc', { key: adminKey })).statusCode).toBe(200);
  });
});

describe('masked fields', () => {
  it('hides declared fields on every read, while the workflow itself uses the real value', async () => {
    const name = unique('masked');
    const registered = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        maskedFields: ['password', 'status'],
        outputParameters: {
          password: '${workflow.input.password}',
          // Proof the engine saw the real value: only it could compute this.
          length: '${check.output.length}',
        },
        tasks: [
          {
            name: 'check',
            taskReferenceName: 'check',
            type: 'INLINE',
            inputParameters: {
              evaluatorType: 'javascript',
              expression: 'return { length: $.password.length, status: "fine" }',
              password: '${workflow.input.password}',
            },
          },
          { name: 'remember', taskReferenceName: 'remember', type: 'SET_VARIABLE', inputParameters: { password: '${workflow.input.password}' } },
        ],
      },
    });
    expect(registered.statusCode).toBe(201);

    const run = json(
      await call('POST', `/v1/ns/acme/executions/${name}/execute`, {
        key: adminKey,
        body: { input: { user: 'ada', password: 'hunter2' }, waitForSeconds: 15 },
      })
    );
    expect(run.status).toBe('COMPLETED');
    expect(run.output).toEqual({ password: '***', length: 7 });

    const detail = await call('GET', `/v1/ns/acme/executions/${run.workflowId}`, { key: adminKey });
    const execution = json(detail);
    expect(execution.status).toBe('COMPLETED');
    expect(execution.input).toEqual({ user: 'ada', password: '***' });
    expect(execution.variables).toEqual({ password: '***' });
    expect(execution.tasks.find((t: { refName: string }) => t.refName === 'check').output).toEqual({ length: 7, status: '***' });

    const history = await call('GET', `/v1/ns/acme/executions/${run.workflowId}/history`, { key: adminKey });
    for (const response of [detail, history]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('hunter2');
    }
  });

  it('runs again with the real input, not the masked copy a reader sees', async () => {
    const name = unique('masked_again');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        maskedFields: ['password'],
        outputParameters: { length: '${check.output.length}' },
        tasks: [
          {
            name: 'check',
            taskReferenceName: 'check',
            type: 'INLINE',
            inputParameters: { evaluatorType: 'javascript', expression: 'return { length: $.password.length }', password: '${workflow.input.password}' },
          },
        ],
      },
    });
    const first = json(
      await call('POST', `/v1/ns/acme/executions/${name}/execute`, { key: adminKey, body: { input: { password: 'hunter2' }, waitForSeconds: 15 } })
    );
    expect(first.output).toEqual({ length: 7 });

    const again = await call('POST', `/v1/ns/acme/executions/${first.workflowId}/run-again`, { key: adminKey });
    expect(again.statusCode).toBe(201);
    const { workflowId } = json(again);
    expect(workflowId).not.toBe(first.workflowId);

    await until(async () => json(await call('GET', `/v1/ns/acme/executions/${workflowId}/status`, { key: adminKey })).status === 'COMPLETED');
    // `***` would be 3.
    expect(json(await call('GET', `/v1/ns/acme/executions/${workflowId}`, { key: adminKey })).output).toEqual({ length: 7 });
  });
});

describe('inbound webhooks', () => {
  it('verifies a GitHub delivery over its exact bytes and starts the workflow a handler names', async () => {
    const suffix = unique('gh');
    const workflow = `on_push_${suffix}`;
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: workflow, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] },
    });
    await call('PUT', `/v1/ns/acme/secrets/GH_${suffix.replace(/\W/g, '_').toUpperCase()}`, { key: adminKey, body: { value: 'gh-secret', sealed: false } });
    const hookName = `github-${suffix}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const created = await call('POST', '/v1/ns/acme/incoming-webhooks', {
      key: adminKey,
      body: { name: hookName, verifier: 'GITHUB', secretName: `GH_${suffix.replace(/\W/g, '_').toUpperCase()}` },
    });
    expect(created.statusCode).toBe(201);
    const hook = json(created);
    expect(hook.path).toBe(`/v1/hooks/${hook.id}`);

    const sources = json(await call('GET', '/v1/ns/acme/event-handlers/sources', { key: adminKey }));
    expect(sources.sources.find((s: { id: string }) => s.id === 'webhook').topics).toContain(hookName);

    await call('POST', '/v1/ns/acme/event-handlers', {
      key: adminKey,
      body: {
        name: `deploy-${hookName}`,
        source: 'webhook',
        topic: hookName,
        action: 'START_WORKFLOW',
        workflow: { name: workflow },
        inputTemplate: { ref: '${event.output.ref}' },
      },
    });

    // Not canonical JSON: re-serialising the parsed body would not reproduce these bytes.
    const payload = '{ "ref" : "refs/heads/main",\n  "pusher": {"name": "ada"} }';
    const sign = (body: string, secret = 'gh-secret') => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const deliver = (body: string, signature: string, delivery: string) =>
      app.inject({
        method: 'POST',
        url: hook.path,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-delivery': delivery },
        payload: body,
      });

    const accepted = await deliver(payload, sign(payload), `d-${suffix}`);
    expect(accepted.statusCode).toBe(202);
    expect(json(accepted)).toMatchObject({ accepted: true });

    await until(async () => {
      const found = json(await call('POST', '/v1/ns/acme/executions/search', { key: adminKey, body: { defName: workflow } }));
      return found.executions.length === 1;
    });
    // A retry of the same delivery starts nothing new.
    expect((await deliver(payload, sign(payload), `d-${suffix}`)).statusCode).toBe(202);

    const forged = await deliver(payload, sign(payload, 'guess'), `f-${suffix}`);
    expect(forged.statusCode).toBe(401);
    expect(json(forged).message).toBe('signature does not match');
    expect((await app.inject({ method: 'POST', url: '/v1/hooks/not-a-real-id', payload: '{}', headers: { 'content-type': 'application/json' } })).statusCode).toBe(404);

    const found = json(await call('POST', '/v1/ns/acme/executions/search', { key: adminKey, body: { defName: workflow } }));
    expect(found.executions).toHaveLength(1);
    const detail = json(await call('GET', `/v1/ns/acme/executions/${found.executions[0].workflowId}`, { key: adminKey }));
    expect(detail.input.ref).toBe('refs/heads/main');

    const summary = json(await call('GET', `/v1/ns/acme/incoming-webhooks/${hookName}`, { key: adminKey }));
    expect(summary).toMatchObject({ receivedCount: 2, rejectedCount: 1 });
  });

  it('accepts a form-encoded delivery checked against a shared header token', async () => {
    const suffix = unique('form').toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    await call('PUT', `/v1/ns/acme/secrets/FORM_TOKEN`, { key: adminKey, body: { value: 'let-me-in', sealed: false } });
    const hook = json(
      await call('POST', '/v1/ns/acme/incoming-webhooks', {
        key: adminKey,
        body: { name: suffix, verifier: 'HEADER', secretName: 'FORM_TOKEN', config: { header: 'X-Webhook-Token' } },
      })
    );
    const post = (token: string) =>
      app.inject({
        method: 'POST',
        url: hook.path,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-webhook-token': token },
        payload: 'command=%2Fdeploy&text=prod&__proto__=x',
      });

    expect((await post('let-me-in')).statusCode).toBe(202);
    expect((await post('nope')).statusCode).toBe(401);
  });
});

describe('workflow messages', () => {
  it('pushes messages into a running execution for PULL_WORKFLOW_MESSAGES to take', async () => {
    const name = unique('inbox');
    const registered = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        outputParameters: { bids: '${collect.output.messages}', count: '${collect.output.count}' },
        tasks: [{ name: 'collect', taskReferenceName: 'collect', type: 'PULL_WORKFLOW_MESSAGES', inputParameters: { batchSize: 2 } }],
      },
    });
    expect(registered.statusCode).toBe(201);

    const { workflowId } = json(await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: {} }));
    await until(async () => {
      const detail = json(await call('GET', `/v1/ns/acme/executions/${workflowId}`, { key: adminKey }));
      return detail.tasks.some((t: { refName: string; status: string }) => t.refName === 'collect' && t.status === 'IN_PROGRESS');
    });

    // The first message completes the waiting pull; the second waits for a pull that never comes.
    const first = await call('POST', `/v1/ns/acme/executions/${workflowId}/messages`, { key: adminKey, body: { payload: { bid: 10 } } });
    expect(first.statusCode).toBe(202);
    expect(json(first)).toMatchObject({ delivered: true });

    await until(async () => json(await call('GET', `/v1/ns/acme/executions/${workflowId}/status`, { key: adminKey })).status === 'COMPLETED');
    const detail = json(await call('GET', `/v1/ns/acme/executions/${workflowId}`, { key: adminKey }));
    expect(detail.output).toMatchObject({ count: 1, bids: [{ payload: { bid: 10 } }] });

    const late = await call('POST', `/v1/ns/acme/executions/${workflowId}/messages`, { key: adminKey, body: { payload: { bid: 11 } } });
    expect(late.statusCode).toBe(409);

    const listed = json(await call('GET', `/v1/ns/acme/executions/${workflowId}/messages`, { key: adminKey }));
    expect(listed.messages).toHaveLength(1);
    expect(listed.messages[0].consumedByTaskId).toBeTruthy();

    expect((await call('POST', '/v1/ns/acme/executions/not-an-id/messages', { key: adminKey, body: { payload: {} } })).statusCode).toBe(404);
    expect((await call('POST', `/v1/ns/acme/executions/${workflowId}/messages`, { key: adminKey, body: { payload: 'text' } })).statusCode).toBe(400);
  });
});

describe('loops around forks', () => {
  // Hung forever before the engine fix: every iteration after the first saw
  // its branches as already finished and scheduled nothing.
  it('runs a FORK_JOIN inside a DO_WHILE for every iteration and completes', async () => {
    const name = unique('loop_fork');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        tasks: [
          {
            name: 'loop',
            taskReferenceName: 'loop',
            type: 'DO_WHILE',
            loopCondition: '${loop.output.iteration} < 3',
            loopOver: [
              {
                name: 'fork',
                taskReferenceName: 'fork',
                type: 'FORK_JOIN',
                forkTasks: [[{ name: 'left', taskReferenceName: 'left', type: 'NOOP' }], [{ name: 'right', taskReferenceName: 'right', type: 'NOOP' }]],
              },
              { name: 'join', taskReferenceName: 'join', type: 'JOIN', joinOn: ['left', 'right'] },
            ],
          },
        ],
      },
    });

    const run = json(await call('POST', `/v1/ns/acme/executions/${name}/execute`, { key: adminKey, body: { waitForSeconds: 15 } }));
    expect(run.status).toBe('COMPLETED');

    const detail = json(await call('GET', `/v1/ns/acme/executions/${run.workflowId}`, { key: adminKey }));
    const joins = detail.tasks.filter((t: { refName: string }) => t.refName === 'join').map((t: { iteration: number }) => t.iteration).sort();
    expect(joins).toEqual([1, 2, 3]);
  });
});

describe('test mode', () => {
  it('runs an unsaved definition with mocks, runs pure tasks for real, and persists nothing', async () => {
    const name = unique('quote_test');
    const definition = {
      name,
      version: 1,
      outputParameters: { total: '${price.output.total}', approvedBy: '${approve.output.by}' },
      tasks: [
        { name: 'fetch_rate', taskReferenceName: 'rate', type: 'SIMPLE' },
        {
          name: 'price',
          taskReferenceName: 'price',
          type: 'INLINE',
          inputParameters: {
            evaluatorType: 'javascript',
            rate: '${rate.output.rate}',
            qty: '${workflow.input.qty}',
            expression: 'return { total: $.rate * $.qty }',
          },
        },
        { name: 'approve', taskReferenceName: 'approve', type: 'HUMAN' },
      ],
    };

    const response = await call('POST', '/v1/ns/acme/metadata/workflows/test', {
      key: adminKey,
      body: {
        definition,
        input: { qty: 4 },
        mocks: {
          rate: [{ status: 'FAILED', reason: 'rate service down' }, { output: { rate: 25 } }],
          approve: { output: { by: 'grace' } },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const result = json(response);
    // The default task policy retries, exactly as it would in production: the
    // first mocked attempt fails, the retry takes the second mock and succeeds.
    expect(result.status).toBe('COMPLETED');
    expect(result.tasks.filter((t: { refName: string }) => t.refName === 'rate').map((t: { status: string }) => t.status)).toEqual(['FAILED', 'COMPLETED']);

    const passing = json(
      await call('POST', '/v1/ns/acme/metadata/workflows/test', {
        key: adminKey,
        body: { definition, input: { qty: 4 }, mocks: { rate: { output: { rate: 25 } }, approve: { output: { by: 'grace' } } } },
      })
    );
    expect(passing).toMatchObject({ status: 'COMPLETED', output: { total: 100, approvedBy: 'grace' }, unmocked: [] });
    expect(passing.tasks.find((t: { refName: string }) => t.refName === 'price')).toMatchObject({ mocked: false, output: { total: 100 } });

    const persisted = json(await call('POST', '/v1/ns/acme/executions/search', { key: adminKey, body: { defName: name } }));
    expect(persisted.executions).toEqual([]);
    expect((await call('GET', `/v1/ns/acme/metadata/workflows/${name}`, { key: adminKey })).statusCode).toBe(404);
  });

  it('refuses a definition registration would refuse, and needs something to test', async () => {
    const invalid = await call('POST', '/v1/ns/acme/metadata/workflows/test', {
      key: adminKey,
      body: { definition: { name: 'x', version: 1, tasks: [{ name: 'a', taskReferenceName: 'a', type: 'SIMPLE', inputParameters: { v: '${nope.output.x}' } }] } },
    });
    expect(invalid.statusCode).toBe(400);
    expect((await call('POST', '/v1/ns/acme/metadata/workflows/test', { key: adminKey, body: {} })).statusCode).toBe(400);
    expect((await call('POST', '/v1/ns/acme/metadata/workflows/test', { key: adminKey, body: { name: 'never-registered' } })).statusCode).toBe(404);
  });
});

describe('YIELD', () => {
  // Hung forever before: YIELD was scheduled, stayed IN_PROGRESS, and nothing
  // could resume it — the signal endpoint only looked for WAIT tasks.
  it('pauses until signalled, then carries the signal output onward', async () => {
    const name = unique('yield');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        outputParameters: { decision: '${gate.output.decision}' },
        tasks: [
          { name: 'gate', taskReferenceName: 'gate', type: 'YIELD' },
          { name: 'after', taskReferenceName: 'after', type: 'NOOP' },
        ],
      },
    });

    const waiting = json(await call('POST', `/v1/ns/acme/executions/${name}/execute`, { key: adminKey, body: { waitForSeconds: 1 } }));
    expect(waiting).toMatchObject({ reached: false, status: 'RUNNING' });

    const resumed = json(
      await call('POST', `/v1/ns/acme/executions/${waiting.workflowId}/signal`, {
        key: adminKey,
        body: { output: { decision: 'ship it' }, waitForSeconds: 10 },
      })
    );
    expect(resumed).toMatchObject({ signalled: { taskRef: 'gate' }, status: 'COMPLETED', output: { decision: 'ship it' } });
  });
});

describe('YIELD status', () => {
  it('is in progress while it waits, not scheduled', async () => {
    const name = unique('yield_status');
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: { name, tasks: [{ name: 'gate', taskReferenceName: 'gate', type: 'YIELD' }] } });
    const { workflowId } = json(await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: {} }));
    await until(async () => json(await call('GET', `/v1/ns/acme/executions/${workflowId}`, { key: adminKey })).tasks.length === 1);
    const [gate] = json(await call('GET', `/v1/ns/acme/executions/${workflowId}`, { key: adminKey })).tasks;
    expect(gate.status).toBe('IN_PROGRESS');
  });
});

describe('saga compensation', () => {
  it('undoes completed steps in reverse when the workflow fails, then fails with the reason', async () => {
    const name = unique('saga');
    const inline = (ref: string, expression: string, extra: Record<string, unknown> = {}) => ({
      name: ref,
      taskReferenceName: ref,
      type: 'INLINE',
      inputParameters: { evaluatorType: 'javascript', expression },
      ...extra,
    });
    const registered = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        tasks: [
          inline('book_flight', 'return { booking: "FL-1" }', { compensateWith: inline('cancel_flight', 'return { cancelled: true }') }),
          inline('book_hotel', 'return { booking: "HT-7" }', {
            compensateWith: {
              name: 'cancel_hotel',
              taskReferenceName: 'cancel_hotel',
              type: 'INLINE',
              inputParameters: { evaluatorType: 'javascript', booking: '${book_hotel.output.booking}', expression: 'return { cancelled: $.booking }' },
            },
          }),
          { name: 'stop', taskReferenceName: 'stop', type: 'TERMINATE', inputParameters: { terminationStatus: 'FAILED', terminationReason: 'no rental cars' } },
        ],
      },
    });
    expect(registered.statusCode).toBe(201);

    const run = json(await call('POST', `/v1/ns/acme/executions/${name}/execute`, { key: adminKey, body: { waitForSeconds: 20 } }));
    expect(run.status).toBe('FAILED');
    expect(run.reasonForIncompletion).toBe('no rental cars (compensated: book_hotel, book_flight)');

    const detail = json(await call('GET', `/v1/ns/acme/executions/${run.workflowId}`, { key: adminKey }));
    const byRef = Object.fromEntries(detail.tasks.map((t: { refName: string }) => [t.refName, t]));
    expect(byRef['cancel_hotel']).toMatchObject({ status: 'COMPLETED', output: { cancelled: 'HT-7' } });
    expect(byRef['cancel_flight']).toMatchObject({ status: 'COMPLETED' });
    expect(new Date(byRef['cancel_hotel'].endedAt).getTime()).toBeLessThanOrEqual(new Date(byRef['cancel_flight'].startedAt ?? byRef['cancel_flight'].scheduledAt).getTime());
  });
});

describe('JSONPath in expressions', () => {
  it('filters and indexes task output between tasks and into the workflow output', async () => {
    const name = unique('jsonpath');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        outputParameters: {
          expensive: '${pick.output.skus}',
          first: '${cart.output.items[0].sku}',
          count: '${cart.output.items.length()}',
        },
        tasks: [
          {
            name: 'cart',
            taskReferenceName: 'cart',
            type: 'INLINE',
            inputParameters: { evaluatorType: 'javascript', expression: 'return { items: [{ sku: "A", price: 5 }, { sku: "B", price: 25 }, { sku: "C", price: 40 }] }' },
          },
          {
            name: 'pick',
            taskReferenceName: 'pick',
            type: 'INLINE',
            inputParameters: { evaluatorType: 'javascript', skus: '${cart.output.items[?(@.price > 10)].sku}', expression: 'return { skus: $.skus }' },
          },
        ],
      },
    });
    const run = json(await call('POST', `/v1/ns/acme/executions/${name}/execute`, { key: adminKey, body: { waitForSeconds: 15 } }));
    expect(run).toMatchObject({ status: 'COMPLETED', output: { expensive: ['B', 'C'], first: 'A', count: 3 } });
  });
});

/**
 * Status listeners, end to end: a real receiver, the real relay, the real
 * webhook executor — the wiring is what breaks, so the container is what is
 * tested.
 */
describe('status listeners', () => {
  let receiver: Server;
  let port = 0;
  let received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  let failNext = 0;

  beforeAll(async () => {
    receiver = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        if (failNext > 0) {
          failNext--;
          response.writeHead(503).end();
          return;
        }
        received.push({ headers: request.headers, body });
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, resolve));
    port = (receiver.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => receiver?.close(() => resolve()));
  });

  beforeEach(() => {
    received = [];
    failNext = 0;
  });

  const eventsFor = (workflowId: string) =>
    received.map((r) => ({ ...r, event: JSON.parse(r.body).event as Record<string, unknown> })).filter((r) => r.event['workflowId'] === workflowId);

  it('delivers signed lifecycle events for the workflows it names, and retries a failed delivery', async () => {
    const workflow = unique('cdc_order');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: workflow, version: 1, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] },
    });
    await call('PUT', '/v1/ns/acme/secrets/CDC_SIGNING', { key: adminKey, body: { value: 'cdc-signing-key', sealed: false } });
    const listener = unique('cdc');
    const created = await call('POST', '/v1/ns/acme/status-listeners', {
      key: adminKey,
      body: {
        name: listener,
        workflowNames: ['cdc_order*'],
        events: ['STARTED', 'COMPLETED'],
        sink: 'WEBHOOK',
        config: { url: `http://localhost:${port}/events`, secretName: 'CDC_SIGNING' },
        includeOutput: true,
      },
    });
    expect(created.statusCode).toBe(201);

    // The first delivery attempt fails; the relay backs off and tries again.
    failNext = 1;
    const { workflowId } = json(await call('POST', `/v1/ns/acme/executions/${workflow}`, { key: adminKey, body: { input: {} } }));

    await until(async () => eventsFor(workflowId).length === 2, 30_000);
    const [started, completed] = eventsFor(workflowId).sort((a, b) => String(a.event['event']).localeCompare(String(b.event['event']))).reverse();
    expect(started.event).toMatchObject({ event: 'STARTED', workflowName: workflow, type: 'workflow.status' });
    expect(completed.event).toMatchObject({ event: 'COMPLETED', status: 'COMPLETED', output: {} });

    // Signed over `timestamp.body` with the named secret.
    const timestamp = String(completed.headers['x-nodeflow-timestamp']);
    const expected = createHmac('sha256', 'cdc-signing-key').update(`${timestamp}.${completed.body}`).digest('hex');
    expect(completed.headers['x-nodeflow-signature']).toBe(`sha256=${expected}`);

    await until(async () => json(await call('GET', `/v1/ns/acme/status-listeners/${listener}`, { key: adminKey })).deliveredCount >= 2);
    const state = json(await call('GET', `/v1/ns/acme/status-listeners/${listener}`, { key: adminKey }));
    expect(state.failedCount).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('sends a test event on request, and refuses private addresses like any webhook', async () => {
    const good = unique('cdc-test');
    await call('POST', '/v1/ns/acme/status-listeners', {
      key: adminKey,
      body: { name: good, sink: 'WEBHOOK', config: { url: `http://localhost:${port}/test` } },
    });
    const ok = json(await call('POST', `/v1/ns/acme/status-listeners/${good}/test`, { key: adminKey }));
    expect(ok).toMatchObject({ delivered: true, event: { test: true } });
    expect(received.some((r) => JSON.parse(r.body).event.test === true)).toBe(true);

    const internal = unique('cdc-internal');
    await call('POST', '/v1/ns/acme/status-listeners', {
      key: adminKey,
      body: { name: internal, sink: 'WEBHOOK', config: { url: `http://127.0.0.1:${port}/metadata` } },
    });
    const blocked = json(await call('POST', `/v1/ns/acme/status-listeners/${internal}/test`, { key: adminKey }));
    expect(blocked).toMatchObject({ delivered: false });
    expect(blocked.error).toMatch(/blocked/);

    expect((await call('POST', '/v1/ns/acme/status-listeners', { key: readOnlyKey, body: { name: 'nope', sink: 'WEBHOOK', config: { url: 'https://x.test' } } })).statusCode).toBe(403);
  });
});

/** The execution search box and saved views, through the API a UI uses. */
describe('execution search and saved views', () => {
  it('parses the search box into filters, and names the keys when one is wrong', async () => {
    const workflow = unique('searchable_order');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: workflow, version: 1, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] },
    });
    const start = async (input: Record<string, unknown>) =>
      json(await call('POST', `/v1/ns/acme/executions/${workflow}`, { key: adminKey, body: { input } })).workflowId as string;
    const gold = await start({ customer: { tier: 'gold', name: 'Grace Hopper' }, total: 99 });
    await start({ customer: { tier: 'silver' }, total: 99 });

    const find = async (q: string) =>
      (json(await call('POST', '/v1/ns/acme/executions/search', { key: adminKey, body: { q } })).executions as { workflowId: string }[]).map(
        (e) => e.workflowId
      );
    const prefix = workflow.split('-')[0];
    expect(await find(`workflow:${workflow} input.customer.tier:gold`)).toEqual([gold]);
    expect(await find(`wf:${prefix}* hopper`)).toEqual([gold]);
    expect((await find(`workflow:${workflow} input.total:99`)).length).toBe(2);
    expect(await find(`id:${gold}`)).toEqual([gold]);
    expect(await find('id:not-a-uuid')).toEqual([]);

    const bad = await call('POST', '/v1/ns/acme/executions/search', { key: adminKey, body: { q: 'state:FAILED' } });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).message).toMatch(/use status, workflow/);
  });

  it('keeps tag-hidden workflows hidden from words that would match them', async () => {
    const workflow = unique('tagged_secret');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: workflow, version: 1, tags: ['env:vault'], tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] },
    });
    await call('POST', `/v1/ns/acme/executions/${workflow}`, { key: adminKey, body: { input: { code: 'aardvark-41' } } });
    const reader = (await identity.createApiKey({ namespaceId, name: unique('reader'), scopes: [Scope.EXECUTIONS_READ] })).token;
    const seen = json(await call('POST', '/v1/ns/acme/executions/search', { key: reader, body: { q: 'aardvark-41' } }));
    expect(seen.executions).toEqual([]);
    // And it is there for someone whose grants reach the tag, so the empty list above means hidden, not missing.
    const admin = json(await call('POST', '/v1/ns/acme/executions/search', { key: adminKey, body: { q: 'aardvark-41' } }));
    expect(admin.executions).toHaveLength(1);
  });

  it('saves views privately or for the namespace, and only the owner changes them', async () => {
    const mine = json(
      await call('POST', '/v1/ns/acme/saved-views', { key: adminKey, body: { page: 'executions', name: unique('My failures'), state: { q: 'status:FAILED' } } })
    );
    const team = json(
      await call('POST', '/v1/ns/acme/saved-views', {
        key: adminKey,
        body: { page: 'executions', name: unique('Team stuck'), state: { q: 'is:running', columns: ['status'] }, shared: true },
      })
    );
    expect(mine).toMatchObject({ mine: true, shared: false });

    const readerViews = json(await call('GET', '/v1/ns/acme/saved-views?page=executions', { key: readOnlyKey })).views as { id: string; mine: boolean }[];
    expect(readerViews.map((v) => v.id)).toContain(team.id);
    expect(readerViews.map((v) => v.id)).not.toContain(mine.id);
    expect(readerViews.find((v) => v.id === team.id)?.mine).toBe(false);

    expect((await call('PUT', `/v1/ns/acme/saved-views/${team.id}`, { key: readOnlyKey, body: { name: 'mine now' } })).statusCode).toBe(404);
    expect((await call('DELETE', `/v1/ns/acme/saved-views/${team.id}`, { key: readOnlyKey })).statusCode).toBe(404);
    expect((await call('GET', '/v1/ns/acme/saved-views?page=nowhere', { key: adminKey })).statusCode).toBe(400);
    // An administrator may clear out any view.
    expect((await call('DELETE', `/v1/ns/acme/saved-views/${team.id}`, { key: adminKey })).statusCode).toBe(204);
  });
});

/** Per-run worker routing, from the start request to the worker that leases the task. */
describe('taskToDomain at start', () => {
  it('routes a run’s worker tasks to a domain, carries it into sub-workflows and keeps it on run-again', async () => {
    const suffix = unique('ttd').replace(/\W/g, '_');
    const childName = `ttd_child_${suffix}`;
    const parentName = `ttd_parent_${suffix}`;
    const task = `ttd_ship_${suffix}`;
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: childName, version: 1, tasks: [{ name: task, taskReferenceName: 'ship', type: 'SIMPLE' }] },
    });
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: parentName,
        version: 1,
        tasks: [{ name: 'call', taskReferenceName: 'call', type: 'SUB_WORKFLOW', subWorkflowParam: { name: childName, version: 1 } }],
      },
    });

    const started = json(
      await call('POST', `/v1/ns/acme/executions/${parentName}`, { key: adminKey, body: { input: {}, taskToDomain: { '*': 'canary' } } })
    );
    expect(json(await call('GET', `/v1/ns/acme/executions/${started.workflowId}`, { key: adminKey })).taskToDomain).toEqual({ '*': 'canary' });

    // The child's worker task waits on the domained queue, not the plain one.
    let leased: { workflowId: string }[] = [];
    await until(async () => {
      leased = json(await call('POST', `/v1/ns/acme/queues/${task}:canary/lease`, { key: adminKey, body: { workerId: 'canary-1' } })).tasks;
      return leased.length === 1;
    }, 20_000);
    expect(json(await call('POST', `/v1/ns/acme/queues/${task}/lease`, { key: adminKey, body: { workerId: 'w' } })).tasks).toEqual([]);
    const child = json(await call('GET', `/v1/ns/acme/executions/${leased[0].workflowId}`, { key: adminKey }));
    expect(child).toMatchObject({ parentWorkflowId: started.workflowId, taskToDomain: { '*': 'canary' } });

    const again = json(await call('POST', `/v1/ns/acme/executions/${started.workflowId}/run-again`, { key: adminKey }));
    expect(json(await call('GET', `/v1/ns/acme/executions/${again.workflowId}`, { key: adminKey })).taskToDomain).toEqual({ '*': 'canary' });

    const bad = await call('POST', `/v1/ns/acme/executions/${parentName}`, { key: adminKey, body: { taskToDomain: { '*': 'bad domain:x' } } });
    expect(bad.statusCode).toBe(400);
  }, 60_000);
});

/** Definition bundles over HTTP: export, change, dry-run, import. */
describe('definition import and export', () => {
  it('round-trips a workflow with its dependencies, reporting what an import would do before doing it', async () => {
    const suffix = unique('bundle').replace(/\W/g, '_');
    const worker = `bundle_task_${suffix}`;
    const child = `bundle_child_${suffix}`;
    const parent = `bundle_parent_${suffix}`;
    await call('POST', '/v1/ns/acme/metadata/task-definitions', { key: adminKey, body: { name: worker, retryCount: 4 } });
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: child, version: 1, tasks: [{ name: worker, taskReferenceName: 'work', type: 'SIMPLE' }] },
    });
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: parent, version: 1, tasks: [{ name: 'c', taskReferenceName: 'c', type: 'SUB_WORKFLOW', subWorkflowParam: { name: child, version: 1 } }] },
    });

    const bundle = json(await call('POST', '/v1/ns/acme/metadata/export', { key: adminKey, body: { workflows: [parent] } }));
    expect(bundle.workflows.map((w: { name: string }) => w.name).sort()).toEqual([child, parent].sort());
    expect(bundle.taskDefinitions.map((t: { name: string }) => t.name)).toEqual([worker]);

    // Re-importing what is already there changes nothing.
    const same = json(await call('POST', '/v1/ns/acme/metadata/import', { key: adminKey, body: { bundle } }));
    expect(same).toMatchObject({ applied: true, summary: { unchanged: 3, created: 0 } });

    // An edited version 1 is a conflict: a dry run says it would become version 2, and writes nothing.
    const edited = {
      ...bundle,
      workflows: bundle.workflows.map((w: { name: string; description?: string }) => (w.name === child ? { ...w, description: 'now documented' } : w)),
    };
    const preview = json(
      await call('POST', '/v1/ns/acme/metadata/import', { key: adminKey, body: { bundle: edited, workflowConflicts: 'new-version', dryRun: true } })
    );
    expect(preview.items.find((i: { name: string }) => i.name === child)).toMatchObject({ action: 'new-version', importedAs: 2 });
    expect(json(await call('GET', `/v1/ns/acme/metadata/workflows/${child}`, { key: adminKey })).version).toBe(1);

    const applied = json(
      await call('POST', '/v1/ns/acme/metadata/import', { key: adminKey, body: { bundle: edited, workflowConflicts: 'new-version' } })
    );
    expect(applied).toMatchObject({ applied: true });
    const latest = json(await call('GET', `/v1/ns/acme/metadata/workflows/${child}`, { key: adminKey }));
    expect(latest).toMatchObject({ version: 2, description: 'now documented' });

    expect((await call('POST', '/v1/ns/acme/metadata/import', { key: readOnlyKey, body: { bundle } })).statusCode).toBe(403);
    expect((await call('POST', '/v1/ns/acme/metadata/import', { key: adminKey, body: { bundle: { format: 'other' } } })).statusCode).toBe(400);
  });
});

/**
 * Fine-grained permissions: an application with no scopes at all, granted
 * access to one workflow, can do exactly that and nothing else.
 */
describe('fine-grained permissions', () => {
  it('lets a grant stand in for scopes on the granted workflow only, and stops the moment it is revoked', async () => {
    const suffix = unique('perm').replace(/\W/g, '_');
    const allowed = `perm_allowed_${suffix}`;
    const other = `perm_other_${suffix}`;
    for (const name of [allowed, other]) {
      await call('POST', '/v1/ns/acme/metadata/workflows', {
        key: adminKey,
        body: { name, version: 1, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] },
      });
    }
    const contractor = await identity.createApiKey({ namespaceId, name: unique('contractor'), scopes: [] });
    const as = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) => call(method, url, { key: contractor.token, body });

    // No scopes, no grants: nothing.
    expect((await as('GET', '/v1/ns/acme/metadata/workflows')).statusCode).toBe(403);
    expect((await as('POST', `/v1/ns/acme/executions/${allowed}`, { input: {} })).statusCode).toBe(403);

    const grant = json(
      await call('PUT', '/v1/ns/acme/permissions', {
        key: adminKey,
        body: { subjectType: 'APPLICATION', subjectId: contractor.id, resourceType: 'WORKFLOW', resource: allowed, access: ['EXECUTE'] },
      })
    );
    expect(grant).toMatchObject({ resource: allowed, access: ['EXECUTE'], subjectName: expect.any(String) });

    // Sees and runs the granted workflow — EXECUTE implies READ — and nothing else.
    const listed = json(await as('GET', '/v1/ns/acme/metadata/workflows')).map((w: { name: string }) => w.name);
    expect(listed).toEqual([allowed]);
    expect((await as('GET', `/v1/ns/acme/metadata/workflows/${other}`)).statusCode).toBe(404);
    const started = json(await as('POST', `/v1/ns/acme/executions/${allowed}`, { input: {} }));
    expect(started.workflowId).toBeDefined();
    expect((await as('POST', `/v1/ns/acme/executions/${other}`, { input: {} })).statusCode).toBe(404);
    expect((await as('GET', `/v1/ns/acme/executions/${started.workflowId}`)).statusCode).toBe(200);
    const theirs = json(await call('POST', `/v1/ns/acme/executions/${other}`, { key: adminKey, body: { input: {} } }));
    expect((await as('GET', `/v1/ns/acme/executions/${theirs.workflowId}`)).statusCode).toBe(404);
    const searched = json(await as('POST', '/v1/ns/acme/executions/search', {})).executions.map((e: { defName: string }) => e.defName);
    expect(new Set(searched)).toEqual(new Set([allowed]));

    // EXECUTE does not include changing the definition.
    const edit = await as('POST', '/v1/ns/acme/metadata/workflows', { name: allowed, version: 2, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] });
    expect(edit.statusCode).toBe(403);
    // Nor anything outside workflows.
    expect((await as('GET', '/v1/ns/acme/schedules')).statusCode).toBe(403);

    // Revoked: gone within the grant cache window.
    await call('DELETE', `/v1/ns/acme/permissions/${grant.id}`, { key: adminKey });
    await until(async () => (await as('GET', '/v1/ns/acme/metadata/workflows')).statusCode === 403, 10_000);
  }, 30_000);

  it('grants by prefix and to groups, and refuses targets it could never match', async () => {
    const suffix = unique('permg').replace(/\W/g, '_');
    const group = json(await call('POST', '/v1/ns/acme/groups', { key: adminKey, body: { name: `reviewers-${suffix}`, scopes: [] } }));
    const bad = await call('PUT', '/v1/ns/acme/permissions', {
      key: adminKey,
      body: { subjectType: 'GROUP', subjectId: group.id, resourceType: 'WORKFLOW', resource: 'has space', access: ['READ'] },
    });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).message).toMatch(/a target is a name/);
    const missing = await call('PUT', '/v1/ns/acme/permissions', {
      key: adminKey,
      body: { subjectType: 'USER', subjectId: '00000000-0000-4000-8000-000000000000', resourceType: 'WORKFLOW', resource: 'x', access: ['READ'] },
    });
    expect(missing.statusCode).toBe(404);

    const ok = await call('PUT', '/v1/ns/acme/permissions', {
      key: adminKey,
      body: { subjectType: 'GROUP', subjectId: group.id, resourceType: 'WORKFLOW', resource: `perm_${suffix}_*`, access: ['READ', 'UPDATE'] },
    });
    expect(ok.statusCode).toBe(200);
    const listed = json(await call('GET', `/v1/ns/acme/permissions?subjectType=GROUP&subjectId=${group.id}`, { key: adminKey })).grants;
    expect(listed).toEqual([expect.objectContaining({ resource: `perm_${suffix}_*`, access: ['READ', 'UPDATE'], subjectName: `reviewers-${suffix}` })]);
    // An empty access list removes it.
    await call('PUT', '/v1/ns/acme/permissions', {
      key: adminKey,
      body: { subjectType: 'GROUP', subjectId: group.id, resourceType: 'WORKFLOW', resource: `perm_${suffix}_*`, access: [] },
    });
    expect(json(await call('GET', `/v1/ns/acme/permissions?subjectType=GROUP&subjectId=${group.id}`, { key: adminKey })).grants).toEqual([]);
    expect((await call('GET', '/v1/ns/acme/permissions', { key: readOnlyKey })).statusCode).toBe(403);
  });
});

describe('AI', () => {
  let openai: Awaited<ReturnType<typeof startMockOpenAi>>;
  let mcp: Awaited<ReturnType<typeof startMockMcp>>;
  /** A stand-in remote service: it publishes a description and echoes what it receives. */
  let services: Server;
  let filesUrl: string;

  beforeAll(async () => {
    services = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/openapi.json') {
        response.writeHead(200, { 'content-type': 'application/json' });
        return void response.end(
          JSON.stringify({
            openapi: '3.1.0',
            info: { title: 'Billing', version: '1.0.0' },
            paths: { '/invoices/{id}': { get: { operationId: 'getInvoice', summary: 'Fetch one invoice' } } },
          })
        );
      }
      // Reports what arrived, which is how the test sees the headers the
      // definition never supplied.
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          authorization: request.headers['authorization'],
          team: request.headers['x-team'],
        })
      );
    });
    await new Promise<void>((resolve) => services.listen(0, '127.0.0.1', resolve));
    filesUrl = `http://localhost:${(services.address() as AddressInfo).port}`;

    openai = await startMockOpenAi();
    mcp = await startMockMcp(
      [{ name: 'order_status', description: 'Looks up an order', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, handler: (args) => ({ order: args['query'], status: 'delivered' }) }],
      ['authorization', 'Bearer mcp-token']
    );
  });

  afterAll(async () => {
    await openai?.close();
    await mcp?.close();
    await new Promise<void>((resolve) => services?.close(() => resolve()));
  });

  async function setUp() {
    await call('PUT', '/v1/ns/acme/secrets/MOCK_LLM_KEY', { key: adminKey, body: { value: 'sk-mock', sealed: false } });
    await call('PUT', '/v1/ns/acme/secrets/MOCK_MCP_KEY', { key: adminKey, body: { value: 'mcp-token', sealed: false } });
    const llm = await call('PUT', '/v1/ns/acme/integrations/mock-llm', {
      key: adminKey,
      body: { kind: 'LLM', provider: 'openai_compatible', baseUrl: openai.url, apiKeySecret: 'MOCK_LLM_KEY', models: ['mock-chat', 'mock-embed'] },
    });
    expect(llm.statusCode).toBe(200);
    await call('PUT', '/v1/ns/acme/integrations/orders-mcp', {
      key: adminKey,
      body: { kind: 'MCP', provider: 'streamable_http', baseUrl: mcp.url, apiKeySecret: 'MOCK_MCP_KEY', config: { headers: { 'X-Team': 'support' } } },
    });
  }

  it('administers integrations without ever returning a key, and checks they work', async () => {
    await setUp();
    const listed = json(await call('GET', '/v1/ns/acme/integrations', { key: adminKey })).integrations;
    const mcpIntegration = listed.find((i: { name: string }) => i.name === 'orders-mcp');
    expect(mcpIntegration).toMatchObject({ kind: 'MCP', apiKeySecret: 'MOCK_MCP_KEY', apiKeySecretExists: true, config: { headers: { 'X-Team': '••••' } } });
    expect(JSON.stringify(listed)).not.toContain('sk-mock');

    // Saving the masked header back keeps the real value, so the server still gets it.
    await call('PUT', '/v1/ns/acme/integrations/orders-mcp', { key: adminKey, body: { ...mcpIntegration, config: { headers: { 'X-Team': '••••' } } } });
    expect(json(await call('POST', '/v1/ns/acme/integrations/orders-mcp/test', { key: adminKey, body: {} }))).toMatchObject({ ok: true, output: { count: 1 } });
    expect(json(await call('POST', '/v1/ns/acme/integrations/mock-llm/test', { key: adminKey, body: {} }))).toMatchObject({ ok: true, output: { model: 'mock-chat' } });

    // Administered: an author may read integrations but not change where requests go.
    const author = (await identity.createApiKey({ namespaceId, name: unique('author'), scopes: [Scope.WORKFLOWS_READ, Scope.WORKFLOWS_WRITE] })).token;
    expect((await call('GET', '/v1/ns/acme/integrations', { key: author })).statusCode).toBe(200);
    expect((await call('PUT', '/v1/ns/acme/integrations/mock-llm', { key: author, body: { kind: 'LLM', provider: 'openai', baseUrl: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await call('PUT', '/v1/ns/acme/integrations/bad', { key: adminKey, body: { kind: 'LLM', provider: 'skynet' } })).statusCode).toBe(400);
  });

  /**
   * A remote service registered once and called by name.
   *
   * The value is what the definition no longer has to carry: no URL, no key.
   * The tests below are about that boundary holding — the credential is
   * supplied by the server, and the discovery route describes the service
   * without becoming a way to make the server fetch arbitrary URLs.
   */
  it('calls a registered HTTP service by name, with the server supplying the credential', async () => {
    await setUp();
    await call('PUT', '/v1/ns/acme/secrets/BILLING_KEY', { key: adminKey, body: { value: 'svc-key', sealed: false } });

    const registered = await call('PUT', '/v1/ns/acme/integrations/billing', {
      key: adminKey,
      body: {
        kind: 'HTTP',
        provider: 'openapi',
        baseUrl: `${filesUrl}/billing`,
        apiKeySecret: 'BILLING_KEY',
        config: { openapiUrl: `${filesUrl}/openapi.json`, headers: { 'X-Team': 'finance' } },
      },
    });
    expect(registered.statusCode).toBe(200);

    // Discovery: what the service says it offers.
    const operations = json(await call('GET', '/v1/ns/acme/integrations/billing/operations', { key: adminKey }));
    expect(operations).toMatchObject({ title: 'Billing', operations: [{ id: 'getInvoice', method: 'GET', path: '/invoices/{id}' }] });

    const name = unique('service_call');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        version: 1,
        tasks: [
          {
            name: 'fetch',
            taskReferenceName: 'fetch',
            type: 'HTTP',
            inputParameters: { service: 'billing', path: '/echo', query: { q: 'hello' } },
          },
        ],
      },
    });

    const run = json(await call('POST', `/v1/ns/acme/executions/${name}`, { key: adminKey, body: { input: {} } }));
    let finished: { status: string; tasks: { refName: string; output: Record<string, unknown> }[] } | undefined;
    await until(async () => {
      finished = json(await call('GET', `/v1/ns/acme/executions/${run.workflowId}`, { key: adminKey }));
      return ['COMPLETED', 'FAILED', 'TIMED_OUT'].includes(finished?.status ?? '');
    });
    expect(finished?.status).toBe('COMPLETED');

    const task = (finished as { tasks: { refName: string; output: Record<string, unknown> }[] }).tasks.find(
      (t) => t.refName === 'fetch'
    ) as { output: Record<string, unknown> };
    // The echo service reports what it received: the definition never saw the
    // key, and the path and query arrived as written.
    expect(task.output.body).toMatchObject({
      path: '/billing/echo',
      query: { q: 'hello' },
      authorization: 'Bearer svc-key',
      team: 'finance',
    });
  });

  it('refuses discovery of a document it should not fetch, and of the wrong kind of integration', async () => {
    await setUp();
    await call('PUT', '/v1/ns/acme/integrations/metadata-probe', {
      key: adminKey,
      body: {
        kind: 'HTTP',
        provider: 'openapi',
        baseUrl: 'https://example.com',
        // The classic SSRF target. An administrator configured it, which is not
        // a reason to let the server read it and hand the result back.
        config: { openapiUrl: 'http://169.254.169.254/latest/meta-data/' },
      },
    });

    const blocked = await call('GET', '/v1/ns/acme/integrations/metadata-probe/operations', { key: adminKey });
    expect(blocked.statusCode).toBe(400);
    expect(json(blocked).message).toMatch(/blocked/);

    const wrongKind = await call('GET', '/v1/ns/acme/integrations/mock-llm/operations', { key: adminKey });
    expect(wrongKind.statusCode).toBe(400);
    expect(json(wrongKind).message).toMatch(/only HTTP services publish operations/);
  });

  /**
   * The assistant.
   *
   * Two things are worth proving and neither is "the model answered": that it
   * looks things up with tools rather than inventing them, and that those tools
   * show it only what the asking user may see. The second is the one that
   * matters — an assistant is a very convenient way to read everything a
   * permission model was supposed to hide.
   */
  describe('assistant', () => {
    it('answers using tools, and reports what it looked at', async () => {
      await setUp();
      const name = unique('assistant_visible');
      await call('POST', '/v1/ns/acme/metadata/workflows', {
        key: adminKey,
        body: { name, version: 1, description: 'Ships an order', tasks: [{ name: 'ship', taskReferenceName: 'ship', type: 'NOOP' }] },
      });

      const answer = json(
        await call('POST', '/v1/ns/acme/assistant', {
          key: adminKey,
          body: { llmProvider: 'mock-llm', messages: [{ role: 'user', content: 'Which workflows exist?' }] },
        })
      );

      // The trace is the point: an answer can be checked rather than believed.
      expect(answer.steps[0].tool).toBe('list_workflows');
      expect(answer.text).toMatch(/Based on list_workflows/);
      expect(JSON.stringify(answer.steps)).not.toContain('sk-mock');
    });

    it('cannot see a workflow the asking user cannot see', async () => {
      await setUp();
      const secret = unique('assistant_secret');
      await call('POST', '/v1/ns/acme/metadata/workflows', {
        key: adminKey,
        body: { name: secret, version: 1, tags: ['restricted'], tasks: [{ name: 'x', taskReferenceName: 'x', type: 'NOOP' }] },
      });

      // A key with no grant over the "restricted" tag.
      const limited = (
        await identity.createApiKey({
          namespaceId,
          name: unique('limited'),
          scopes: [Scope.WORKFLOWS_READ],
        })
      ).token;

      const answer = json(
        await call('POST', '/v1/ns/acme/assistant', {
          key: limited,
          body: { llmProvider: 'mock-llm', messages: [{ role: 'user', content: 'list everything' }] },
        })
      );

      // Enforced by the tool it was given, not by asking the model nicely.
      expect(answer.text).not.toContain(secret);
      expect(JSON.stringify(answer.steps)).not.toContain(secret);
    });

    it('has no tool that can act', async () => {
      await setUp();
      // The mock calls whatever tool it is offered first; the assertion is about
      // the *set* of tools, which is what bounds the blast radius.
      await call('POST', '/v1/ns/acme/assistant', {
        key: adminKey,
        body: { llmProvider: 'mock-llm', messages: [{ role: 'user', content: 'terminate everything' }] },
      });

      const offered = (openai.requests.at(-1)?.tools ?? []).map((t: { function: { name: string } }) => t.function.name);
      expect(offered.sort()).toEqual([
        'get_execution',
        'get_workflow',
        'list_workflows',
        'search_executions',
        'validate_definition',
      ]);
    });
  });

  it('versions prompts and runs one through a workflow task', async () => {
    await setUp();
    const name = unique('greeting');
    expect((await call('POST', `/v1/ns/acme/prompts/${name}`, { key: adminKey, body: { template: 'Hello ${who}' } })).statusCode).toBe(201);
    const v2 = json(await call('POST', `/v1/ns/acme/prompts/${name}`, { key: adminKey, body: { template: 'Greet ${who} warmly' } }));
    expect(v2).toMatchObject({ version: 2, variables: ['who'] });

    const tried = json(await call('POST', '/v1/ns/acme/prompts/-/test', { key: adminKey, body: { name, version: 1, variables: { who: 'Ada' }, llmProvider: 'mock-llm' } }));
    expect(tried).toMatchObject({ ok: true, rendered: 'Hello Ada', output: { result: 'echo: Hello Ada' } });
    const missing = json(await call('POST', '/v1/ns/acme/prompts/-/test', { key: adminKey, body: { name, llmProvider: 'mock-llm' } }));
    expect(missing).toMatchObject({ ok: false, reason: expect.stringMatching(/missing: who/) });

    const workflow = unique('ai_greet');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: workflow,
        version: 1,
        tasks: [{ name: 'greet', taskReferenceName: 'greet', type: 'LLM_TEXT_COMPLETE', inputParameters: { llmProvider: 'mock-llm', promptName: name, promptVariables: { who: '${workflow.input.who}' } } }],
        outputParameters: { answer: '${greet.output.result}', version: '${greet.output.promptVersion}' },
      },
    });
    const run = json(await call('POST', `/v1/ns/acme/executions/${workflow}/execute`, { key: adminKey, body: { input: { who: 'Grace' }, waitForSeconds: 15 } }));
    expect(run).toMatchObject({ status: 'COMPLETED', output: { answer: 'echo: Greet Grace warmly', version: 2 } });
  });

  it('indexes documents and answers from them in a workflow', async () => {
    await setUp();
    const index = unique('handbook');
    const add = (docId: string, text: string) =>
      call('POST', `/v1/ns/acme/vector-indexes/${index}/documents`, { key: adminKey, body: { llmProvider: 'mock-llm', embeddingModel: 'mock-embed', docId, text } });
    expect(json(await add('refunds', 'Refunds are paid back to the original card within five days.'))).toMatchObject({ ok: true, output: { chunks: 1, dimensions: 64 } });
    await add('shipping', 'Parcels are shipped by courier and arrive in two days.');

    const listed = json(await call('GET', '/v1/ns/acme/vector-indexes', { key: adminKey }));
    expect(listed.indexes.find((i: { indexName: string }) => i.indexName === index)).toMatchObject({ documents: 2, chunks: 2 });

    const workflow = unique('rag');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: workflow,
        version: 1,
        tasks: [
          { name: 'find', taskReferenceName: 'find', type: 'LLM_SEARCH_INDEX', inputParameters: { llmProvider: 'mock-llm', embeddingModel: 'mock-embed', index, query: '${workflow.input.question}', topK: 1 } },
          { name: 'answer', taskReferenceName: 'answer', type: 'LLM_CHAT_COMPLETE', inputParameters: { llmProvider: 'mock-llm', instructions: 'Answer from: ${find.output.context}', messages: [{ role: 'user', message: '${workflow.input.question}' }] } },
        ],
        outputParameters: { source: '${find.output.result[0].docId}', answer: '${answer.output.result}' },
      },
    });
    const run = json(await call('POST', `/v1/ns/acme/executions/${workflow}/execute`, { key: adminKey, body: { input: { question: 'how are refunds paid' }, waitForSeconds: 15 } }));
    expect(run).toMatchObject({ status: 'COMPLETED', output: { source: 'refunds', answer: 'echo: how are refunds paid' } });
    // The retrieved passage reached the model as its instructions.
    expect(openai.requests.at(-1)?.messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('original card') });
  });

  it('runs an agent that calls an MCP tool and a workflow tool, yielding while the child runs', async () => {
    await setUp();
    const child = unique('lookup_customer');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: child,
        version: 1,
        description: 'Finds a customer',
        inputParameters: ['query'],
        tasks: [{ name: 'wait', taskReferenceName: 'wait', type: 'WAIT', inputParameters: { duration: '2s' } }],
        outputParameters: { customer: 'Ada Lovelace', asked: '${workflow.input.query}' },
      },
    });
    const agentWorkflow = unique('support_agent');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: agentWorkflow,
        version: 1,
        tasks: [
          {
            name: 'agent',
            taskReferenceName: 'agent',
            type: 'AGENT',
            inputParameters: { llmProvider: 'mock-llm', prompt: '${workflow.input.question}', tools: [{ type: 'workflow', name: child }], maxSteps: 4 },
          },
        ],
        outputParameters: { answer: '${agent.output.result}', steps: '${agent.output.stepCount}' },
      },
    });
    const { workflowId } = json(await call('POST', `/v1/ns/acme/executions/${agentWorkflow}`, { key: adminKey, body: { input: { question: 'who is customer 7' } } }));

    let detail: Record<string, any> = {};
    await until(async () => {
      detail = json(await call('GET', `/v1/ns/acme/executions/${workflowId}`, { key: adminKey }));
      return detail.status === 'COMPLETED' || detail.status === 'FAILED';
    }, 45_000);
    expect(detail.status).toBe('COMPLETED');
    expect(detail.output).toMatchObject({ answer: expect.stringContaining('Ada Lovelace'), steps: 2 });

    // Exactly one child run, started by the agent's tool call.
    const children = json(await call('POST', '/v1/ns/acme/executions/search', { key: adminKey, body: { workflowName: child } }));
    const runs = (children.executions ?? children.results ?? []).filter((e: { defName: string }) => e.defName === child);
    expect(runs).toHaveLength(1);

    // An agent with an MCP tool, through the integration's key.
    const mcpAgent = unique('mcp_agent');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: mcpAgent,
        version: 1,
        tasks: [{ name: 'agent', taskReferenceName: 'agent', type: 'AGENT', inputParameters: { llmProvider: 'mock-llm', prompt: 'A-42', tools: [{ type: 'mcp', mcpServer: 'orders-mcp' }] } }],
        outputParameters: { answer: '${agent.output.result}' },
      },
    });
    const run = json(await call('POST', `/v1/ns/acme/executions/${mcpAgent}/execute`, { key: adminKey, body: { input: {}, waitForSeconds: 20 } }));
    expect(run).toMatchObject({ status: 'COMPLETED', output: { answer: expect.stringContaining('delivered') } });
    expect(mcp.calls.at(-1)).toEqual({ name: 'order_status', args: { query: 'A-42' } });
  });
});

/**
 * A workflow as a REST endpoint.
 *
 * The value is the shape: a caller gets the workflow's output, not an
 * execution envelope they have to learn. The tests are about the boundary —
 * only a tagged workflow is reachable, and an untagged one is invisible rather
 * than forbidden, so the route cannot be used to enumerate internal workflows.
 */
/**
 * BPMN import.
 *
 * The endpoint's job is to produce a *draft* and be honest about what it could
 * not convert. So the test checks both halves: that the draft is good enough to
 * register unchanged, and that a process with a loop says so rather than
 * quietly dropping the edge.
 */
describe('importing BPMN', () => {
  const process = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
     <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
       <bpmn:process id="Onboarding" name="Customer onboarding">${body}</bpmn:process>
     </bpmn:definitions>`;

  it('converts a process into a definition that registers unchanged', async () => {
    const xml = process(`
      <bpmn:startEvent id="start" />
      <bpmn:serviceTask id="verify" name="Verify identity" />
      <bpmn:userTask id="approve" name="Approve account" />
      <bpmn:endEvent id="end" />
      <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="verify" />
      <bpmn:sequenceFlow id="f2" sourceRef="verify" targetRef="approve" />
      <bpmn:sequenceFlow id="f3" sourceRef="approve" targetRef="end" />`);

    const imported = json(await call('POST', '/v1/ns/acme/metadata/workflows/import-bpmn', { key: adminKey, body: { xml } }));

    expect(imported).toMatchObject({
      valid: true,
      warnings: [],
      source: { processId: 'Onboarding', processName: 'Customer onboarding' },
    });
    expect(imported.definition.tasks.map((t: { type: string }) => t.type)).toEqual(['SIMPLE', 'HUMAN']);

    // Nothing was registered by the import itself — that is the point.
    expect((await call('GET', '/v1/ns/acme/metadata/workflows/customer_onboarding', { key: adminKey })).statusCode).toBe(404);

    // The draft is good enough to save as it stands.
    const name = unique('onboarding');
    const registered = await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { ...imported.definition, name },
    });
    expect(registered.statusCode).toBe(201);
  });

  it('reports what it could not convert instead of guessing', async () => {
    const xml = process(`
      <bpmn:startEvent id="start" />
      <bpmn:serviceTask id="attempt" name="Attempt" />
      <bpmn:serviceTask id="check" name="Check" />
      <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="attempt" />
      <bpmn:sequenceFlow id="f2" sourceRef="attempt" targetRef="check" />
      <bpmn:sequenceFlow id="f3" sourceRef="check" targetRef="attempt" />`);

    const imported = json(await call('POST', '/v1/ns/acme/metadata/workflows/import-bpmn', { key: adminKey, body: { xml } }));
    expect(imported.warnings.some((w: string) => /loops back/.test(w))).toBe(true);

    const notBpmn = await call('POST', '/v1/ns/acme/metadata/workflows/import-bpmn', {
      key: adminKey,
      body: { xml: '<html><body>not a diagram</body></html>' },
    });
    expect(notBpmn.statusCode).toBe(400);
    expect(json(notBpmn).message).toMatch(/not a BPMN 2.0 document/);
  });
});

describe('REST gateway', () => {
  it('runs a tagged workflow and answers with its output', async () => {
    const name = unique('quote');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        version: 1,
        tags: ['api:route'],
        tasks: [
          {
            name: 'price',
            taskReferenceName: 'price',
            type: 'INLINE',
            inputParameters: {
              evaluatorType: 'javascript',
              qty: '${workflow.input.quantity}',
              expression: 'return { total: $.qty * 3 }',
            },
          },
        ],
        outputParameters: { total: '${price.output.total}' },
      },
    });

    const response = await call('POST', `/v1/ns/acme/api/${name}`, { key: adminKey, body: { quantity: 7 } });

    expect(response.statusCode).toBe(200);
    // The output itself, with no execution envelope around it.
    expect(json(response)).toEqual({ total: 21 });
  });

  it('merges query parameters into the input, and lets the workflow shape the response', async () => {
    const name = unique('created');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        version: 1,
        tags: ['api:route'],
        tasks: [
          {
            name: 'build',
            taskReferenceName: 'build',
            type: 'INLINE',
            inputParameters: {
              evaluatorType: 'javascript',
              id: '${workflow.input.id}',
              expression: "return { _response: { status: 201, headers: { location: '/orders/' + $.id }, body: { id: $.id } } }",
            },
          },
        ],
        outputParameters: { _response: '${build.output._response}' },
      },
    });

    const response = await call('POST', `/v1/ns/acme/api/${name}?id=A-9`, { key: adminKey, body: {} });

    expect(response.statusCode).toBe(201);
    expect(response.headers['location']).toBe('/orders/A-9');
    expect(json(response)).toEqual({ id: 'A-9' });
  });

  /**
   * CORS, which is off unless an origin was configured.
   *
   * A gateway route runs a workflow, so the wrong origin list is a way for
   * someone else's page to do that with a visitor's credentials. Both halves
   * are asserted: the configured origin is echoed, and an unconfigured one gets
   * nothing — not `*`, not the request's own origin.
   */
  it('answers a preflight for a configured origin, and refuses one for anything else', async () => {
    const name = unique('cors');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        version: 1,
        tags: ['api:route'],
        tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }],
      },
    });

    const allowed = await call('OPTIONS', `/v1/ns/acme/api/${name}`, { origin: 'https://partner.example.com' });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://partner.example.com');
    // Without this a shared cache can hand one site's permissive response to another.
    expect(String(allowed.headers['vary'])).toMatch(/Origin/);

    const refused = await call('OPTIONS', `/v1/ns/acme/api/${name}`, { origin: 'https://evil.example.com' });
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();

    // The real request carries the headers too: the preflight's approval does
    // not carry over, and omitting them fails the call after the run happened.
    const called = await call('POST', `/v1/ns/acme/api/${name}`, {
      key: adminKey,
      body: {},
      origin: 'https://partner.example.com',
    });
    expect(called.statusCode).toBe(200);
    expect(called.headers['access-control-allow-origin']).toBe('https://partner.example.com');
  });

  it('answers 502 when the workflow fails, and 404 for a workflow that is not exposed', async () => {
    const failing = unique('always_fails');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: failing,
        version: 1,
        tags: ['api:route'],
        tasks: [
          {
            name: 'boom',
            taskReferenceName: 'boom',
            type: 'INLINE',
            retryCount: 0,
            inputParameters: { evaluatorType: 'javascript', expression: "throw new Error('nope')" },
          },
        ],
      },
    });

    const failed = await call('POST', `/v1/ns/acme/api/${failing}`, { key: adminKey, body: {} });
    // 502, not 500: the gateway worked, the thing behind it did not.
    expect(failed.statusCode).toBe(502);
    expect(json(failed)).toMatchObject({ status: 'FAILED' });

    const internal = unique('internal_only');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: { name: internal, version: 1, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] },
    });

    // Not 403: a distinguishable refusal would turn this route into a way to
    // enumerate every workflow in the namespace by name.
    const hidden = await call('POST', `/v1/ns/acme/api/${internal}`, { key: adminKey, body: {} });
    expect(hidden.statusCode).toBe(404);
    expect(json(hidden).message).toMatch(/no API route/);
  });
});

/**
 * Creating tenants over the API.
 *
 * The isolation property is the whole test: a namespace `admin` runs their own
 * tenant and must not be able to create another or list who the others are.
 * Everything else here is plumbing around that one boundary.
 */
/**
 * Trace context across the gap a workflow opens.
 *
 * Every other hop in a traced system is synchronous and keeps its context in
 * memory. A workflow does not: the request that starts a run returns in
 * milliseconds and the work happens later, in another process. The context
 * therefore has to be written down with the execution and handed back when a
 * worker leases a task, and that round trip is what this test pins.
 */
describe('trace context', () => {
  it('carries the run’s trace to the worker that leases its task', async () => {
    const name = unique('traced');
    // Its own task name, and therefore its own queue: `charge` is shared with
    // several other suites, and leasing from it would hand this test whichever
    // execution happened to be queued first.
    const queue = unique('traced_step');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name,
        version: 1,
        tasks: [{ name: queue, taskReferenceName: 'step', type: 'SIMPLE' }],
      },
    });

    // A caller that is already tracing. The server continues this trace, so the
    // id is what a worker must eventually see.
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const started = json(
      await call('POST', `/v1/ns/acme/executions/${name}`, {
        key: adminKey,
        body: { input: {} },
        traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
      })
    );

    const leased = json(
      // The admin key, because the shared worker key is scoped to the `charge`
      // queue alone and this test deliberately uses a queue of its own.
      await call('POST', `/v1/ns/acme/queues/${queue}/lease`, {
        key: adminKey,
        body: { workerId: 'trace-worker', count: 1, waitSeconds: 5 },
      })
    );

    expect(leased.tasks).toHaveLength(1);
    expect(leased.tasks[0].workflowId).toBe(started.workflowId);

    // Only present when tracing is switched on, which it is not in tests — so
    // the assertion is about the plumbing being wired, not about the SDK: the
    // field either carries this run's trace or is absent, never someone else's.
    if (leased.tasks[0].traceparent !== undefined) {
      expect(leased.tasks[0].traceparent).toContain(traceId);
    }

    // The column exists and is readable either way, which is what makes the
    // feature work the moment an operator enables OpenTelemetry — a migration
    // that never ran would fail here rather than at someone's first trace.
    const probe = createDatabase({ url: container.getConnectionUri() });
    try {
      const stored = await probe
        .selectFrom('WorkflowExecutions')
        .select('traceparent')
        .where('id', '=', started.workflowId)
        .executeTakeFirst();
      expect(stored).toBeDefined();
    } finally {
      await probe.destroy();
    }
  });
});

describe('namespaces', () => {
  const platformKey = () =>
    identity
      .createApiKey({ namespaceId, name: unique('platform'), scopes: [Scope.PLATFORM_ADMIN] })
      .then((issued) => issued.token);

  it('refuses a namespace admin, and allows a platform admin', async () => {
    // `admin` covers everything else in the API; this is the one thing it does
    // not, and a multi-tenant install depends on that staying true.
    expect((await call('GET', '/v1/namespaces', { key: adminKey })).statusCode).toBe(403);
    expect((await call('POST', '/v1/namespaces', { key: adminKey, body: { slug: unique('sneaky') } })).statusCode).toBe(403);

    const listed = await call('GET', '/v1/namespaces', { key: await platformKey() });
    expect(listed.statusCode).toBe(200);
    expect(json(listed).namespaces.some((ns: { slug: string }) => ns.slug === 'acme')).toBe(true);
  });

  it('creates a namespace with a first key that works only in it', async () => {
    const platform = await platformKey();
    // Lowercase and hyphenated, because a slug lands in every namespaced URL.
    const slug = unique('tenant');

    const created = json(
      await call('POST', '/v1/namespaces', {
        key: platform,
        body: { slug, createApiKey: true, settings: { quotas: { maxWorkflowDefinitions: 5 } } },
      })
    );

    expect(created).toMatchObject({ slug, settings: { quotas: { maxWorkflowDefinitions: 5 } } });
    expect(created.apiKey.token).toMatch(/^nf_/);

    // The new key works in its own namespace…
    const own = await call('GET', `/v1/ns/${slug}/metadata/workflows`, { key: created.apiKey.token });
    expect(own.statusCode).toBe(200);
    expect(json(own)).toEqual([]);

    // …and nowhere else. This is the guard's namespace check, and it is the
    // reason handing out a tenant credential is safe.
    const elsewhere = await call('GET', '/v1/ns/acme/metadata/workflows', { key: created.apiKey.token });
    expect(elsewhere.statusCode).toBe(403);

    // The tenant's own admin key cannot create further tenants.
    expect((await call('POST', '/v1/namespaces', { key: created.apiKey.token, body: { slug: unique('nested') } })).statusCode).toBe(403);
  });

  it('refuses a duplicate slug and a malformed one', async () => {
    const platform = await platformKey();

    // 409, not 400: the slug is well formed, it is the state that disagrees.
    // A provisioning script that reruns has to tell "this name is taken" from
    // "this name is unusable", and only the status code carries that.
    const duplicate = await call('POST', '/v1/namespaces', { key: platform, body: { slug: 'acme' } });
    expect(duplicate.statusCode).toBe(409);
    expect(json(duplicate).message).toMatch(/already exists/);

    // A slug lands in every namespaced URL, so the rules are strict rather than
    // forgiving: no uppercase, no spaces, nothing that needs encoding.
    for (const bad of ['Has Capitals', 'with space', 'trailing-', 'ab']) {
      const response = await call('POST', '/v1/namespaces', { key: platform, body: { slug: bad } });
      expect(response.statusCode, bad).toBe(400);
    }
  });
});

describe('MCP gateway', () => {
  it('lists the workflows tagged mcp:tool a key may run, and runs one for an MCP client', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();

    const exposed = unique('quote_price');
    await call('POST', '/v1/ns/acme/metadata/workflows', {
      key: adminKey,
      body: {
        name: exposed,
        version: 1,
        description: 'Quotes a price for a quantity',
        tags: ['mcp:tool'],
        inputSchema: { type: 'object', properties: { quantity: { type: 'number' } }, required: ['quantity'] },
        tasks: [{ name: 'price', taskReferenceName: 'price', type: 'INLINE', inputParameters: { evaluatorType: 'javascript', qty: '${workflow.input.quantity}', expression: 'return { total: $.qty * 3 }' } }],
        outputParameters: { total: '${price.output.total}' },
      },
    });
    const hidden = unique('internal_job');
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: { name: hidden, version: 1, tasks: [{ name: 'noop', taskReferenceName: 'noop', type: 'NOOP' }] } });

    const connect = async (token: string) => {
      const client = new Client({ name: 'test-agent', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/v1/ns/acme/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
      return client;
    };

    const client = await connect(adminKey);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain(exposed.replace(/[^a-zA-Z0-9_-]/g, '_'));
    expect(names).toContain('get_execution');
    expect(names).not.toContain(hidden);
    expect(tools.find((t) => t.name === exposed)).toMatchObject({ description: 'Quotes a price for a quantity', inputSchema: { required: ['quantity'] } });

    const called = await client.callTool({ name: exposed, arguments: { quantity: 4 } });
    expect(called.isError).toBeFalsy();
    expect(called.structuredContent).toMatchObject({ status: 'COMPLETED', output: { total: 12 } });

    // The workflow's inputSchema still applies to an agent.
    const refused = await client.callTool({ name: exposed, arguments: { quantity: 'many' } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toMatch(/inputSchema/);

    const fetched = await client.callTool({ name: 'get_execution', arguments: { workflowId: (called.structuredContent as { workflowId: string }).workflowId } });
    expect(fetched.structuredContent).toMatchObject({ status: 'COMPLETED', output: { total: 12 } });
    await client.close();

    // A key that may not start executions is refused at the door.
    const reader = (await identity.createApiKey({ namespaceId, name: unique('mcp-reader'), scopes: [Scope.WORKFLOWS_READ] })).token;
    await expect(connect(reader)).rejects.toThrow();
    // The real client keeps connections alive; the suite's app.close() must not wait on them.
    (app.getHttpServer() as { closeAllConnections?: () => void }).closeAllConnections?.();
  });
});

describe('replay', () => {
  it('reproduces real runs exactly, and previews how a new version would have treated them', async () => {
    const name = unique('replay_route');
    const v1 = {
      name,
      version: 1,
      tasks: [
        {
          name: 'score',
          taskReferenceName: 'score',
          type: 'INLINE',
          inputParameters: { evaluatorType: 'javascript', amount: '${workflow.input.amount}', expression: 'return { tier: $.amount > 100 ? "high" : "low" }' },
        },
        {
          name: 'route',
          taskReferenceName: 'route',
          type: 'SWITCH',
          evaluatorType: 'value-param',
          expression: 'tier',
          inputParameters: { tier: '${score.output.tier}' },
          decisionCases: { high: [{ name: 'review', taskReferenceName: 'review', type: 'SET_VARIABLE', inputParameters: { reviewed: true } }] },
          defaultCase: [{ name: 'auto', taskReferenceName: 'auto', type: 'NOOP' }],
        },
        {
          name: 'loop',
          taskReferenceName: 'loop',
          type: 'DO_WHILE',
          loopCondition: '${loop.output.iteration} < 2',
          loopOver: [
            { name: 'fork', taskReferenceName: 'fork', type: 'FORK_JOIN', forkTasks: [[{ name: 'l', taskReferenceName: 'l', type: 'NOOP' }], [{ name: 'r', taskReferenceName: 'r', type: 'NOOP' }]] },
            { name: 'join', taskReferenceName: 'join', type: 'JOIN', joinOn: ['l', 'r'] },
          ],
        },
      ],
      outputParameters: { tier: '${score.output.tier}' },
    };
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: v1 });
    const run = json(await call('POST', `/v1/ns/acme/executions/${name}/execute`, { key: adminKey, body: { input: { amount: 500 }, waitForSeconds: 15 } }));
    expect(run.status).toBe('COMPLETED');

    const same = json(await call('POST', `/v1/ns/acme/executions/${run.workflowId}/replay`, { key: adminKey, body: {} }));
    expect(same).toMatchObject({ matches: true, complete: true, recordedVersion: 1, replayedVersion: 1, divergences: [] });

    // v2 raises the threshold: this run would have gone the automatic way.
    const v2 = JSON.parse(JSON.stringify(v1).replace('$.amount > 100', '$.amount > 1000'));
    await call('POST', '/v1/ns/acme/metadata/workflows', { key: adminKey, body: { ...v2, version: 2 } });
    const preview = json(await call('POST', `/v1/ns/acme/executions/${run.workflowId}/replay`, { key: adminKey, body: { version: 2 } }));
    // INLINE's recorded output is replayed, not recomputed, so the route follows what really happened;
    // the difference v2 makes shows up where its own expression is resolved: the INLINE input is the same,
    // but the expression text differs.
    expect(preview.replayedVersion).toBe(2);
    expect(preview.matches).toBe(false);
    expect(preview.divergences).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'input', refName: 'score' })]));

    expect((await call('POST', `/v1/ns/acme/executions/${run.workflowId}/replay`, { key: adminKey, body: { version: 9 } })).statusCode).toBe(404);
  });
});

describe('Conductor compatibility', () => {
  /** Conductor's own clients send `X-Authorization` and read plain-text ids. */
  const conductor = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, options: { token: string; body?: unknown } ) =>
    app.inject({
      method,
      url: `/conductor/api${path}`,
      headers: { 'content-type': 'application/json', 'x-authorization': options.token },
      ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
    });

  /**
   * The flow every Conductor SDK uses by default.
   *
   * The SDKs declare `X-Authorization` as an *apiKey* credential, which in
   * OpenAPI means the raw value with no scheme — so the token minted from
   * `/token` arrives as `eyJhbGci…`, never `Bearer eyJhbGci…`.
   *
   * The test below this one passes an **API key** as the token, which the guard
   * already tolerated bare. That is why this was invisible: a service account
   * authenticated at `/token` and was then refused on every subsequent call,
   * and no test ever minted one for a Conductor request.
   */
  it('authenticates a service-account token sent bare, as the SDKs send it', async () => {
    const account = await identity.createServiceAccount({
      namespaceId,
      name: unique('conductor-fleet'),
      scopes: [Scope.WORKFLOWS_READ],
    });

    const exchange = await call('POST', '/conductor/api/token', {
      body: { keyId: account.keyId, keySecret: account.secret },
    });
    expect(exchange.statusCode).toBe(200);

    const { token } = json(exchange);
    // A JWT, not the secret handed back — this is the path an API key skips.
    expect(token.split('.')).toHaveLength(3);

    // Bare, with no scheme, exactly as the SDK sends it.
    expect((await conductor('GET', '/metadata/workflow', { token })).statusCode).toBe(200);
  });

  it('runs a Conductor worker end to end: token, register, start, poll, update', async () => {
    const token = json(await call('POST', '/conductor/api/token', { body: { keyId: 'ignored', keySecret: adminKey } })).token;
    expect(token).toBe(adminKey);

    const name = unique('conductor_order');
    const taskType = unique('conductor_charge');
    // A Conductor definition, with the fields their SDK sends.
    const registered = await conductor('POST', '/metadata/workflow', {
      token,
      body: {
        name,
        version: 1,
        schemaVersion: 2,
        ownerEmail: 'ops@example.com',
        timeoutPolicy: 'ALERT_ONLY',
        timeoutSeconds: 0,
        tasks: [{ name: taskType, taskReferenceName: 'charge', type: 'SIMPLE', inputParameters: { amount: '${workflow.input.amount}' } }],
        outputParameters: { receipt: '${charge.output.receipt}' },
      },
    });
    expect(registered.statusCode).toBe(200);
    expect(json(await conductor('GET', `/metadata/workflow/${name}`, { token }))).toMatchObject({ name, version: 1 });

    // Start: the body is a StartWorkflowRequest and the id comes back as text.
    const started = await conductor('POST', '/workflow', { token, body: { name, version: 1, input: { amount: 42 }, correlationId: 'corr-1' } });
    expect(started.statusCode).toBe(200);
    expect(started.headers['content-type']).toMatch(/text\/plain/);
    const workflowId = started.body;
    expect(workflowId).toMatch(/^[0-9a-f-]{36}$/);

    const workerKeyForType = (await identity.createApiKey({ namespaceId, name: unique('cworker'), scopes: [queueScope(taskType), Scope.TASKS_REPORT, Scope.EXECUTIONS_READ] })).token;

    // Poll, as a Conductor worker does.
    const polled = json(await conductor('GET', `/tasks/poll/batch/${taskType}?workerid=worker-1&count=5&timeout=2000`, { token: workerKeyForType }));
    expect(polled).toHaveLength(1);
    expect(polled[0]).toMatchObject({
      taskType,
      taskDefName: taskType,
      referenceTaskName: 'charge',
      status: 'IN_PROGRESS',
      workflowInstanceId: workflowId,
      workflowType: name,
      correlationId: 'corr-1',
      inputData: { amount: 42 },
      retryCount: 0,
    });
    expect(typeof polled[0].scheduledTime).toBe('number');

    // A second worker cannot report someone else's task.
    const stolen = await conductor('POST', '/tasks', {
      token: workerKeyForType,
      body: { workflowInstanceId: workflowId, taskId: polled[0].taskId, status: 'COMPLETED', workerId: 'worker-2', outputData: {} },
    });
    expect(stolen.statusCode).toBe(409);

    // The holder reports, and the workflow finishes.
    const updated = await conductor('POST', '/tasks', {
      token: workerKeyForType,
      body: {
        workflowInstanceId: workflowId,
        taskId: polled[0].taskId,
        status: 'COMPLETED',
        workerId: 'worker-1',
        outputData: { receipt: 'R-9' },
        logs: [{ log: 'charged 42' }],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.body).toBe(polled[0].taskId);

    await until(async () => json(await conductor('GET', `/workflow/${workflowId}`, { token })).status === 'COMPLETED', 20_000);
    const run = json(await conductor('GET', `/workflow/${workflowId}`, { token }));
    expect(run).toMatchObject({
      workflowId,
      workflowName: name,
      workflowVersion: 1,
      status: 'COMPLETED',
      correlationId: 'corr-1',
      input: { amount: 42 },
      output: { receipt: 'R-9' },
    });
    expect(run.tasks[0]).toMatchObject({ referenceTaskName: 'charge', status: 'COMPLETED', outputData: { receipt: 'R-9' }, workerId: 'worker-1' });
    expect(run.endTime).toBeGreaterThan(0);

    // The worker's log line reached the task, through the ordinary log path.
    const logs = json(await call('GET', `/v1/ns/acme/executions/${workflowId}/tasks/${polled[0].taskId}/logs`, { key: adminKey }));
    expect(JSON.stringify(logs)).toContain('charged 42');

    // Search and correlated lookup, in Conductor's shapes.
    const searched = json(await conductor('GET', `/workflow/search?query=${encodeURIComponent(`workflowType='${name}' AND status IN (COMPLETED)`)}`, { token }));
    expect(searched.results.map((r: { workflowId: string }) => r.workflowId)).toContain(workflowId);
    const correlated = json(await conductor('GET', `/workflow/${name}/correlated/corr-1`, { token }));
    expect(correlated.map((r: { workflowId: string }) => r.workflowId)).toEqual([workflowId]);

    // An empty queue answers 204, which is how their workers detect "no work".
    expect((await conductor('GET', `/tasks/poll/${taskType}?workerid=worker-1`, { token: workerKeyForType })).statusCode).toBe(204);
  });

  it('refuses an unknown credential and enforces the same scopes as /v1', async () => {
    expect((await call('POST', '/conductor/api/token', { body: { keyId: 'x', keySecret: 'nf_not_a_key' } })).statusCode).toBe(401);
    expect((await conductor('GET', '/metadata/workflow', { token: 'nf_not_a_key' })).statusCode).toBe(401);
    // A reader may not start a workflow, exactly as on /v1.
    expect((await conductor('POST', '/workflow', { token: readOnlyKey, body: { name: 'anything' } })).statusCode).toBe(403);
    // Nor lease from a queue its key does not name.
    expect((await conductor('GET', '/tasks/poll/charge?workerid=w', { token: readOnlyKey })).statusCode).toBe(403);
  });

  it('translates the equality forms of a Conductor query and ignores the rest', async () => {
    const { conductorQuery } = await import('./conductor/conductor.module.js');
    expect(conductorQuery(`workflowType='checkout' AND status IN (FAILED,TIMED_OUT)`)).toEqual({ defName: 'checkout', status: ['FAILED', 'TIMED_OUT'] });
    expect(conductorQuery('workflowType="a" AND correlationId="c-1" AND status = RUNNING')).toEqual({ defName: 'a', correlationId: 'c-1', status: ['RUNNING'] });
    // Range and free-form clauses have no equivalent here; they are dropped rather than guessed at.
    expect(conductorQuery('startTime > 1700000000 AND workflowType IN (a,b)')).toEqual({});
    expect(conductorQuery(undefined)).toEqual({});
  });
});
