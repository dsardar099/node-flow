import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { OidcVerifier } from './oidc-verifier.js';
import { constantTimeEquals, openFlow, sealFlow } from './signed-flow.js';

/**
 * OIDC single sign-on for humans.
 *
 * Authorization Code flow with PKCE. Every element below exists for a specific
 * attack, and each has been the subject of real incidents:
 *
 *  - **`state`** binds the callback to the browser that started the flow.
 *    Without it, an attacker completes their own login and redirects the victim
 *    to the callback, logging the victim into the *attacker's* account — login
 *    CSRF, and the damage is everything the victim then does in it.
 *  - **PKCE** binds the authorization code to this client. An intercepted code
 *    — from a proxy, a log, a referrer header — cannot be redeemed without the
 *    verifier, which never leaves this process.
 *  - **`nonce`** binds the ID token to *this* request, so a token obtained
 *    elsewhere cannot be replayed into this flow.
 *  - **The redirect URI is configured, never taken from the request.** A
 *    caller-supplied one is an open redirect with a credential attached.
 *  - **`returnTo` is a path, never a URL.** The same open-redirect problem one
 *    step later.
 *
 * The flow state is carried in a signed, HttpOnly cookie rather than a table:
 * it is short-lived, browser-bound by nature, and a database row would need a
 * sweeper for the abandoned logins that are the normal case.
 */

export interface SsoProvider {
  /** The name in the URL: `/auth/sso/:provider/login`. */
  name: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  /** Where the IdP sends the browser back. Registered with the IdP. */
  redirectUri: string;
  /** The namespace accounts are provisioned into. */
  namespace: string;
  scopes?: string;
}

export interface FlowState {
  state: string;
  verifier: string;
  nonce: string;
  provider: string;
  returnTo: string;
}

export interface SsoIdentity {
  email: string;
  name?: string;
  subject: string;
}

@Injectable()
export class SsoService {
  private readonly providers: Map<string, SsoProvider>;
  private readonly secret: string;
  private readonly verifiers = new Map<string, OidcVerifier>();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.providers = new Map(
      config.NODE_FLOW_SSO_PROVIDERS.map((provider: SsoProvider) => [provider.name, provider])
    );
    this.secret = config.NODE_FLOW_JWT_SECRET;
  }

  get enabled(): boolean {
    return this.providers.size > 0;
  }

  list(): { name: string; namespace: string }[] {
    return [...this.providers.values()].map((p) => ({ name: p.name, namespace: p.namespace }));
  }

  provider(name: string): SsoProvider | undefined {
    return this.providers.get(name);
  }

  /** Builds the redirect that starts a login, and the state to remember. */
  begin(provider: SsoProvider, returnTo: string): { url: string; flow: FlowState } {
    const flow: FlowState = {
      state: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
      nonce: randomBytes(16).toString('base64url'),
      provider: provider.name,
      returnTo: safeReturnTo(returnTo),
    };

    const url = new URL(provider.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', provider.redirectUri);
    url.searchParams.set('scope', provider.scopes ?? 'openid email profile');
    url.searchParams.set('state', flow.state);
    url.searchParams.set('nonce', flow.nonce);
    url.searchParams.set('code_challenge', challengeFor(flow.verifier));
    url.searchParams.set('code_challenge_method', 'S256');

    return { url: url.toString(), flow };
  }

  /**
   * Exchanges the code and verifies the ID token.
   *
   * The caller has already confirmed `state` matches; this does everything that
   * depends on talking to the IdP.
   */
  async complete(provider: SsoProvider, code: string, flow: FlowState): Promise<SsoIdentity> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      // Sent again at the token endpoint because the IdP checks it matches the
      // one from the authorization request — a mismatch is how a code stolen
      // from one client is detected at another.
      redirect_uri: provider.redirectUri,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code_verifier: flow.verifier,
    });

    const response = await fetch(provider.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // The IdP's body can echo the client secret back in an error; it is never
      // propagated.
      throw new Error(`token exchange failed with ${response.status}`);
    }

    const tokens = (await response.json()) as { id_token?: string };
    if (!tokens.id_token) throw new Error('the identity provider returned no ID token');

    const verified = await this.verifierFor(provider).verify(tokens.id_token);

    // Binds this token to this login. An ID token acquired any other way —
    // replayed from another session, another application — carries a different
    // nonce and is refused here.
    if (verified.claims['nonce'] !== flow.nonce) {
      throw new Error('ID token does not match this login attempt');
    }

    const email = verified.claims['email'];
    if (typeof email !== 'string' || !email.includes('@')) {
      throw new Error('the identity provider returned no email address');
    }

    // An unverified address is an account takeover primitive: anyone who can
    // claim an address at the IdP would inherit the account that already uses
    // it here. Absent is tolerated — not every IdP sends it — but false is not.
    if (verified.claims['email_verified'] === false) {
      throw new Error('the identity provider reports this email address as unverified');
    }

    const name = verified.claims['name'];

    return {
      email: email.toLowerCase(),
      name: typeof name === 'string' ? name : undefined,
      subject: verified.subject,
    };
  }

  /** Signs the flow state so a tampered or injected cookie is rejected. */
  seal(flow: FlowState): string {
    return sealFlow(this.secret, flow);
  }

  open(sealed: string | undefined): FlowState | undefined {
    return openFlow<FlowState>(this.secret, sealed);
  }

  /** Constant-time comparison of the returned `state` against the remembered one. */
  statesMatch(returned: string, remembered: string): boolean {
    return constantTimeEquals(returned, remembered);
  }

  private verifierFor(provider: SsoProvider): OidcVerifier {
    let verifier = this.verifiers.get(provider.name);

    if (!verifier) {
      // The audience is the client id: an ID token minted for a different
      // application at the same IdP is a valid token and must not work here.
      verifier = new OidcVerifier([
        { issuer: provider.issuer, jwksUri: provider.jwksUri, audience: provider.clientId },
      ]);
      this.verifiers.set(provider.name, verifier);
    }

    return verifier;
  }
}

/** S256 code challenge, as the PKCE spec defines it. */
function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Reduces `returnTo` to a safe path.
 *
 * Anything absolute, protocol-relative, or not starting with a single `/` is
 * discarded rather than corrected. A login flow that redirects wherever it is
 * told is an open redirect, and one that arrives immediately after
 * authentication is the most convincing kind.
 */
export function safeReturnTo(value: string | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  // `//host` is protocol-relative and leaves the site.
  if (value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  return value;
}
