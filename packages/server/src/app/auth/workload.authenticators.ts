import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '@node-flow-dev/core';
import { WorkloadIdentityRepository } from '@node-flow-dev/store';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import {
  InvalidCredentialError,
  type Authenticator,
  type PresentedCredentials,
} from './authenticator.js';
import { OidcVerifier } from './oidc-verifier.js';

/**
 * The two mechanisms that let a workload authenticate **without holding a
 * secret** — the point of both being that there is no credential to leak,
 * rotate or accidentally commit.
 *
 * Both resolve through the same binding table, because they differ only in what
 * the external identity is called.
 */

/**
 * OIDC workload identity — IRSA, GCP Workload Identity, SPIFFE.
 *
 * The platform mints a short-lived token the workload never chose and cannot
 * exfiltrate usefully, and this verifies it against the issuer's published
 * keys. Verification lives in {@link OidcVerifier}; this class only maps a
 * verified `(iss, sub)` to a principal.
 */
@Injectable()
export class OidcWorkloadAuthenticator implements Authenticator {
  readonly scheme = 'Bearer';
  private readonly verifier: OidcVerifier;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly identities: WorkloadIdentityRepository
  ) {
    this.verifier = new OidcVerifier(config.NODE_FLOW_OIDC_ISSUERS);
  }

  async authenticate(credentials: PresentedCredentials): Promise<Principal | undefined> {
    if (!this.verifier.configured) return undefined;

    const token = credentials.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return undefined;

    let verified;
    try {
      verified = await this.verifier.verify(token);
    } catch {
      // Not ours. A bearer token here may be a service-account JWT that the
      // next authenticator in the chain issues and understands, so a token
      // this mechanism cannot verify must fall through rather than fail the
      // request — and the message is deliberately not propagated, because it
      // would describe our trust configuration to an unauthenticated caller.
      return undefined;
    }

    const principal = await this.identities.resolve('oidc', verified.issuer, verified.subject);

    if (!principal) {
      // A *verified* token with no binding is different: the caller proved an
      // identity this install simply has not authorised. Saying so is honest
      // and is the difference between "your token is broken" and "ask an
      // administrator to bind it".
      throw new InvalidCredentialError(
        `workload identity ${verified.subject} is not bound to a service account`
      );
    }

    return principal;
  }
}

/**
 * mTLS — the client proves a private key it never sends.
 *
 * The critical check is `authorized`. A peer certificate is *present* on any
 * connection where the client sent one; only the TLS layer can say whether it
 * chains to a trusted CA. Reading the subject without checking that is
 * authentication by self-assertion, and it is the classic way mTLS is
 * implemented wrongly.
 */
@Injectable()
export class MtlsAuthenticator implements Authenticator {
  readonly scheme = 'mTLS';

  constructor(private readonly identities: WorkloadIdentityRepository) {}

  async authenticate(credentials: PresentedCredentials): Promise<Principal | undefined> {
    const certificate = credentials.clientCertificate;
    if (!certificate) return undefined;

    if (!certificate.authorized) {
      // Presented and not trusted: a refusal rather than a fall-through,
      // because the caller clearly intended to authenticate this way.
      throw new InvalidCredentialError(
        certificate.authorizationError
          ? `client certificate rejected: ${certificate.authorizationError}`
          : 'client certificate is not trusted'
      );
    }

    // A SPIFFE identity lives in a URI SAN and is preferred when present: it is
    // a stable, purpose-built name, where a subject DN is a human-edited string
    // that changes when someone reissues a certificate with a different OU.
    const subject = certificate.spiffeId ?? certificate.subject;
    if (!subject || !certificate.issuer) return undefined;

    const principal = await this.identities.resolve('mtls', certificate.issuer, subject);

    if (!principal) {
      throw new InvalidCredentialError(
        `client certificate ${subject} is not bound to a service account`
      );
    }

    return principal;
  }
}
