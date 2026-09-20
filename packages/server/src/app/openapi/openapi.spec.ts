import { METHOD_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { API_ROUTE } from './api-route.decorator.js';
import { Scope } from '@node-flow-dev/core';
import { createDatabase, migrate } from '@node-flow-dev/store';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApp, createAdapter } from '../configure-app.js';

/**
 * The OpenAPI document.
 *
 * A generated spec is only worth having if it cannot drift from the server, so
 * these tests are about that property rather than about the document's
 * contents: every real route appears, the schemas are the ones the pipes
 * validate with, and the documented scopes are the ones the guard enforces.
 */

let container: StartedPostgreSqlContainer;
let app: NestFastifyApplication;
let document: Record<string, unknown>;

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

/** Narrows an unknown JSON node. Casting from `unknown` is always sound. */
const obj = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const arr = (value: unknown): Record<string, unknown>[] => value as Record<string, unknown>[];

/**
 * One operation from the document.
 *
 * Throws rather than returning undefined, so a missing route fails with the
 * path that is missing instead of a downstream "cannot read property of
 * undefined" that says nothing.
 */
function at(path: string, method = 'get'): Record<string, unknown> {
  const operation = obj(obj(document['paths'])[path])?.[method];
  if (!operation) throw new Error(`no ${method.toUpperCase()} ${path} in the document`);
  return obj(operation);
}

/** The request body schema of an operation. */
const bodySchema = (operation: Record<string, unknown>): Record<string, unknown> =>
  obj(obj(obj(obj(operation['requestBody'])['content'])['application/json'])['schema']);

beforeAll(async () => {
  ensureDockerHost();
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('nodeflow_openapi')
    .withUsername('nodeflow')
    .withPassword('nodeflow')
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off'])
    .start();

  const seed = createDatabase({ url: container.getConnectionUri() });
  await migrate(seed);
  await seed.destroy();

  Object.assign(process.env, {
    DATABASE_URL: container.getConnectionUri(),
    NODE_FLOW_JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    // No runners: this suite only reads the document.
    NODE_FLOW_ROLES: 'api',
    NODE_ENV: 'test',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);

  const response = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
  // Checked here, not left to the tests below. A failed generation still
  // returns JSON — an error envelope — so `JSON.parse` succeeds and every test
  // then reads fields off the wrong object. A single filtered run passed that
  // way while the document was a 500.
  if (response.statusCode !== 200) {
    throw new Error(`the document did not generate: ${response.statusCode} ${response.body}`);
  }
  document = JSON.parse(response.body);
}, 240_000);

describe('generation', () => {
  it('produces a document at all', () => {
    expect(Object.keys(obj(document['paths'])).length).toBeGreaterThan(50);
  });
});

afterAll(async () => {
  await app?.close();
  await container?.stop();
}, 60_000);

describe('the document', () => {
  it('is served without credentials', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(response.statusCode).toBe(200);
  });

  it('declares OpenAPI 3.1', () => {
    expect(document['openapi']).toBe('3.1.0');
  });

  it('describes both authentication schemes', () => {
    const schemes = obj(obj(document['components'])['securitySchemes']);
    expect(Object.keys(schemes)).toEqual(['apiKey', 'bearer']);
  });
});

describe('routes', () => {
  // The failure a hand-written spec has: an endpoint is added, the document is
  // not, and nothing notices because the API still works.
  it('includes every controller route, derived from the router', () => {
    const paths = Object.keys(obj(document['paths']));

    for (const expected of [
      '/v1/auth/token',
      '/v1/auth/whoami',
      '/v1/health/ready',
      '/v1/ns/{ns}/metadata/workflows',
      '/v1/ns/{ns}/executions/{name}',
      '/v1/ns/{ns}/executions/{id}/terminate',
      '/v1/ns/{ns}/queues/{queue}/lease',
      '/v1/ns/{ns}/tasks/{taskId}/report',
    ]) {
      expect(paths, expected).toContain(expected);
    }
  });

  it('converts Nest path params to OpenAPI form', () => {
    expect(Object.keys(obj(document['paths'])).some((p) => p.includes(':'))).toBe(false);
  });

  it('declares path parameters for every placeholder', () => {
    const names = arr(at('/v1/ns/{ns}/executions/{id}/terminate', 'post')['parameters']).map(
      (p) => p['name']
    );

    expect(names).toContain('ns');
    expect(names).toContain('id');
  });

  it('documents query parameters', () => {
    const names = arr(at('/v1/ns/{ns}/metadata/workflows/{name}')['parameters'])
      .filter((p) => p['in'] === 'query')
      .map((p) => p['name']);

    expect(names).toContain('version');
  });
});

