import { Injectable, RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { createHash } from 'node:crypto';
import { z, type ZodType } from 'zod';
import { PUBLIC_ROUTE, REQUIRED_SCOPES } from '../auth/auth.decorators.js';
import { API_ROUTE, type ApiRouteSpec } from './api-route.decorator.js';
import { UNPREFIXED } from '../configure-app.js';

/**
 * Builds the OpenAPI 3.1 document by walking the real router.
 *
 * Two decisions carry this, and both are about drift:
 *
 * **Routes come from Nest's own metadata, not a hand-written list.** A spec
 * maintained by hand is wrong the first time someone adds an endpoint and
 * forgets, and the failure is invisible — the API works, the document just
 * quietly lies. Walking the controllers means a route cannot be missing.
 *
 * **Schemas come from the same zod objects the pipes validate with**, via
 * `z.toJSONSchema()`. Zod 4 emits JSON Schema 2020-12, which is exactly the
 * dialect OpenAPI 3.1 uses, so no translation layer sits between the two to be
 * wrong. This is why `@nestjs/swagger` is not used: it would need
 * `class-validator` DTOs restating shapes that `core` already defines.
 *
 * **Security requirements come from the guard's own metadata.** The scopes
 * documented per endpoint are read from the same `REQUIRED_SCOPES` the guard
 * enforces, so the document cannot claim a permission the server does not
 * actually require.
 */

interface DiscoveredRoute {
  method: string;
  path: string;
  /** `ExecutionController.replay`, the source of the operation id and default tag. */
  controller: string;
  handler: string;
  spec?: ApiRouteSpec;
  scopes: string[];
  isPublic: boolean;
  status?: number;
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.OPTIONS]: 'options',
  [RequestMethod.HEAD]: 'head',
};

