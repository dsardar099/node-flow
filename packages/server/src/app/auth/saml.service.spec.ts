import { gunzipSync, inflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/config.schema.js';
import { fakeIdp, samlResponse, type IdentityProvider } from './saml.fixture.js';
import { SamlService, type SamlProvider } from './saml.service.js';

/**
 * SAML, tested the way it is attacked.
 *
 * The signature mathematics belongs to `@node-saml/node-saml` and is not
 * re-tested here. What is tested is everything the library leaves to us — the
 * binding of an assertion to the browser and the request that asked for it —
 * because that is the half of SAML that applications get wrong.
 *
 * The identity provider is simulated by signing assertions with a key this
 * test generates, using the library's own signer. That makes a "valid
 * assertion, wrong login" case possible to write, which is the interesting one.
 */

const ISSUER = 'https://node-flow.test/sp';
const CALLBACK = 'https://node-flow.test/v1/auth/saml/corp/callback';

let idp: IdentityProvider;

beforeAll(() => {
  idp = fakeIdp();
});

const provider = (overrides: Partial<SamlProvider> = {}): SamlProvider => ({
  name: 'corp',
  entryPoint: 'https://idp.test/sso',
  issuer: ISSUER,
  callbackUrl: CALLBACK,
  idpCert: idp.publicKey,
  namespace: 'default',
  ...overrides,
});

const service = (providers: SamlProvider[] = [provider()]) =>
  new SamlService({ NODE_FLOW_SAML_PROVIDERS: providers, NODE_FLOW_JWT_SECRET: 'test-secret' } as unknown as AppConfig);

/** A signed SAML response addressed to this service provider. */
const assertion = (options: Omit<Parameters<typeof samlResponse>[0], 'idp' | 'audience' | 'recipient'> & { audience?: string }) =>
  samlResponse({ idp, audience: ISSUER, recipient: CALLBACK, ...options });

/** Pulls the AuthnRequest back out of the redirect, the way the IdP would read it. */
function authnRequest(url: string): string {
  const encoded = new URL(url).searchParams.get('SAMLRequest') as string;
  const raw = Buffer.from(encoded, 'base64');
  // Redirect binding deflates; a few IdPs gzip. Both are handled so the test
  // reads what was actually sent rather than what we assume was.
  try {
    return inflateRawSync(raw).toString('utf8');
  } catch {
    return gunzipSync(raw).toString('utf8');
  }
}

describe('SAML sign-in', () => {
  it('starts an SP-initiated login and accepts the assertion that answers it', async () => {
    const saml = service();
    const { url, flow } = await saml.begin(provider(), '/executions?status=RUNNING');

    expect(url.startsWith('https://idp.test/sso?')).toBe(true);
    expect(new URL(url).searchParams.get('RelayState')).toBe(flow.relay);

    // The request carries the id we generated, which is what the assertion
    // will have to answer.
    const request = authnRequest(url);
    expect(request).toContain(`ID="${flow.requestId}"`);
    expect(request).toContain(`AssertionConsumerServiceURL="${CALLBACK}"`);

    const identity = await saml.complete(provider(), assertion({ inResponseTo: flow.requestId }), flow);
    expect(identity).toEqual({ email: 'ada@example.com', name: 'Ada Lovelace', subject: 'ada@example.com' });
    expect(flow.returnTo).toBe('/executions?status=RUNNING');
  });

  it('refuses an assertion that answers a different login, however valid it is', async () => {
    const saml = service();
    const { flow } = await saml.begin(provider(), '/');
    const { flow: other } = await saml.begin(provider(), '/');

    // Correctly signed, current, and addressed to us — but it answers a login
    // that happened in another browser. This is IdP-initiated SSO and assertion
    // replay in one shape, and it is the case the library cannot judge.
    await expect(saml.complete(provider(), assertion({ inResponseTo: other.requestId }), flow)).rejects.toThrow(
      /does not answer the login that started here/
    );
  });

  it('refuses an unsigned assertion, a foreign audience and an expired one', async () => {
    const saml = service();
    const { flow } = await saml.begin(provider(), '/');

    await expect(saml.complete(provider(), assertion({ inResponseTo: flow.requestId, sign: 'none' }), flow)).rejects.toThrow();

    // A signed *envelope* around an unsigned assertion. The envelope's
    // signature says nothing about the assertion inside it, and accepting one
    // is how signature-wrapping attacks land; `wantAssertionsSigned` is what
    // refuses it.
    await expect(saml.complete(provider(), assertion({ inResponseTo: flow.requestId, sign: 'response' }), flow)).rejects.toThrow();

    // An assertion minted for a different service provider at the same IdP is
    // a perfectly valid assertion, and must not work here.
    await expect(
      saml.complete(provider(), assertion({ inResponseTo: flow.requestId, audience: 'https://other.test/sp' }), flow)
    ).rejects.toThrow();

    await expect(
      saml.complete(
        provider(),
        assertion({
          inResponseTo: flow.requestId,
          issueInstant: new Date(Date.now() - 60 * 60_000),
          notOnOrAfter: new Date(Date.now() - 55 * 60_000),
        }),
        flow
      )
    ).rejects.toThrow();
  });

  it('refuses a flow cookie it did not sign, and reduces returnTo to a path', async () => {
    const saml = service();
    const { flow } = await saml.begin(provider(), 'https://evil.test/steal');
    expect(flow.returnTo).toBe('/');

    const sealed = saml.seal(flow);
    expect(saml.open(sealed)).toEqual(flow);
    // One flipped character in the signature is enough.
    expect(saml.open(sealed.slice(0, -1) + (sealed.endsWith('A') ? 'B' : 'A'))).toBeUndefined();
    // A payload someone chose for themselves, with no signature at all.
    expect(saml.open(Buffer.from(JSON.stringify(flow)).toString('base64url'))).toBeUndefined();
  });

  it('publishes metadata with our entity id and ACS URL, and lists its providers', async () => {
    const saml = service();
    const metadata = saml.metadata(provider());
    expect(metadata).toContain(`entityID="${ISSUER}"`);
    expect(metadata).toContain(CALLBACK);

    expect(saml.enabled).toBe(true);
    expect(saml.list()).toEqual([{ name: 'corp', namespace: 'default', protocol: 'saml' }]);
    expect(service([]).enabled).toBe(false);
  });
});
