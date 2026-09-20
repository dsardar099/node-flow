import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OidcVerifier, type TrustedIssuer } from './oidc-verifier.js';

/**
 * The OIDC workload-identity verifier.
 *
 * Almost every test here is a refusal, and each one corresponds to a published
 * attack on JWT verification. A verifier tested only on valid tokens is a
 * verifier that accepts invalid ones.
 */

const ISSUER = 'https://oidc.example.com';
const AUDIENCE = 'node-flow';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const base64url = (value: object | Buffer) =>
  Buffer.isBuffer(value)
    ? value.toString('base64url')
    : Buffer.from(JSON.stringify(value)).toString('base64url');

/** Mints a token the way a real IdP would, so the tests exercise real signatures. */
function mint(
  claims: Record<string, unknown> = {},
  options: { alg?: string; kid?: string; key?: KeyObject; signAs?: string } = {}
): string {
  const alg = options.alg ?? 'RS256';
  const header = base64url({ alg, typ: 'JWT', kid: options.kid ?? 'key-1' });

  const now = Math.floor(Date.now() / 1000);
  const payload = base64url({
    iss: ISSUER,
    sub: 'system:serviceaccount:prod:worker',
    aud: AUDIENCE,
    iat: now,
    exp: now + 300,
    ...claims,
  });

  const signingInput = `${header}.${payload}`;

  if (options.signAs === 'hmac') {
    // The alg-confusion attack: sign with the *public* key as an HMAC secret.
    const secret = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    return `${signingInput}.${base64url(
      createHmac('sha256', secret).update(signingInput).digest()
    )}`;
  }

  if (options.signAs === 'none') return `${signingInput}.`;

  const signer = createSign(alg.startsWith('ES') ? 'sha256' : 'RSA-SHA256');
  signer.update(signingInput);
  const signature = alg.startsWith('ES')
    ? signer.sign({ key: options.key ?? ec.privateKey, dsaEncoding: 'ieee-p1363' })
    : signer.sign(options.key ?? rsa.privateKey);

  return `${signingInput}.${base64url(signature)}`;
}

