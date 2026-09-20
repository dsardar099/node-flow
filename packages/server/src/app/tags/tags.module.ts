import { Controller, Get, Module } from '@nestjs/common';
import { Scope, tagMatches, type Principal } from '@node-flow-dev/core';
import { GroupRepository, MetadataRepository } from '@node-flow-dev/store';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * The tags dashboard: which tags are in use, what carries them, and who can
 * reach them.
 *
 * Tags restrict and grants open, and the two are set in different places — on
 * a workflow, and on a group. Neither screen alone answers "who can see
 * payroll?" or "does anything still use `team:legacy`?", so this puts both
 * sides of the relation in one response.
 *
 * Admin only: it lists every tagged workflow regardless of the caller's own
 * grants, which is exactly the disclosure tags exist to prevent for everyone
 * else.
 */
@Controller('ns/:ns/tags')
export class TagsController {
  constructor(
    private readonly metadata: MetadataRepository,
    private readonly groups: GroupRepository
  ) {}

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Tags in use, what carries them, and which groups can reach them', tags: ['tags'] })
  async overview(@CurrentPrincipal() principal: Principal) {
    const [usage, groups] = await Promise.all([
      this.metadata.tagUsage(principal.namespaceId),
      this.groups.list(principal.namespaceId),
    ]);

    const grants = groups.flatMap((group) =>
      (group.tagGrants ?? []).map((pattern) => ({ group: group.name, pattern }))
    );

    return {
      tags: usage.map(({ tag, workflows }) => ({
        tag,
        workflows,
        reachableBy: grants.filter((grant) => tagMatches(grant.pattern, tag)),
      })),
      // Every grant with what it currently opens — an empty `matches` is a
      // grant for something that no longer exists, or a typo.
      grants: grants.map((grant) => ({
        ...grant,
        matches: usage.filter(({ tag }) => tagMatches(grant.pattern, tag)).map(({ tag }) => tag),
      })),
    };
  }
}

@Module({ controllers: [TagsController] })
export class TagsModule {}
