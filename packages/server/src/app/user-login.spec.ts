import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Scope } from '@node-flow-dev/core';
import { IdentityRepository, createDatabase, migrate } from '@node-flow-dev/store';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './auth/session.js';
import { configureApp, createAdapter } from './configure-app.js';

/**
 * Email and password login, over the API.
 *
 * Almost every test here is about a refusal. Password login is the part of a
 * system that is actively attacked, and the failures that matter are silent
 * ones: a session that survives logout, a cookie readable by script, a mutating
 * request accepted without a CSRF token.
 */

let container: StartedPostgreSqlContainer;
let app: NestFastifyApplication;
let identity: IdentityRepository;
let namespaceId: string;
let adminKey: string;

const PASSWORD = 'correct-horse-battery';

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

interface CallOptions {
  body?: unknown;
  key?: string;
  cookies?: Record<string, string>;
  csrf?: string;
}

function call(method: 'GET' | 'POST' | 'DELETE', url: string, options: CallOptions = {}) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.key) headers['x-api-key'] = options.key;
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
    ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
  });
}

const json = (response: { body: string }) => JSON.parse(response.body);

/** `set-cookie` may be a string or an array depending on how many were set. */
function setCookies(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)];
}

function cookieValue(response: { headers: Record<string, unknown> }, name: string) {
  const line = setCookies(response).find((c) => c.startsWith(`${name}=`));
  return line ? decodeURIComponent(line.slice(name.length + 1).split(';')[0]) : undefined;
}

/** Logs in and returns everything a browser would then hold. */
async function login(password = PASSWORD, email = currentEmail) {
  const response = await call('POST', '/v1/ns/acme/users/login', {
    body: { email, password },
  });

  return {
    response,
    session: cookieValue(response, SESSION_COOKIE),
    csrf: cookieValue(response, CSRF_COOKIE),
  };
}

beforeAll(async () => {
  ensureDockerHost();
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('nodeflow_login')
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
}, 240_000);

afterAll(async () => {
  await app?.close();
  await container?.stop();
}, 60_000);

/**
 * A fresh account per test.
 *
 * Sharing one would couple the tests through its lockout counter and its
 * sessions — the brute-force test alone would lock out everything that ran
 * after it.
 */
let accounts = 0;
let currentEmail: string;

beforeEach(async () => {
  currentEmail = `ada-${++accounts}@example.com`;

  const response = await call('POST', '/v1/ns/acme/users', {
    key: adminKey,
    body: {
      email: currentEmail,
      name: 'Ada',
      password: PASSWORD,
      scopes: [Scope.EXECUTIONS_READ],
    },
  });

  expect(response.statusCode).toBe(201);
});

