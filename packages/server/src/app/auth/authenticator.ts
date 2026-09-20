import type { Principal } from '@node-flow-dev/core';

/**
 * One way of proving who you are.
 *
 * Phase 1 ships two — API key and service-account bearer token. Phase 5 adds
 * mTLS and OIDC workload identity, and the point of this interface is that
 * doing so touches only {@link AuthenticatorChain}'s provider list: no guard, no
 * controller and no authorization check changes, because all of them read a
 * {@link Principal} and none of them knows how it was produced.
 */
export interface Authenticator {
  /** For logs and the `WWW-Authenticate` header. */
  readonly scheme: string;

  /**
   * Resolves a principal, or `undefined` if this mechanism does not apply.
   *
   * The distinction that matters: return `undefined` when the request carries
   * no credential of *this kind* — a later authenticator may still succeed.
   * Throw only when a credential of this kind was presented and is bad, so a
   * malformed token is reported rather than silently falling through to
   * "unauthenticated".
   */
  authenticate(credentials: PresentedCredentials): Promise<Principal | undefined>;
}

/** What arrived on the request, normalised so authenticators never see HTTP. */
export interface PresentedCredentials {
  /** The `Authorization` header value, if any. */
  authorization?: string;
  /** The `X-API-Key` header value, if any. */
  apiKey?: string;
  /** The raw `Cookie` header, for session authentication. */
  cookie?: string;
  /**
   * The verified client certificate, when the connection used mTLS.
   *
   * `authorized` is separate from the certificate's contents on purpose: a
   * certificate is present on any connection where the client sent one, and
   * only the TLS layer knows whether it chains to a trusted CA. Carrying the
   * verdict alongside the subject makes it impossible to read one without the
   * other.
   */
  clientCertificate?: PresentedCertificate;
}

export interface PresentedCertificate {
  /** Whether the TLS layer verified it against the configured CAs. */
  authorized: boolean;
  authorizationError?: string;
  /** Subject distinguished name, normalised. */
  subject?: string;
  /** Issuing CA's distinguished name, normalised. */
  issuer?: string;
  /** A SPIFFE URI from the SANs, when the certificate carries one. */
  spiffeId?: string;
}

/** Thrown when a credential was presented and is invalid. */
export class InvalidCredentialError extends Error {
  constructor(message = 'invalid credentials') {
    super(message);
  }
}

/**
 * Tries each authenticator in order and returns the first principal.
 *
 * Order is not security-relevant here — the mechanisms read different headers,
 * so at most one applies to any request — but it is fixed rather than
 * incidental, so behaviour does not change if the provider list is reordered.
 */
export class AuthenticatorChain {
  constructor(private readonly authenticators: Authenticator[]) {}

  async resolve(credentials: PresentedCredentials): Promise<Principal | undefined> {
    for (const authenticator of this.authenticators) {
      const principal = await authenticator.authenticate(credentials);
      if (principal) return principal;
    }

    return undefined;
  }

  get schemes(): string[] {
    return this.authenticators.map((a) => a.scheme);
  }
}
