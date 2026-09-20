import { Body, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ErrorCode, InvalidArgumentError, Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import { SchemaRegistryRepository, SchemaValidator } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

const registerSchema = z.object({
  name: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()),
  description: z.string().max(1000).optional(),
});

const validateSchema = z.object({
  payload: z.unknown(),
});

/**
 * The schema registry: contracts written once and referenced by name.
 *
 * A definition's `inputSchema` or `outputSchema` may be `{ "name": "order" }`
 * (latest) or `{ "name": "order", "version": 2 }` (pinned) instead of an inline
 * JSON Schema. Registering always creates a new version.
 */
@Controller('ns/:ns/schemas')
export class SchemaController {
  constructor(
    private readonly registry: SchemaRegistryRepository,
    private readonly validator: SchemaValidator
  ) {}

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List schemas at their newest version', tags: ['schemas'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { schemas: await this.registry.list(principal.namespaceId) };
  }

  @Audited('schema', 'register')
  @Post()
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Register a new version of a schema',
    description: 'Versions are immutable. The schema must be a JSON Schema that compiles.',
    tags: ['schemas'],
    body: registerSchema,
  })
  async register(@CurrentPrincipal() principal: Principal, @Body(zodBody(registerSchema)) body: z.infer<typeof registerSchema>) {
    if (!this.validator.isCompilable(body.data)) {
      throw new InvalidArgumentError('data is not a valid JSON Schema');
    }
    return this.registry.register(principal.namespaceId, {
      name: body.name,
      data: body.data as Record<string, JsonValue>,
      description: body.description,
      createdBy: principal.id,
    });
  }

  @Get(':name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Every version of a schema, newest first', tags: ['schemas'] })
  async versions(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const versions = await this.registry.versions(principal.namespaceId, name);
    if (versions.length === 0) throw notFound(name);
    return { versions };
  }

  /** Checks a sample payload — "would this have passed?" without running anything. */
  @Post(':name/validate')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Validate a payload against a schema version', tags: ['schemas'], body: validateSchema })
  async validate(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Query('version') version: string | undefined,
    @Body(zodBody(validateSchema)) body: z.infer<typeof validateSchema>
  ) {
    const schema = await this.registry.get(principal.namespaceId, name, version ? Number(version) : undefined);
    if (!schema) throw notFound(name);
    const violations = this.validator.check(
      { name, inputSchema: schema.data },
      'input',
      (body.payload ?? {}) as Record<string, JsonValue>
    );
    return { valid: violations.length === 0, version: schema.version, violations };
  }

  @Audited('schema', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete one version of a schema', tags: ['schemas'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string, @Query('version') version?: string) {
    const parsed = z.coerce.number().int().positive().safeParse(version);
    if (!parsed.success) throw new InvalidArgumentError('version is required to delete a schema');
    if (!(await this.registry.deleteVersion(principal.namespaceId, name, parsed.data))) throw notFound(name);
  }
}

function notFound(name: string) {
  return new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no schema "${name}"` });
}

@Module({ controllers: [SchemaController] })
export class SchemasModule {}