@Injectable()
export class OpenApiService {
  private cached?: Record<string, unknown>;
  /** Recursive definitions hoisted out of individual schemas, by content-derived name. */
  private readonly sharedSchemas: Record<string, unknown> = {};

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector
  ) {}

  /**
   * The document, built once.
   *
   * Routes cannot change after boot, so rebuilding per request would burn CPU
   * on the one endpoint most likely to be hit by a docs page in a loop.
   */
  document(globalPrefix = 'v1'): Record<string, unknown> {
    this.cached ??= this.build(globalPrefix);
    return this.cached;
  }

  private build(globalPrefix: string): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    const operationIds = new Set<string>();

    for (const route of this.routes(globalPrefix)) {
      const path = (paths[route.path] ??= {});
      // Generated clients name their methods after these: `executions.replay(...)`
      // rather than `v1NsNsExecutionsIdReplayPost`. Unique, because a generator
      // silently renames the second of two clashing operations.
      const base = `${lowerFirst(route.controller.replace(/Controller$/, ''))}_${route.handler}`;
      let operationId = base;
      for (let n = 2; operationIds.has(operationId); n++) operationId = `${base}${n}`;
      operationIds.add(operationId);
      path[route.method] = { operationId, ...this.operation(route) };
    }

    return {
      openapi: '3.1.0',
      info: {
        title: 'node-flow',
        version: '1',
        description:
          'Workflow orchestration. Definitions are declarative JSON; workers are ' +
          'language-agnostic and lease tasks from a queue.',
      },
      components: {
        ...(Object.keys(this.sharedSchemas).length ? { schemas: this.sharedSchemas } : {}),
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'Long-lived, revocable, scoped. For CLIs and CI.',
          },
          bearer: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Short-lived token from POST /v1/auth/token. For worker fleets: a ' +
              'captured token is useless within the hour.',
          },
        },
      },
      // Applied to every operation; `@Public()` routes override with `[]`.
      security: [{ apiKey: [] }, { bearer: [] }],
      paths,
    };
  }

  private routes(globalPrefix: string): DiscoveredRoute[] {
    const found: DiscoveredRoute[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';

      for (const methodName of this.scanner.getAllMethodNames(
        Object.getPrototypeOf(instance)
      )) {
        const handler = (instance as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;

        const methodCode = Reflect.getMetadata(METHOD_METADATA, handler);
        if (methodCode === undefined) continue; // Not a route handler.

        const method = METHOD_NAMES[methodCode];
        if (!method) continue;

        const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) ?? '';

        // One handler may answer several paths — `@Post(['a', 'a/:b'])` — and
        // each is its own operation. Assuming a single string here silently
        // produced a broken document the moment one appeared.
        for (const path of Array.isArray(handlerPath) ? handlerPath : [handlerPath]) {
          found.push({
            method,
            controller: metatype.name,
            handler: methodName,
            // A controller the router serves unprefixed is documented unprefixed.
            path: this.joinPath(UNPREFIXED.some((root) => String(controllerPath).startsWith(root)) ? '' : globalPrefix, controllerPath, String(path)),
            spec: this.reflector.get<ApiRouteSpec>(API_ROUTE, handler),
            scopes: this.reflector.get<string[]>(REQUIRED_SCOPES, handler) ?? [],
            isPublic: this.reflector.get<boolean>(PUBLIC_ROUTE, handler) ?? false,
            status: Reflect.getMetadata(HTTP_CODE_METADATA, handler),
          });
        }
      }
    }

    return found.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  }

  private operation(route: DiscoveredRoute): Record<string, unknown> {
    const spec = route.spec;
    const status = spec?.status ?? route.status ?? (route.method === 'post' ? 201 : 200);

    return {
      summary: spec?.summary ?? `${route.method.toUpperCase()} ${route.path}`,
      ...(spec?.description ? { description: spec.description } : {}),
      // Every operation is tagged, so generators group it into a class rather than a catch-all.
      tags: spec?.tags ?? [kebab(route.controller.replace(/Controller$/, ''))],
      // Documented from the guard's own metadata rather than restated, so this
      // cannot claim a permission the server does not require.
      ...(route.scopes.length > 0
        ? { 'x-required-scopes': route.scopes }
        : {}),
      ...(route.isPublic ? { security: [] } : {}),
      parameters: this.parameters(route),
      ...(spec?.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: this.jsonSchema(spec.body) } },
            },
          }
        : {}),
      responses: {
        [String(status)]: {
          description: 'Success',
          // A route that declares no response shape still returns JSON; saying
          // nothing made generated clients throw the body away.
          ...(status === 204
            ? {}
            : { content: { 'application/json': { schema: spec?.response ? this.jsonSchema(spec.response) : {} } } }),
        },
        ...(route.isPublic
          ? {}
          : {
              '401': { description: 'No or invalid credentials' },
              '403': { description: 'Authenticated, but missing a required scope' },
            }),
      },
    };
  }

  /** Path parameters, derived from the `:name` segments actually in the route. */
  private parameters(route: DiscoveredRoute): unknown[] {
    const parameters = [...route.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      ...(name === 'ns'
        ? {
            description:
              'Namespace slug. Must match the namespace of the credential, or the ' +
              'request is refused — it does not select one.',
          }
        : {}),
    }));

    if (route.spec?.query) {
      const schema = this.jsonSchema(route.spec.query) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        parameters.push({
          name,
          in: 'query',
          required: schema.required?.includes(name) ?? false,
          schema: property as { type: string },
        });
      }
    }

    return parameters;
  }

  /**
   * Converts a zod schema to JSON Schema.
   *
   * `io: 'input'` matters: schemas here have defaults and coercions, and the
   * *input* view is what a client must send. The output view would document
   * fields as required that the server happily fills in.
   */
  private jsonSchema(schema: ZodType): unknown {
    const generated = z.toJSONSchema(schema, {
      io: 'input',
      target: 'draft-2020-12',
      /**
       * A `Date` is a string on the wire, and JSON Schema can say so.
       *
       * Zod refuses to represent `z.date()` and throws "Date cannot be
       * represented in JSON Schema", which would take the whole document down
       * with a 500 — one schedule's `startAt` is enough. That is the right
       * default for zod, which cannot know how the value is transported, but
       * here we do know: every one of these arrives as JSON, so a date always
       * reached the server as a string and `z.coerce.date()` parsed it.
       * `date-time` is what a client should send and what every generator
       * already understands.
       */
      override: (context) => {
        if (context.zodSchema._zod.def.type === 'date') {
          for (const key of Object.keys(context.jsonSchema)) {
            delete (context.jsonSchema as Record<string, unknown>)[key];
          }
          Object.assign(context.jsonSchema, { type: 'string', format: 'date-time' });
        }
      },
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    // OpenAPI supplies the dialect at document level; repeating it per schema
    // is noise that some tooling rejects.
    delete generated['$schema'];
    return this.hoistDefinitions(forGenerators(generated) as Record<string, unknown>);
  }

  /**
   * Moves a schema's local `$defs` into `components/schemas`.
   *
   * Zod emits recursive types — a JSON value, a task that nests tasks — as
   * `$defs` referenced by `#/$defs/__schema0`. Inside an OpenAPI document that
   * pointer resolves against the *document* root, where no `$defs` exists, so
   * every generator failed on it. Each definition gets a name derived from its
   * content, which also lets two routes sharing a type share one component.
   */
  private hoistDefinitions(schema: Record<string, unknown>): Record<string, unknown> {
    const defs = schema['$defs'] as Record<string, unknown> | undefined;
    if (!defs) return schema;
    delete schema['$defs'];

    // Names first, so definitions referring to each other rewrite consistently.
    const renamed = new Map<string, string>();
    for (const [local, body] of Object.entries(defs)) {
      const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 10);
      renamed.set(local, `Shared_${digest}`);
    }
    // A union of every JSON type is "any JSON value", which OpenAPI spells `{}`.
    // Kept as a union, Java generators emitted code that does not compile.
    const anyJson = new Set(Object.entries(defs).filter(([, body]) => isAnyJson(body)).map(([local]) => local));
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!value || typeof value !== 'object') return value;
      const ref = (value as Record<string, unknown>)['$ref'];
      if (typeof ref === 'string' && anyJson.has(ref.slice('#/$defs/'.length))) return {};
      if (isAnyJson(value)) return {};
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => {
          if (key === '$ref' && typeof inner === 'string' && inner.startsWith('#/$defs/')) {
            const name = renamed.get(inner.slice('#/$defs/'.length));
            return [key, name ? `#/components/schemas/${name}` : inner];
          }
          return [key, rewrite(inner)];
        })
      );
    };
    for (const [local, body] of Object.entries(defs)) {
      if (!anyJson.has(local)) this.sharedSchemas[renamed.get(local) as string] ??= rewrite(body);
    }
    return rewrite(schema) as Record<string, unknown>;
  }

  /** Nest paths are `:name`; OpenAPI wants `{name}`. */
  private joinPath(...segments: string[]): string {
    const joined = segments
      .flatMap((segment) => segment.split('/'))
      .filter((segment) => segment !== '')
      .join('/');

    return `/${joined}`.replace(/:(\w+)/g, '{$1}');
  }
}

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Formats whose meaning every client already knows. */
const STANDARD_FORMATS = new Set(['date-time', 'date', 'time', 'email', 'uuid', 'uri', 'ipv4', 'ipv6', 'duration']);

