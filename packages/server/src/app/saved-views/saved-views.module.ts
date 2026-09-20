import { Body, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ErrorCode, Scope, hasScope, type JsonValue, type Principal } from '@node-flow-dev/core';
import { SavedViewRepository, type SavedView } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Saved views: a named search with its columns, personal or shared with the
 * namespace. Only the owner changes a view; an administrator may delete any.
 */

const PAGES = ['executions'] as const;

const listQuery = z.object({ page: z.enum(PAGES) });

const createSchema = z.object({
  page: z.enum(PAGES),
  name: z.string().min(1).max(100),
  state: z.record(z.string(), z.unknown()),
  shared: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  shared: z.boolean().optional(),
});

const notFound = (id: string) => new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no saved view ${id}` });

@Controller('ns/:ns/saved-views')
export class SavedViewController {
  constructor(private readonly views: SavedViewRepository) {}

  @Get()
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'List your saved views and the namespace’s shared ones', tags: ['saved-views'] })
  async list(@CurrentPrincipal() principal: Principal, @Query(zodBody(listQuery)) query: z.infer<typeof listQuery>) {
    const views = await this.views.list(principal.namespaceId, query.page, owner(principal));
    return { views: views.map((view) => present(view, principal)) };
  }

  @Post()
  @HttpCode(201)
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Save a view', tags: ['saved-views'], body: createSchema })
  async create(@CurrentPrincipal() principal: Principal, @Body(zodBody(createSchema)) body: z.infer<typeof createSchema>) {
    const view = await this.views.create(principal.namespaceId, owner(principal), {
      page: body.page,
      name: body.name,
      state: body.state as Record<string, JsonValue>,
      shared: body.shared,
    });
    return present(view, principal);
  }

  @Put(':id')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Change one of your saved views', tags: ['saved-views'], body: updateSchema })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(updateSchema)) body: z.infer<typeof updateSchema>
  ) {
    const view = await this.views.update(principal.namespaceId, owner(principal), id, {
      name: body.name,
      state: body.state as Record<string, JsonValue> | undefined,
      shared: body.shared,
    });
    if (!view) throw notFound(id);
    return present(view, principal);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Delete a saved view', description: 'Your own, or any view for an administrator.', tags: ['saved-views'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const deleted = await this.views.delete(principal.namespaceId, owner(principal), id, hasScope(principal, Scope.ADMIN));
    if (!deleted) throw notFound(id);
  }
}

function owner(principal: Principal) {
  return { id: `${principal.type}:${principal.id}`, name: principal.name };
}

function present(view: SavedView, principal: Principal) {
  return {
    id: view.id,
    page: view.page,
    name: view.name,
    state: view.state,
    shared: view.shared,
    ownerName: view.ownerName,
    mine: view.ownerId === owner(principal).id,
    updatedAt: view.updatedAt,
  };
}

@Module({ controllers: [SavedViewController] })
export class SavedViewsModule {}
