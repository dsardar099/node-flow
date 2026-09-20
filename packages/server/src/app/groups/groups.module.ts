import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ErrorCode, Scope, type Principal } from '@node-flow-dev/core';
import { GroupRepository, type Group } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { Audited } from '../common/audit.interceptor.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Groups — named sets of people, carrying scopes.
 *
 * One concept rather than separate roles and groups: a group that carries
 * scopes *is* a role with members, and keeping them apart means maintaining a
 * mapping between the two for no gain in expressiveness.
 *
 * Every route needs `admin`, because editing a group's scopes grants
 * permissions to everyone in it — this is the privilege-escalation surface of
 * the whole authorization model.
 */

const createSchema = z.object({
  name: z.string().min(1).max(127),
  description: z.string().max(1000).optional(),
  scopes: z.array(z.string()).max(100).optional(),
  tagGrants: z.array(z.string()).max(100).optional(),
});

const scopesSchema = z.object({ scopes: z.array(z.string()).max(100) });
const memberSchema = z.object({ userId: z.string().uuid() });
const tagGrantsSchema = z.object({ tagGrants: z.array(z.string()).max(100) });

@Controller('ns/:ns/groups')
export class GroupController {
  constructor(private readonly groups: GroupRepository) {}

  @Audited('group', 'create')
  @Post()
  @HttpCode(201)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Create a group', tags: ['groups'], body: createSchema })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(createSchema)) body: z.infer<typeof createSchema>
  ) {
    return present(
      await this.groups.create({
        namespaceId: principal.namespaceId,
        name: body.name,
        description: body.description,
        scopes: body.scopes,
        tagGrants: body.tagGrants,
      })
    );
  }

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'List groups', tags: ['groups'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { groups: (await this.groups.list(principal.namespaceId)).map(present) };
  }

  @Get(':name')
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Fetch a group and its members', tags: ['groups'] })
  async get(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const group = await this.groups.findByName(principal.namespaceId, name);
    if (!group) throw notFound(name);

    return {
      ...present(group),
      members: await this.groups.members(principal.namespaceId, name),
    };
  }

  @Audited('group', 'scopes-set')
  @Put(':name/scopes')
  @HttpCode(200)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Replace a group’s scopes',
    description:
      'Takes effect for every member on their next request, since a principal ' +
      'resolves its scopes each time rather than caching them into a session.',
    tags: ['groups'],
    body: scopesSchema,
  })
  async setScopes(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(scopesSchema)) body: z.infer<typeof scopesSchema>
  ) {
    return present(await this.groups.setScopes(principal.namespaceId, name, body.scopes));
  }

  @Put(':name/tag-grants')
  @HttpCode(200)
  @RequireScopes(Scope.ADMIN)
  @Audited('group', 'tag-grants-set')
  @ApiRoute({
    summary: 'Replace the tag patterns this group’s members may reach',
    description:
      'Tags restrict, they never grant: an untagged resource is governed by ' +
      'scopes alone, and a tagged one additionally needs a matching grant. ' +
      'Patterns match literally or by trailing wildcard, exactly like scopes.',
    tags: ['groups'],
    body: tagGrantsSchema,
  })
  async setTagGrants(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(tagGrantsSchema)) body: z.infer<typeof tagGrantsSchema>
  ) {
    return present(await this.groups.setTagGrants(principal.namespaceId, name, body.tagGrants));
  }

  @Audited('group', 'member-add')
  @Post(':name/members')
  @HttpCode(204)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Add someone to a group', tags: ['groups'], body: memberSchema })
  async addMember(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(memberSchema)) body: z.infer<typeof memberSchema>
  ) {
    await this.groups.addMember(principal.namespaceId, name, body.userId, principal.id);
  }

  @Audited('group', 'member-remove')
  @Delete(':name/members/:userId')
  @HttpCode(204)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Remove someone from a group', tags: ['groups'] })
  async removeMember(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Param('userId') userId: string
  ) {
    if (!(await this.groups.removeMember(principal.namespaceId, name, userId))) {
      throw notFound(name);
    }
  }

  @Audited('group', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Delete a group', tags: ['groups'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    if (!(await this.groups.delete(principal.namespaceId, name))) throw notFound(name);
  }
}

function notFound(name: string): NotFoundException {
  return new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no group "${name}"` });
}

function present(group: Group) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    scopes: group.scopes,
    tagGrants: group.tagGrants,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

@Module({ controllers: [GroupController] })
export class GroupsModule {}