describe('schemas', () => {
  // Generated from the same zod objects the pipes use, so the document cannot
  // describe a shape the server would reject.
  it('emits a request body schema from the route’s zod schema', () => {
    const schema = bodySchema(at('/v1/ns/{ns}/queues/{queue}/lease', 'post'));

    expect(Object.keys(obj(schema['properties']))).toEqual(
      expect.arrayContaining(['workerId', 'count', 'leaseSeconds'])
    );
    expect(schema['required']).toEqual(['workerId']);
  });

  /**
   * The same property as the test above, asserted over every route rather than
   * one.
   *
   * A spot check cannot find this class of gap, and did not: `@ApiRoute` takes
   * the zod schema separately from the `@Body(zodBody(…))` pipe that enforces
   * it, so a handler can validate a body it never declares. The document then
   * describes an endpoint as taking nothing, and the generated Python, Go, Java
   * and TypeScript clients expose it with no body parameter — an endpoint you
   * cannot call from the client the project ships.
   *
   * Nothing about it is visible from either side: the server accepts the
   * request, the document is valid, and the route appears. Only the pairing is
   * wrong.
   */
  it('documents a request body for every route that validates one', () => {
    const missing: string[] = [];

    for (const wrapper of app.get(DiscoveryService).getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const prototype = Object.getPrototypeOf(instance);
      for (const methodName of app.get(MetadataScanner).getAllMethodNames(prototype)) {
        const handler = (instance as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;

        // Nest records each parameter's pipes under `<paramtype>:<index>`.
        // Body is paramtype 3; the pipe list is what actually runs.
        const args: Record<string, { pipes?: unknown[] }> =
          Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, methodName) ?? {};
        const validatesBody = Object.entries(args).some(
          ([key, arg]) =>
            key.startsWith(`${RouteParamtypes.BODY}:`) &&
            (arg.pipes ?? []).some((pipe) => pipe instanceof ZodValidationPipe)
        );
        if (!validatesBody) continue;

        const spec = app.get(Reflector).get<{ body?: unknown }>(API_ROUTE, handler);
        if (!spec?.body) missing.push(`${metatype.name}.${methodName}`);
      }
    }

    expect(missing, `these validate a request body the document does not describe`).toEqual([]);
  });

  /**
   * A date is a string with a format, not a reason to fail.
   *
   * Zod refuses to represent `z.date()` and throws, which does not fail the one
   * schema — it takes the entire document down with a 500. One schedule's
   * `startAt` was enough. The wire value really is an ISO string, so saying so
   * is both accurate and the only answer a client generator can use.
   */
  it('represents a date as a date-time string', () => {
    const schema = bodySchema(at('/v1/ns/{ns}/schedules', 'post'));
    expect(obj(obj(schema['properties'])['startAt'])).toMatchObject({
      type: 'string',
      format: 'date-time',
    });
  });

  // `io: 'input'` matters: `count` has a default, so it is optional to send but
  // always present on the way out. Documenting the output view would tell
  // clients to send a field the server fills in.
  it('documents the input view, not the output view', () => {
    const schema = bodySchema(at('/v1/ns/{ns}/queues/{queue}/lease', 'post'));
    expect(schema['required']).not.toContain('count');
  });

  it('carries the full workflow DSL schema, not a restatement of it', () => {
    const schema = bodySchema(at('/v1/ns/{ns}/metadata/workflows', 'post'));

    // These come from `core`'s workflowDefinitionSchema; nothing in the server
    // declares them.
    expect(Object.keys(obj(schema['properties']))).toEqual(
      expect.arrayContaining(['name', 'version', 'tasks'])
    );
  });

  it('strips the per-schema $schema key', () => {
    expect(bodySchema(at('/v1/auth/token', 'post'))['$schema']).toBeUndefined();
  });
});

