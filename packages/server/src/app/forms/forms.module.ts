import { Body, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ErrorCode, InvalidArgumentError, Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import { FormTemplateRepository, SchemaValidator } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

const registerSchema = z.object({
  name: z.string().min(1).max(200),
  schema: z.record(z.string(), z.unknown()),
  description: z.string().max(1000).optional(),
});

/**
 * User forms for human tasks.
 *
 * A form is a JSON Schema object whose properties are the fields a person
 * fills in, ordered by `ui:order`. A HUMAN task uses one with
 * `"form": { "template": "refund_review" }` (latest) or with a `version`.
 */
@Controller('ns/:ns/forms')
export class FormController {
  constructor(
    private readonly forms: FormTemplateRepository,
    private readonly validator: SchemaValidator
  ) {}

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List user forms at their newest version', tags: ['forms'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { forms: await this.forms.list(principal.namespaceId) };
  }

  @Audited('form', 'register')
  @Post()
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Save a new version of a user form',
    description: 'Open tasks keep the version they were created with.',
    tags: ['forms'],
    body: registerSchema,
  })
  async register(@CurrentPrincipal() principal: Principal, @Body(zodBody(registerSchema)) body: z.infer<typeof registerSchema>) {
    if (!this.validator.isCompilable({ type: 'object', ...body.schema })) {
      throw new InvalidArgumentError('schema is not a valid JSON Schema');
    }
    return this.forms.register(principal.namespaceId, {
      name: body.name,
      schema: body.schema as Record<string, JsonValue>,
      description: body.description,
      createdBy: principal.id,
    });
  }

  @Get(':name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Every version of a user form, newest first', tags: ['forms'] })
  async versions(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const versions = await this.forms.versions(principal.namespaceId, name);
    if (versions.length === 0) {
      throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no form "${name}"` });
    }
    return { versions };
  }

  @Audited('form', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete one version of a user form', tags: ['forms'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string, @Query('version') version?: string) {
    const parsed = z.coerce.number().int().positive().safeParse(version);
    if (!parsed.success) throw new InvalidArgumentError('version is required to delete a form');
    if (!(await this.forms.deleteVersion(principal.namespaceId, name, parsed.data))) {
      throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no form "${name}" version ${parsed.data}` });
    }
  }
}

@Module({ controllers: [FormController] })
export class FormsModule {}
