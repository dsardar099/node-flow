import { Injectable } from '@nestjs/common';
import { PrincipalType, type Principal } from '@node-flow-dev/core';
import { UserRepository } from '@node-flow-dev/store';
import type { Authenticator, PresentedCredentials } from './authenticator.js';
import { SESSION_COOKIE, readCookie } from './session.js';

/**
 * `Cookie: nf_session=…`
 *
 * The human path. Unlike the two machine authenticators, a session is a
 * database row rather than a signed value — so it can be revoked the instant
 * someone is offboarded, rather than staying valid until it happens to expire.
 *
 * A cookie that does not resolve returns `undefined` rather than throwing, and
 * that differs deliberately from how a bad API key is handled. A stale cookie
 * is ordinary — a browser holds one long after logout — so it must fall through
 * to "unauthenticated" and produce a login prompt, not an error page.
 */
@Injectable()
export class SessionAuthenticator implements Authenticator {
  readonly scheme = 'Session';

  constructor(private readonly users: UserRepository) {}

  async authenticate(credentials: PresentedCredentials): Promise<Principal | undefined> {
    const token = readCookie(credentials.cookie, SESSION_COOKIE);
    if (!token) return undefined;

    const principal = await this.users.authenticateSession(token);
    if (!principal) return undefined;

    // Belt and braces: the repository sets this, and the CSRF guard keys off
    // it to decide whether a request needs a token. If it were ever wrong, a
    // session request would skip the CSRF check.
    return { ...principal, type: PrincipalType.USER };
  }
}
