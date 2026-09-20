import { Injectable } from '@nestjs/common';
import type { Principal } from '@node-flow-dev/core';
import { IdentityRepository } from '@node-flow-dev/store';
import {
  InvalidCredentialError,
  type Authenticator,
  type PresentedCredentials,
} from './authenticator.js';
import { TokenService } from './token.service.js';

/**
 * The two mechanisms Phase 1 ships. Both resolve to a `Principal` and neither
 * is visible to any authorization check.
 */

/**
 * `X-API-Key: nf_…`
 *
 * Long-lived and presented directly, for CI pipelines and the CLI, where a
 * token-exchange round trip on every invocation buys nothing.
 */
@Injectable()
export class ApiKeyAuthenticator implements Authenticator {
  readonly scheme = 'ApiKey';

  constructor(private readonly identity: IdentityRepository) {}

  async authenticate(credentials: PresentedCredentials): Promise<Principal | undefined> {
    const key = credentials.apiKey;
    if (!key) return undefined;

    const principal = await this.identity.authenticateApiKey(key);

    // A key was presented and is not valid. Falling through to "no credentials"
    // would report 401 with no indication that the key itself was the problem,
    // which is a genuinely hard thing to debug from the client side.
    if (!principal) throw new InvalidCredentialError('API key is unknown, revoked or expired');

    return principal;
  }
}

/**
 * `Authorization: Bearer <jwt>`
 *
 * The worker path: exchange key/secret once at startup, then present a token
 * that expires. Verification is a signature check with no database round trip,
 * which matters because workers poll continuously.
 */
@Injectable()
export class BearerTokenAuthenticator implements Authenticator {
  readonly scheme = 'Bearer';

  constructor(private readonly tokens: TokenService) {}

  async authenticate(credentials: PresentedCredentials): Promise<Principal | undefined> {
    const header = credentials.authorization;
    if (!header) return undefined;

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;

    const principal = await this.tokens.verify(token);
    if (!principal) throw new InvalidCredentialError('access token is invalid or expired');

    return principal;
  }
}
