import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/**
 * Verifies an OIDC workload-identity token.
 *
 * Hand-rolled rather than pulled from a library, and that deserves a reason: a
 * JWT verifier is a well-known set of checks, each of which has a documented
 * CVE for skipping it, and the whole of it is a hundred lines against Node's
 * own crypto. Node 24 reads JWK keys natively, so there is no key-conversion
 * code — the part that usually justifies a dependency.
 *
 * Every check below exists because omitting it is a published attack:
 *
 *  - **The algorithm comes from the key, never the token.** Trusting the header
 *    is `alg` confusion: a token claiming `HS256` verified against an RSA
 *    *public* key turns a public value into a signing secret. `none` is
 *    likewise never consulted, because it is never reached.
 *  - **The issuer must match exactly** a configured issuer. Without it any IdP
 *    on the internet can mint a token for your install.
 *  - **The audience must match.** A token minted for a different service is a
 *    valid token; the audience is what stops it being replayed here.
 *  - **`exp` and `nbf` are enforced** with a small skew, because a token with
 *    no expiry check is a password that never rotates.
 *  - **The key is found by `kid`**, and an unknown `kid` refetches the JWKS at
 *    most once per interval — rotation is normal, and a verifier that cannot
 *    survive it fails an entire fleet at 3am.
 */

export interface TrustedIssuer {
  /** Exact `iss` value. Compared literally; no prefix or suffix matching. */
  issuer: string;
  jwksUri: string;
  /** Required `aud`. A token minted for something else must not work here. */
  audience: string;
}

export interface VerifiedToken {
  issuer: string;
  subject: string;
  claims: Record<string, unknown>;
}

/** Signature algorithms accepted, mapped to what `crypto.verify` needs. */
const ALGORITHMS: Record<string, { hash: string; options?: Record<string, unknown> }> = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  ES256: { hash: 'sha256', options: { dsaEncoding: 'ieee-p1363' } },
  ES384: { hash: 'sha384', options: { dsaEncoding: 'ieee-p1363' } },
  ES512: { hash: 'sha512', options: { dsaEncoding: 'ieee-p1363' } },
  PS256: { hash: 'sha256', options: { padding: 6, saltLength: -1 } },
  PS384: { hash: 'sha384', options: { padding: 6, saltLength: -1 } },
  PS512: { hash: 'sha512', options: { padding: 6, saltLength: -1 } },
};

/** Tolerance for clock drift between this server and the IdP. */
const CLOCK_SKEW_SECONDS = 60;

/** Minimum gap between JWKS fetches, so an unknown `kid` cannot be a DoS. */
const MIN_REFETCH_MS = 60_000;

export class OidcVerifier {
  private readonly keys = new Map<string, { keys: Map<string, KeyObject>; fetchedAt: number }>();

  constructor(
    private readonly issuers: TrustedIssuer[],
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch
  ) {}

  get configured(): boolean {
    return this.issuers.length > 0;
  }

  async verify(token: string): Promise<VerifiedToken> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('not a JWT');

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJson(encodedHeader);
    const claims = decodeJson(encodedPayload);

    const issuer = typeof claims['iss'] === 'string' ? claims['iss'] : undefined;
    if (!issuer) throw new Error('token has no issuer');

    // Exact match against the configured list. Anything looser — a prefix, a
    // hostname check — lets an issuer nobody chose mint tokens for this install.
    const trusted = this.issuers.find((candidate) => candidate.issuer === issuer);
    if (!trusted) throw new Error(`issuer "${issuer}" is not trusted by this install`);

    const algorithm = typeof header['alg'] === 'string' ? header['alg'] : '';
    const spec = ALGORITHMS[algorithm];
    if (!spec) throw new Error(`unsupported algorithm "${algorithm}"`);

    const kid = typeof header['kid'] === 'string' ? header['kid'] : undefined;
    const key = await this.keyFor(trusted, kid);