describe('logging in', () => {
  it('sets a session cookie and returns the user', async () => {
    const { response, session } = await login();

    expect(response.statusCode).toBe(200);
    expect(session).toBeTruthy();
    expect(json(response).user).toMatchObject({ name: 'Ada', namespaceId });
  });

  /**
   * The single most important property here.
   *
   * `HttpOnly` means script cannot read the session, so an XSS bug cannot
   * exfiltrate it. A token in `localStorage` — the usual alternative — turns
   * every XSS into a full account takeover.
   */
  it('makes the session cookie unreadable by script', async () => {
    const { response } = await login();
    const cookie = setCookies(response).find((c) => c.startsWith(SESSION_COOKIE));

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  // Deliberately readable: the page has to echo it into a header, which is what
  // an attacking site cannot do.
  it('makes the CSRF cookie readable by script', async () => {
    const { response } = await login();
    const cookie = setCookies(response).find((c) => c.startsWith(CSRF_COOKIE));

    expect(cookie).not.toContain('HttpOnly');
  });

  it('authenticates subsequent requests with the cookie', async () => {
    const { session } = await login();

    const response = await call('GET', '/v1/auth/whoami', {
      cookies: { [SESSION_COOKIE]: session as string },
    });

    expect(response.statusCode).toBe(200);
    expect(json(response)).toMatchObject({ type: 'USER', name: 'Ada' });
  });

  // Distinguishing the two is a user-enumeration oracle.
  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await login('not-the-password');
    const unknown = await login(PASSWORD, 'nobody-at-all@example.com');

    expect(wrong.response.statusCode).toBe(401);
    expect(unknown.response.statusCode).toBe(401);
    expect(json(wrong.response).message).toBe(json(unknown.response).message);
  });

  it('sets no cookie on a failed login', async () => {
    const { response } = await login('not-the-password');
    expect(setCookies(response)).toHaveLength(0);
  });

  it('rejects a malformed email before touching the database', async () => {
    const response = await call('POST', '/v1/ns/acme/users/login', {
      body: { email: 'not-an-email', password: PASSWORD },
    });

    expect(response.statusCode).toBe(400);
  });

  it('does not reveal whether a namespace exists', async () => {
    const response = await call('POST', '/v1/ns/nonexistent/users/login', {
      body: { email: currentEmail, password: PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(json(response).message).toBe('incorrect email or password');
  });
});

describe('CSRF', () => {
  /**
   * The reason cookies need this at all: a browser attaches them
   * automatically, so another site can cause an authenticated request.
   */
  it('refuses a cookie-authenticated write with no token', async () => {
    const { session } = await login();

    const response = await call('POST', '/v1/ns/acme/users/logout-all', {
      cookies: { [SESSION_COOKIE]: session as string },
    });

    expect(response.statusCode).toBe(403);
    expect(json(response).error).toBe('csrf_failed');
  });

  it('refuses a token that does not match the cookie', async () => {
    const { session, csrf } = await login();

    const response = await call('POST', '/v1/ns/acme/users/logout-all', {
      cookies: { [SESSION_COOKIE]: session as string, [CSRF_COOKIE]: csrf as string },
      csrf: 'a-different-value',
    });

    expect(response.statusCode).toBe(403);
  });

  // Sending neither must not read as "nothing to compare, allow" — that is the
  // mistake that makes double-submit useless.
  it('refuses when both halves are absent', async () => {
    const { session } = await login();

    const response = await call('POST', '/v1/ns/acme/users/logout-all', {
      cookies: { [SESSION_COOKIE]: session as string },
      csrf: undefined,
    });

    expect(response.statusCode).toBe(403);
  });

  it('accepts a matching token', async () => {
    const { session, csrf } = await login();

    const response = await call('POST', '/v1/ns/acme/users/logout-all', {
      cookies: { [SESSION_COOKIE]: session as string, [CSRF_COOKIE]: csrf as string },
      csrf,
    });

    expect(response.statusCode).toBe(200);
  });

  it('does not require a token for reads', async () => {
    const { session } = await login();

    const response = await call('GET', '/v1/auth/whoami', {
      cookies: { [SESSION_COOKIE]: session as string },
    });

    expect(response.statusCode).toBe(200);
  });

  /**
   * API keys are never attached automatically, so an attacking page cannot
   * cause an authenticated request with one. Demanding a CSRF token from
   * workers would break every one of them for no security gain — which is how
   * CSRF protection usually ends up switched off entirely.
   */
  it('does not require a token from a machine credential', async () => {
    const response = await call('POST', '/v1/ns/acme/executions/search', {
      key: adminKey,
      body: {},
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('logging out', () => {
  // The whole reason sessions are database rows rather than signed tokens.
  it('makes the session stop working immediately', async () => {
    const { session, csrf } = await login();

    const out = await call('POST', '/v1/ns/acme/users/logout', {
      cookies: { [SESSION_COOKIE]: session as string, [CSRF_COOKIE]: csrf as string },
      csrf,
    });
    expect(out.statusCode).toBe(204);

    const after = await call('GET', '/v1/auth/whoami', {
      cookies: { [SESSION_COOKIE]: session as string },
    });
    expect(after.statusCode).toBe(401);
  });

  it('clears both cookies', async () => {
    const { session, csrf } = await login();

    const out = await call('POST', '/v1/ns/acme/users/logout', {
      cookies: { [SESSION_COOKIE]: session as string, [CSRF_COOKIE]: csrf as string },
      csrf,
    });

    const cleared = setCookies(out);
    expect(cleared.some((c) => c.startsWith(`${SESSION_COOKIE}=;`))).toBe(true);
    expect(cleared.every((c) => c.includes('Max-Age=0'))).toBe(true);
  });

  it('ends every session at once', async () => {
    const first = await login();
    const second = await login();

    await call('POST', '/v1/ns/acme/users/logout-all', {
      cookies: {
        [SESSION_COOKIE]: second.session as string,
        [CSRF_COOKIE]: second.csrf as string,
      },
      csrf: second.csrf,
    });

    for (const s of [first.session, second.session]) {
      const response = await call('GET', '/v1/auth/whoami', {
        cookies: { [SESSION_COOKIE]: s as string },
      });
      expect(response.statusCode).toBe(401);
    }
  });
});

describe('brute force', () => {
  it('returns 429 with Retry-After once locked out', async () => {
    for (let i = 0; i < 5; i++) await login('wrong-password');

    const { response } = await login('wrong-password');

    expect(response.statusCode).toBe(429);
    // Without this a client cannot tell whether to wait a second or an hour, so
    // it retries at once and extends its own lockout.
    expect(response.headers['retry-after']).toBeDefined();
    expect(json(response).retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('administration', () => {
  it('requires admin to create a user', async () => {
    const { session, csrf } = await login();

    // Ada holds only executions:read.
    const response = await call('POST', '/v1/ns/acme/users', {
      cookies: { [SESSION_COOKIE]: session as string, [CSRF_COOKIE]: csrf as string },
      csrf,
      body: { email: `grace-${accounts}@example.com`, name: 'Grace', password: PASSWORD },
    });

    expect(response.statusCode).toBe(403);
  });

  it('reports why a password was rejected', async () => {
    const response = await call('POST', '/v1/ns/acme/users', {
      key: adminKey,
      body: { email: `weak-${accounts}@example.com`, name: 'Weak', password: 'short' },
    });

    expect(response.statusCode).toBe(400);
    expect(json(response).error).toBe('INVALID_ARGUMENT');
    expect(json(response).message).toMatch(/at least 12 characters/);
  });

  it('will not let a machine credential change "its" password', async () => {
    const response = await call('POST', '/v1/ns/acme/users/change-password', {
      key: adminKey,
      body: { currentPassword: PASSWORD, newPassword: 'another-fine-passphrase' },
    });

    expect(response.statusCode).toBe(401);
    expect(json(response).error).toBe('not_a_user_session');
  });
});
