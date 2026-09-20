import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SsoService, safeReturnTo, type SsoProvider } from './sso.service.js';
import type { AppConfig } from '../config/config.schema.js';

/**
 * The parts of single sign-on that can be tested without a browser.
 *
 * The signed flow state and `returnTo` handling are where the two
 * browser-specific attacks live — login CSRF and open redirect — so they get
 * the attention here; the full exchange is covered end to end in `api.spec`.
 */

const provider: SsoProvider = {
  name: 'corp',
  issuer: 'https://idp.example.com',
  clientId: 'node-flow',
  clientSecret: 'shh',
  authorizationEndpoint: 'https://idp.example.com/authorize',
  tokenEndpoint: 'https://idp.example.com/token',
  jwksUri: 'https://idp.example.com/jwks',
  redirectUri: 'https://nodeflow.example.com/v1/auth/sso/corp/callback',
  namespace: 'acme',
};

const service = (secret = 'a-secret-that-is-at-least-32-characters') =>
  new SsoService({
    NODE_FLOW_SSO_PROVIDERS: [provider],
    NODE_FLOW_JWT_SECRET: secret,
  } as unknown as AppConfig);

describe('beginning a login', () => {
  it('sends the browser to the provider with everything the flow needs', () => {
    const { url, flow } = service().begin(provider, '/executions');
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(provider.authorizationEndpoint);
    expect(parsed.searchParams.get('client_id')).toBe(provider.clientId);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe(flow.state);
    expect(parsed.searchParams.get('nonce')).toBe(flow.nonce);
  });

  /**
   * PKCE: the challenge goes to the IdP, the verifier never leaves this
   * process. An intercepted authorization code cannot be redeemed without it.
   */
  it('sends the S256 challenge and keeps the verifier', () => {
    const { url, flow } = service().begin(provider, '/');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(flow.verifier).digest('base64url')
    );
    expect(url).not.toContain(flow.verifier);
  });

  // The redirect URI is registered with the IdP and must never come from the
  // request: a caller-supplied one is an open redirect with a credential.
  it('uses the configured redirect URI', () => {
    const { url } = service().begin(provider, '/');
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(provider.redirectUri);
  });

  it('gives every login a fresh state, verifier and nonce', () => {
    const first = service().begin(provider, '/').flow;
    const second = service().begin(provider, '/').flow;

    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.nonce).not.toBe(second.nonce);
  });
});

/**
 * The flow cookie is what makes `state` meaningful. If it can be forged, an
 * attacker supplies both halves and the check proves nothing.
 */
describe('the signed flow state', () => {
  it('round-trips', () => {
    const sso = service();
    const { flow } = sso.begin(provider, '/executions');

    expect(sso.open(sso.seal(flow))).toEqual(flow);
  });

  it('refuses a tampered payload', () => {
    const sso = service();
    const sealed = sso.seal(sso.begin(provider, '/').flow);

    const [payload, signature] = sealed.split('.');
    const forged = Buffer.from(
      JSON.stringify({ state: 'mine', verifier: 'x', nonce: 'y', provider: 'corp', returnTo: '/' })
    ).toString('base64url');

    expect(sso.open(`${forged}.${signature}`)).toBeUndefined();
    expect(payload).not.toBe(forged);
  });

  it('refuses a signature from a different install', () => {
    const sealed = service('secret-one-that-is-at-least-32-chars!').seal(
      service().begin(provider, '/').flow
    );

    expect(service('secret-two-that-is-at-least-32-chars!').open(sealed)).toBeUndefined();
  });

  // A forged cookie must not become a 500: `timingSafeEqual` throws on a
  // length mismatch rather than returning false.
  it('refuses malformed input without throwing', () => {
    const sso = service();

    for (const value of [undefined, '', 'nodot', 'a.b', '.', 'x.']) {
      expect(sso.open(value as string | undefined)).toBeUndefined();
    }
  });

  it('compares states in constant time and rejects a mismatch', () => {
    const sso = service();
    const { flow } = sso.begin(provider, '/');

    expect(sso.statesMatch(flow.state, flow.state)).toBe(true);
    expect(sso.statesMatch('short', flow.state)).toBe(false);
    expect(sso.statesMatch(`${flow.state}x`, flow.state)).toBe(false);
  });
});

/**
 * An open redirect arriving immediately after authentication is the most
 * convincing kind, because the victim has just proved they trust the site.
 */
describe('returnTo', () => {
  it('keeps a plain path', () => {
    expect(safeReturnTo('/executions?status=RUNNING')).toBe('/executions?status=RUNNING');
  });

  it('discards anything that leaves the site', () => {
    for (const value of [
      'https://attacker.example',
      '//attacker.example',
      'http://attacker.example',
      '/\\attacker.example',
      'javascript:alert(1)',
      '',
      undefined,
    ]) {
      expect(safeReturnTo(value), String(value)).toBe('/');
    }
  });
});

describe('configuration', () => {
  it('is disabled when no provider is configured', () => {
    const none = new SsoService({
      NODE_FLOW_SSO_PROVIDERS: [],
      NODE_FLOW_JWT_SECRET: 'x'.repeat(32),
    } as unknown as AppConfig);

    expect(none.enabled).toBe(false);
    expect(none.provider('corp')).toBeUndefined();
  });

  // The login page renders its buttons from this, so it must not leak the
  // client secret.
  it('lists providers without their secrets', () => {
    expect(JSON.stringify(service().list())).not.toContain('shh');
  });
});
