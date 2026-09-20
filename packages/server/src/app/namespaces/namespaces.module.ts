import { Body, Controller, Get, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { ErrorCode, Scope, isValidScope, type Principal } from '@node-flow-dev/core';
import { IdentityRepository, NamespaceRepository } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Namespaces — creating and listing the tenants themselves.
 *
 * Every other route in the API is namespace-*scoped*: the slug is in the path,
 * the guard checks it against the credential, and a caller can only ever act
 * inside their own. These routes are the exception, which is why they need a
 * scope that `admin` deliberately does not satisfy — see `Scope.PLATFORM_ADMIN`.
 *
 * Creating a namespace optionally mints its first API key, because otherwise a
 * new tenant is unreachable: every credential belongs to a namespace, so the
 * first one has to be issued by whoever created it. That is the same
 * chicken-and-egg `nf bootstrap` solves at a terminal, solved here for a
 * platform team that provisions tenants from their own automation.
 *
 * **There is no delete.** A namespace cascade-deletes every definition,
 * execution, secret and credential beneath it; an API that does that by slug is
 * one mistyped `curl` from an unrecoverable outage. Removing a tenant stays a
 * deliberate operation at a terminal.
 */

const createSchema = z.object({
  slug: z.string().min(3).max(64),
  /** Namespace settings, which today means quotas. */
  settings: z.record(z.string(), z.unknown()).optional(),
  /**
   * Issue the new namespace's first API key and return it once.
   *
   * Off by default: a caller who did not ask for a credential should not be
   * handed one in a response body that may be logged.
   */
  createApiKey: z.boolean().optional(),
  apiKeyName: z.string().min(1).max(255).optional(),
  apiKeyScopes: z.array(z.string().refine(isValidScope, 'not a valid scope')).max(64).optional(),
});

@Controller('namespaces')
export class NamespaceController {
  constructor(
    private readonly namespaces: NamespaceRepository,
    private readonly identity: IdentityRepository
  ) {}

  @Get()
  @RequireScopes(Scope.PLATFORM_ADMIN)
  @ApiRoute({
    summary: 'List the namespaces on this install',
    description: 'Requires `platform:admin`, which a namespace `admin` does not satisfy.',
    tags: ['namespaces'],
  })
  async list() {
    return { namespaces: await this.namespaces.list() };
  }

  @Get(':slug')
  @RequireScopes(Scope.PLATFORM_ADMIN)
  @ApiRoute({ summary: 'Fetch one namespace', tags: ['namespaces'] })
  async get(@Param('slug') slug: string) {
    const found = await this.namespaces.get(slug);
    if (!found) throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no namespace "${slug}"` });
    return found;
  }

  @Audited('namespace', 'create')
  @Post()
  @RequireScopes(Scope.PLATFORM_ADMIN)
  @ApiRoute({
    summary: 'Create a namespace',
    description:
      'Optionally issues its first API key, which is returned once and cannot be recovered — ' +
      'without one the new namespace has no credential and nothing can act in it.',
    tags: ['namespaces'],
    body: createSchema,
  })
  async create(
    @CurrentPrincipal() _principal: Principal,
    @Body(zodBody(createSchema)) body: z.infer<typeof createSchema>
  ) {
    const namespace = await this.namespaces.create(
      body.slug,
      (body.settings ?? {}) as Record<string, never>
    );

    if (!body.createApiKey) return { ...namespace };

    const issued = await this.identity.createApiKey({
      namespaceId: namespace.id,
      name: body.apiKeyName ?? `${body.slug}-bootstrap`,
      // `admin` within the new namespace, not platform:admin: the tenant runs
      // itself, and handing it the power to create further tenants would make
      // this route a privilege-escalation ladder.
      scopes: body.apiKeyScopes ?? [Scope.ADMIN],
    });

    return {
      ...namespace,
      apiKey: {
        id: issued.id,
        prefix: issued.prefix,
        token: issued.token,
        warning: 'the token is shown once and cannot be recovered',
      },
    };
  }
}

@Module({ controllers: [NamespaceController] })
export class NamespaceModule {}
