import { Body, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, Put, Query } from '@nestjs/common';
import { ErrorCode, RESOURCE_ACCESS, RESOURCE_TYPES, Scope, type Principal } from '@node-flow-dev/core';
import { ResourceGrantRepository, SUBJECT_TYPES } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Fine-grained permissions: who has which access to which workflow or task
 * definition, beyond their namespace-wide scopes. Administrators only — a
 * grant is a way around scopes, so managing grants is as sensitive as managing
 * scopes.
 */

const grantSchema = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  resourceType: z.enum(RESOURCE_TYPES as [string, ...string[]]),
  resource: z.string().min(1).max(210),
  /** The full access list; an empty list removes the grant. */
  access: z.array(z.enum(RESOURCE_ACCESS as [string, ...string[]])).max(4),
});

const listQuery = z.object({
  resourceType: z.enum(RESOURCE_TYPES as [string, ...string[]]).optional(),
  resource: z.string().max(210).optional(),
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.string().uuid().optional(),
});

@Controller('ns/:ns/permissions')
export class PermissionsController {
  constructor(private readonly grants: ResourceGrantRepository) {}

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'List resource grants, for one resource or one subject', tags: ['permissions'] })
  async list(@CurrentPrincipal() principal: Principal, @Query(zodBody(listQuery)) query: z.infer<typeof listQuery>) {
    return { grants: await this.grants.list(principal.namespaceId, query as never) };
  }

  @Audited('permission', 'put')
  @Put()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Grant a user, group or application access to a resource',
    description:
      'Replaces that subject’s access to that target. `resource` is a name, a prefix ending in `*`, `tag:key:value`, ' +
      '`tag:key:*` or `*`. Any access implies READ. An empty `access` list removes the grant.',
    tags: ['permissions'],
    body: grantSchema,
  })
  async put(@CurrentPrincipal() principal: Principal, @Body(zodBody(grantSchema)) body: z.infer<typeof grantSchema>) {
    const grant = await this.grants.put(principal.namespaceId, body as never, principal.name);
    return grant ?? { removed: true };
  }

  @Audited('permission', 'delete')
  @Delete(':id')
  @HttpCode(204)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Remove a resource grant', tags: ['permissions'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    if (!(await this.grants.delete(principal.namespaceId, id))) {
      throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no grant ${id}` });
    }
  }
}

@Module({ controllers: [PermissionsController] })
export class PermissionsModule {}