/**
 * Reshapes zod's JSON Schema into what client generators read correctly.
 *
 * Drops the regular expression zod emits beside a standard `format`.
 *
 * The format carries the meaning; the pattern is zod's implementation of it,
 * hundreds of characters long, and generators trip over it — the Python client
 * emitted a validator for a datetime that referenced an import it never wrote,
 * so the package would not even import.
 */
function forGenerators(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forGenerators);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const drop = typeof record['format'] === 'string' && STANDARD_FORMATS.has(record['format']) && typeof record['pattern'] === 'string';
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !(drop && key === 'pattern'))
      .map(([key, inner]) => [key, forGenerators(inner)])
  );
  // Zod bounds every integer by JavaScript's safe range; to a Go or Java client
  // that reads as a 64-bit constant compared against a 32-bit field, which does
  // not compile. The range is JavaScript's, not the API's.
  if (out['maximum'] === Number.MAX_SAFE_INTEGER) delete out['maximum'];
  if (out['minimum'] === Number.MIN_SAFE_INTEGER) delete out['minimum'];
  // A numeric exclusive bound is OpenAPI 3.1; most generators still read 3.0's
  // boolean form. For integers the inclusive equivalent is exact.
  if (out['type'] === 'integer' && typeof out['exclusiveMinimum'] === 'number') {
    out['minimum'] = (out['exclusiveMinimum'] as number) + 1;
    delete out['exclusiveMinimum'];
  }
  return out;
}

/** Whether a schema is a union of every JSON type — `JsonValue` — and so means "anything". */
function isAnyJson(schema: unknown): boolean {
  const options = (schema as { anyOf?: unknown[] } | undefined)?.anyOf;
  if (!Array.isArray(options)) return false;
  const types = new Set(options.map((option) => (option as { type?: string }).type));
  return ['string', 'boolean', 'null', 'array', 'object'].every((t) => types.has(t)) && (types.has('number') || types.has('integer'));
}