    // The key type is what decides whether this algorithm is even possible: an
    // RSA key cannot verify an ECDSA signature, and an asymmetric key can never
    // be used as an HMAC secret because no HMAC algorithm is in the table.
    const expectedType = algorithm.startsWith('ES') ? 'ec' : 'rsa';
    if (key.asymmetricKeyType !== expectedType) {
      throw new Error(`token algorithm ${algorithm} does not match the signing key`);
    }

    const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
    const signature = Buffer.from(encodedSignature, 'base64url');

    const ok = verifySignature(
      spec.hash,
      signed,
      { key, ...(spec.options ?? {}) } as never,
      signature
    );
    if (!ok) throw new Error('signature does not verify');

    this.assertTiming(claims);
    this.assertAudience(claims, trusted.audience);

    const subject = typeof claims['sub'] === 'string' ? claims['sub'] : undefined;
    if (!subject) throw new Error('token has no subject');

    return { issuer, subject, claims };
  }

  private assertTiming(claims: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);

    const exp = claims['exp'];
    if (typeof exp !== 'number') throw new Error('token has no expiry');
    if (now > exp + CLOCK_SKEW_SECONDS) throw new Error('token has expired');

    const nbf = claims['nbf'];
    if (typeof nbf === 'number' && now + CLOCK_SKEW_SECONDS < nbf) {
      throw new Error('token is not yet valid');
    }
  }

  /** `aud` is a string or an array; both are legal and both must be checked. */
  private assertAudience(claims: Record<string, unknown>, expected: string): void {
    const aud = claims['aud'];
    const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];

    if (!audiences.includes(expected)) {
      throw new Error(`token audience does not include "${expected}"`);
    }
  }

  /**
   * The signing key for a `kid`, fetching the JWKS if it is unknown.
   *
   * An unknown `kid` is the normal shape of key rotation, so refetching is
   * required — but rate-limited, or a token with a made-up `kid` becomes an
   * unauthenticated request amplifier against the IdP.
   */
  private async keyFor(issuer: TrustedIssuer, kid: string | undefined): Promise<KeyObject> {
    const cached = this.keys.get(issuer.issuer);
    const known = kid ? cached?.keys.get(kid) : undefined;
    if (known) return known;

    // One key and no `kid` is legal and common for small IdPs.
    if (!kid && cached?.keys.size === 1) return [...cached.keys.values()][0];

    const stale = !cached || Date.now() - cached.fetchedAt > MIN_REFETCH_MS;
    if (!stale) throw new Error(`no signing key "${kid ?? '(none)'}" for issuer`);

    const fetched = await this.fetchJwks(issuer);
    this.keys.set(issuer.issuer, { keys: fetched, fetchedAt: Date.now() });

    const key = kid ? fetched.get(kid) : fetched.size === 1 ? [...fetched.values()][0] : undefined;
    if (!key) throw new Error(`no signing key "${kid ?? '(none)'}" for issuer`);

    return key;
  }

  private async fetchJwks(issuer: TrustedIssuer): Promise<Map<string, KeyObject>> {
    const response = await this.fetchImpl(issuer.jwksUri, {
      // Bounded: a hanging IdP must not hold a request open indefinitely.
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`JWKS fetch failed with ${response.status}`);
    }

    const body = (await response.json()) as { keys?: Record<string, unknown>[] };
    const keys = new Map<string, KeyObject>();

    for (const jwk of body.keys ?? []) {
      // Signing keys only. An encryption key in the same document must never
      // be accepted for verification.
      if (jwk['use'] !== undefined && jwk['use'] !== 'sig') continue;

      try {
        keys.set(String(jwk['kid'] ?? ''), createPublicKey({ key: jwk as never, format: 'jwk' }));
      } catch {
        // One unreadable key must not discard the rest of the document.
      }
    }

    if (keys.size === 0) throw new Error('JWKS contained no usable signing keys');
    return keys;
  }
}

function decodeJson(segment: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('malformed JWT segment');
  }
  return parsed as Record<string, unknown>;
}