/** A JWKS endpoint, counting fetches so caching is observable. */
function jwks(keys: { kid: string; key: KeyObject }[]) {
  let fetches = 0;

  const impl = (async () => {
    fetches += 1;
    return new Response(
      JSON.stringify({
        keys: keys.map(({ kid, key }) => ({
          ...(key.export({ format: 'jwk' }) as Record<string, unknown>),
          kid,
          use: 'sig',
        })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as unknown as typeof globalThis.fetch;

  return { impl, count: () => fetches };
}

const trusted: TrustedIssuer[] = [
  { issuer: ISSUER, jwksUri: 'https://oidc.example.com/jwks', audience: AUDIENCE },
];

let endpoint: ReturnType<typeof jwks>;
let verifier: OidcVerifier;

beforeEach(() => {
  endpoint = jwks([{ kid: 'key-1', key: rsa.publicKey }]);
  verifier = new OidcVerifier(trusted, endpoint.impl);
});

describe('accepting a valid token', () => {
  it('verifies and returns the identity', async () => {
    const result = await verifier.verify(mint());

    expect(result.issuer).toBe(ISSUER);
    expect(result.subject).toBe('system:serviceaccount:prod:worker');
  });

  it('accepts an audience array containing ours', async () => {
    const result = await verifier.verify(mint({ aud: ['something-else', AUDIENCE] }));
    expect(result.subject).toBeTruthy();
  });

  it('accepts an ES256 token', async () => {
    const ecEndpoint = jwks([{ kid: 'ec-1', key: ec.publicKey }]);
    const ecVerifier = new OidcVerifier(trusted, ecEndpoint.impl);

    const result = await ecVerifier.verify(mint({}, { alg: 'ES256', kid: 'ec-1' }));
    expect(result.subject).toBeTruthy();
  });

  // A JWKS fetch per request would make the IdP a hard dependency of every
  // authenticated call.
  it('caches the key set', async () => {
    await verifier.verify(mint());
    await verifier.verify(mint());
    await verifier.verify(mint());

    expect(endpoint.count()).toBe(1);
  });
});

describe('refusing', () => {
  /**
   * The `alg` confusion attack.
   *
   * A token claiming `HS256`, signed with the RSA *public* key as an HMAC
   * secret. A verifier that takes its algorithm from the token header accepts
   * it, because the public key is public.
   */
  it('refuses a token signed with the public key as an HMAC secret', async () => {
    await expect(verifier.verify(mint({}, { alg: 'HS256', signAs: 'hmac' }))).rejects.toThrow(
      /unsupported algorithm/
    );
  });

  /**
   * The subtler algorithm mismatch.
   *
   * The `HS256` case above never reaches the key-type check — an unsupported
   * algorithm is rejected first — so it leaves that check untested, which a
   * mutation confirmed by deleting it and breaking nothing. This is the case it
   * actually guards: a token claiming `ES256` pointing at an RSA signing key,
   * which is only possible in a key set containing both.
   */
  it('refuses a token whose algorithm does not match its signing key', async () => {
    const mixed = jwks([
      { kid: 'rsa-1', key: rsa.publicKey },
      { kid: 'ec-1', key: ec.publicKey },
    ]);
    const mixedVerifier = new OidcVerifier(trusted, mixed.impl);

    await expect(
      mixedVerifier.verify(mint({}, { alg: 'ES256', kid: 'rsa-1' }))
    ).rejects.toThrow(/does not match the signing key/);
  });

  it('refuses alg: none', async () => {
    await expect(verifier.verify(mint({}, { alg: 'none', signAs: 'none' }))).rejects.toThrow();
  });

  // Without this, any IdP on the internet can mint tokens for this install.
  it('refuses an untrusted issuer', async () => {
    await expect(verifier.verify(mint({ iss: 'https://attacker.example' }))).rejects.toThrow(
      /not trusted/
    );
  });

  // Exact match only: a prefix check would accept `https://oidc.example.com.evil`.
  it('refuses an issuer that merely looks similar', async () => {
    await expect(
      verifier.verify(mint({ iss: `${ISSUER}.attacker.example` }))
    ).rejects.toThrow(/not trusted/);
  });

  // A token minted for another service is a valid token; the audience is what
  // stops it being replayed here.
  it('refuses a token minted for someone else', async () => {
    await expect(verifier.verify(mint({ aud: 'another-service' }))).rejects.toThrow(/audience/);
  });

  it('refuses a token with no audience', async () => {
    await expect(verifier.verify(mint({ aud: undefined }))).rejects.toThrow(/audience/);
  });

  it('refuses an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    await expect(verifier.verify(mint({ exp: past }))).rejects.toThrow(/expired/);
  });

  // A token with no expiry is a password that never rotates.
  it('refuses a token with no expiry', async () => {
    await expect(verifier.verify(mint({ exp: undefined }))).rejects.toThrow(/no expiry/);
  });

  it('refuses a token that is not yet valid', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    await expect(verifier.verify(mint({ nbf: future }))).rejects.toThrow(/not yet valid/);
  });

  it('refuses a signature from a different key', async () => {
    await expect(verifier.verify(mint({}, { key: other.privateKey }))).rejects.toThrow(
      /does not verify/
    );
  });

  it('refuses a token with no subject', async () => {
    await expect(verifier.verify(mint({ sub: undefined }))).rejects.toThrow(/no subject/);
  });

  it('refuses something that is not a JWT', async () => {
    await expect(verifier.verify('not.a.jwt')).rejects.toThrow();
    await expect(verifier.verify('two.parts')).rejects.toThrow(/not a JWT/);
  });

  /**
   * An unknown `kid` is the normal shape of key rotation, so one refetch is
   * right — but a made-up `kid` must not become an unauthenticated request
   * amplifier against the IdP.
   */
  it('refetches once for an unknown key, then stops', async () => {
    await verifier.verify(mint());
    expect(endpoint.count()).toBe(1);

    await expect(verifier.verify(mint({}, { kid: 'made-up' }))).rejects.toThrow();
    const afterFirst = endpoint.count();

    await expect(verifier.verify(mint({}, { kid: 'made-up' }))).rejects.toThrow();
    await expect(verifier.verify(mint({}, { kid: 'also-made-up' }))).rejects.toThrow();

    // Rate-limited: the extra attempts did not each hit the IdP.
    expect(endpoint.count()).toBe(afterFirst);
  });

  it('is inert when no issuer is configured', async () => {
    const unconfigured = new OidcVerifier([], endpoint.impl);

    expect(unconfigured.configured).toBe(false);
    await expect(unconfigured.verify(mint())).rejects.toThrow(/not trusted/);
  });
});