describe('security', () => {
  // Read from the same metadata the guard enforces, so the document cannot
  // claim a permission the server does not actually require.
  it('documents required scopes from the guard’s own metadata', () => {
    expect(at('/v1/ns/{ns}/executions/{id}/terminate', 'post')['x-required-scopes']).toEqual([
      Scope.EXECUTIONS_WRITE,
    ]);
  });

  it('marks public routes as needing no credentials', () => {
    expect(at('/v1/health/live')['security']).toEqual([]);
    expect(at('/v1/auth/token', 'post')['security']).toEqual([]);
  });

  it('leaves protected routes on the document-level requirement', () => {
    expect(at('/v1/auth/whoami')['security']).toBeUndefined();
    expect(document['security']).toEqual([{ apiKey: [] }, { bearer: [] }]);
  });

  it('documents 401 and 403 on protected routes only', () => {
    expect(Object.keys(obj(at('/v1/auth/whoami')['responses']))).toContain('401');
    expect(Object.keys(obj(at('/v1/health/live')['responses']))).not.toContain('401');
  });

  it('uses the handler’s declared status code', () => {
    // @HttpCode(202) on the operator actions.
    expect(
      Object.keys(obj(at('/v1/ns/{ns}/executions/{id}/pause', 'post')['responses']))
    ).toContain('202');
  });
});

// Generators resolve every `$ref` against the document root. A schema-local
// `#/$defs/...` pointer — what zod emits for recursive types — made every one
// of them fail, so each must point somewhere that exists.
describe('references', () => {
  it('resolves every $ref within the document', () => {
    const refs: string[] = [];
    const collect = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (!value || typeof value !== 'object') return;
      for (const [key, inner] of Object.entries(value)) {
        if (key === '$ref' && typeof inner === 'string') refs.push(inner);
        else collect(inner);
      }
    };
    collect(document);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      expect(ref, ref).toMatch(/^#\/components\/schemas\//);
      const target = ref.slice(2).split('/').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], document);
      expect(target, `${ref} resolves`).toBeDefined();
    }
  });
});

describe('operation ids', () => {
  it('gives every operation a unique id and a tag, for generated clients', () => {
    const operations = Object.values(document['paths'] as Record<string, Record<string, { operationId?: string; tags?: string[] }>>).flatMap((methods) => Object.values(methods));
    const ids = operations.map((o) => o.operationId);
    expect(ids.every((id) => typeof id === 'string' && /^[a-z][A-Za-z0-9]*_[A-Za-z0-9]+$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(operations.every((o) => (o.tags ?? []).length > 0)).toBe(true);
  });
});

describe('formats', () => {
  it('describes standard formats by name alone, without zod’s regular expressions', () => {
    const offenders: string[] = [];
    const visit = (value: unknown, at: string) => {
      if (Array.isArray(value)) return value.forEach((v, i) => visit(v, `${at}/${i}`));
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record['format'] === 'string' && typeof record['pattern'] === 'string') offenders.push(at);
      for (const [key, inner] of Object.entries(record)) visit(inner, `${at}/${key}`);
    };
    visit(document, '#');
    expect(offenders).toEqual([]);
  });
});

describe('integer bounds', () => {
  it('carries no JavaScript safe-integer limits or 3.1-only exclusive bounds on integers', () => {
    const text = JSON.stringify(document);
    expect(text).not.toContain(String(Number.MAX_SAFE_INTEGER));
    const offenders: unknown[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (record['type'] === 'integer' && 'exclusiveMinimum' in record) offenders.push(record);
      Object.values(record).forEach(visit);
    };
    visit(document);
    expect(offenders).toEqual([]);
  });
});

describe('any JSON value', () => {
  it('is written as an empty schema, not a recursive union of every type', () => {
    const unions: unknown[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      const anyOf = (value as { anyOf?: { type?: string }[] }).anyOf;
      if (anyOf && ['string', 'boolean', 'null', 'array', 'object'].every((t) => anyOf.some((o) => o.type === t))) unions.push(value);
      Object.values(value).forEach(visit);
    };
    visit(document);
    expect(unions).toEqual([]);
  });
});

describe('routes with several paths', () => {
  it('documents each path of a handler that answers more than one', () => {
    const paths = Object.keys(document['paths'] as Record<string, unknown>);
    // The Conductor layer's execute route answers with and without a version.
    expect(paths).toContain('/conductor/api/workflow/execute/{name}');
    expect(paths).toContain('/conductor/api/workflow/execute/{name}/{version}');
  });
});
