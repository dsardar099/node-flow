import { Inject, Injectable } from '@nestjs/common';
import { PrincipalType, type Principal } from '@node-flow-dev/core';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/**
 * Mints and verifies short-lived access tokens.
 *
 * A service account exchanges its long-lived key/secret once and then presents
 * a token that expires. That indirection is what limits the blast radius of a
 * leaked credential: a captured token is useless within the hour, while a
 * captured key/secret is useful until someone notices and revokes it.
 *
 * Symmetric HS256 for now. Asymmetric signing matters when something other than
 * this service must verify tokens without being able to mint them, which is a
 * Phase 5 concern arriving with OIDC — the interface here does not change.
 */

/** Claims beyond the registered ones. Namespaced to avoid collisions. */
interface NodeFlowClaims extends JWTPayload {
  nsp?: string;
  scp?: string[];
  nam?: string;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.NODE_FLOW_JWT_SECRET);
  }

  async issue(principal: Principal): Promise<{ token: string; expiresInSeconds: number }> {
    const ttl = this.config.NODE_FLOW_ACCESS_TOKEN_TTL_SECONDS;

    const token = await new SignJWT({
      nsp: principal.namespaceId,
      scp: principal.scopes,
      nam: principal.name,
    } satisfies NodeFlowClaims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(principal.id)
      .setIssuer(this.config.NODE_FLOW_JWT_ISSUER)
      .setAudience(this.config.NODE_FLOW_JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.key);

    return { token, expiresInSeconds: ttl };
  }

  /**
   * Verifies a token and rebuilds the principal from its claims.
   *
   * Issuer and audience are checked, not merely the signature. A signature-only
   * check accepts any token signed with the same secret — including one minted
   * by a different service that happens to share it, which is exactly how a
   * shared secret turns into cross-service privilege escalation.
   *
   * Returns `undefined` rather than throwing: an expired token is an ordinary
   * event on a long-running worker, not an exceptional one.
   */
  async verify(token: string): Promise<Principal | undefined> {
    try {
      const { payload } = await jwtVerify<NodeFlowClaims>(token, this.key, {
        issuer: this.config.NODE_FLOW_JWT_ISSUER,
        audience: this.config.NODE_FLOW_JWT_ISSUER,
        algorithms: ['HS256'],
      });

      // A token missing its namespace claim must never be treated as valid.
      // Defaulting it would let a malformed token act somewhere unintended.
      if (!payload.sub || !payload.nsp) return undefined;

      return {
        type: PrincipalType.SERVICE_ACCOUNT,
        id: payload.sub,
        name: payload.nam ?? payload.sub,
        namespaceId: payload.nsp,
        scopes: payload.scp ?? [],
      };
    } catch {
      return undefined;
    }
  }
}
