import { Body, Controller, Delete, Get, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';
import { Scope, isValidScope, type Principal } from '@node-flow-dev/core';
import { IdentityRepository } from '@node-flow-dev/store';
import { NamespaceResolver } from '../common/namespace.resolver.js';
import { z } from 'zod';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';
import { CurrentPrincipal, Public, RequireScopes } from './auth.decorators.js';
import { TokenService } from './token.service.js';
import { Audited } from '../common/audit.interceptor.js';

/**
 * Credential issuance and exchange.
 *
 * The token endpoint is the only unauthenticated write in the API — it *is* the
 * authentication step. Everything else here requires `admin`, because the
 * ability to mint credentials is equivalent to holding every scope.
 */

const scopeList = z
  .array(z.string().refine(isValidScope, 'not a valid scope'))
  .max(64)
  .default([]);

const tokenRequestSchema = z.object({
  keyId: z.string().min(1),
  secret: z.string().min(1),
});

const serviceAccountSchema = z.object({
  name: z.string().min(1).max(255),
  scopes: scopeList,
});

const apiKeySchema = z.object({
  name: z.string().min(1).max(255),
  scopes: scopeList,
  /** Absent means no expiry — allowed, but the caller has to say so. */
  expiresAt: z.iso.datetime().optional(),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly tokens: TokenService,
    private readonly namespaces: NamespaceResolver
  ) {}

  /**
   * Exchanges a service-account key and secret for a short-lived token.
   *
   * `POST` with the credential in the body rather than in the URL: query
   * strings land in access logs, browser history and proxy telemetry, and a
   * long-lived secret must not.
   */
  @Public()
  @Post('token')
  @HttpCode(200)
  @ApiRoute({
    summary: 'Exchange a service-account key and secret for a short-lived token',
    tags: ['auth'],
    body: tokenRequestSchema,
  })
  async token(@Body(zodBody(tokenRequestSchema)) body: z.infer<typeof tokenRequestSchema>) {
    const principal = await this.identity.authenticateServiceAccount(body.keyId, body.secret);

    // One message for every failure mode. Distinguishing "no such key" from
    // "wrong secret" hands an attacker a key-enumeration oracle for free.
    if (!principal) {
      throw new UnauthorizedException({
        error: 'invalid_credentials',
        message: 'unknown key or incorrect secret',
      });
    }

    const issued = await this.tokens.issue(principal);

    return {
      accessToken: issued.token,
      tokenType: 'Bearer',
      expiresIn: issued.expiresInSeconds,
      scopes: principal.scopes,
    };
  }

  /** Who the caller is, as the server sees them. Useful for debugging scopes. */
  @Get('whoami')
  @ApiRoute({ summary: 'The caller as the server sees them, including scopes', tags: ['auth'] })
  whoami(@CurrentPrincipal() principal: Principal) {
    return {
      type: principal.type,
      id: principal.id,
      name: principal.name,
      namespaceId: principal.namespaceId,
      scopes: principal.scopes,
    };
  }

  // ------------------------------------------------------------ service accounts

  @Get('me')
  @ApiRoute({
    summary: 'Who the caller is',
    description:
      'Namespace-free on purpose: a browser holding a session cookie knows ' +
      'neither its namespace slug nor its scopes until it asks, and every ' +
      'other route needs the namespace in the path.',
    tags: ['auth'],
  })
  async me(@CurrentPrincipal() principal: Principal) {
    return {
      type: principal.type,
      id: principal.id,
      name: principal.name,
      namespaceId: principal.namespaceId,
      // The slug, not only the id: every namespaced URL is written with a slug,
      // so a client cannot construct a single API path without it.
      namespace: await this.namespaces.slugFor(principal.namespaceId),
      // What the dashboard renders its navigation from: a menu item leading to
      // a 403 is worse than one that is absent.
      scopes: principal.scopes,
      tagGrants: principal.tagGrants ?? [],
      // So a user granted access to a few workflows sees the screens for them.
      resourceGrants: principal.resourceGrants ?? [],
    };
  }

  @Audited('service-account', 'create')
  @Post('service-accounts')
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Create a service account',
    description: 'The secret is returned once and cannot be recovered.',
    tags: ['auth'],
    body: serviceAccountSchema,
  })
  async createServiceAccount(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(serviceAccountSchema)) body: z.infer<typeof serviceAccountSchema>
  ) {
    const issued = await this.identity.createServiceAccount({
      // The namespace comes from the credential, never from the request. A
      // body-supplied namespace is a cross-tenant write waiting to happen.
      namespaceId: principal.namespaceId,
      name: body.name,
      scopes: body.scopes,
    });

    return {
      id: issued.id,
      keyId: issued.keyId,
      secret: issued.secret,
      warning: 'the secret is shown once and cannot be recovered',
    };
  }

  @Get('service-accounts')
  @RequireScopes(Scope.ADMIN)
  listServiceAccounts(@CurrentPrincipal() principal: Principal) {
    return this.identity.listServiceAccounts(principal.namespaceId);
  }

  @Audited('service-account', 'disable')
  @Delete('service-accounts/:id')
  @RequireScopes(Scope.ADMIN)
  @HttpCode(204)
  async disableServiceAccount(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string
  ): Promise<void> {
    await this.identity.disableServiceAccount(principal.namespaceId, id);
  }

  // ------------------------------------------------------------------- API keys

  @Audited('api-key', 'create')
  @Post('api-keys')
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Create an API key',
    description: 'The token is returned once and cannot be recovered.',
    tags: ['auth'],
    body: apiKeySchema,
  })
  async createApiKey(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(apiKeySchema)) body: z.infer<typeof apiKeySchema>
  ) {
    const issued = await this.identity.createApiKey({
      namespaceId: principal.namespaceId,
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });

    return {
      id: issued.id,
      prefix: issued.prefix,
      token: issued.token,
      warning: 'the token is shown once and cannot be recovered',
    };
  }

  @Get('api-keys')
  @RequireScopes(Scope.ADMIN)
  listApiKeys(@CurrentPrincipal() principal: Principal) {
    return this.identity.listApiKeys(principal.namespaceId);
  }

  @Audited('api-key', 'revoke')
  @Delete('api-keys/:id')
  @RequireScopes(Scope.ADMIN)
  @HttpCode(204)
  async revokeApiKey(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string
  ): Promise<void> {
    await this.identity.revokeApiKey(principal.namespaceId, id);
  }
}
