import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { constantTimeEquals, openFlow, sealFlow } from './signed-flow.js';
import { safeReturnTo, type SsoIdentity } from './sso.service.js';

/**
 * SAML 2.0 single sign-on for humans.
 *
 * ## Why a library, and which part is still ours
 *
 * SAML's security rests on XML Digital Signature: canonicalisation, and
 * knowing precisely which element a signature covers. **Signature wrapping** —
 * moving the signed element so a verifier validates one document and reads
 * another — has produced vulnerabilities in most major SAML implementations,
 * repeatedly. That is not code to write from scratch next to a hand-rolled JWT
 * verifier, so signature and assertion validation is `@node-saml/node-saml`'s,
 * a reviewed implementation with the wrapping defences already in it.
 *
 * What stays here is everything the library leaves to the application, and
 * each piece below is a documented way SAML logins are broken:
 *
 *  - **SP-initiated only.** An IdP-initiated assertion arrives unsolicited,
 *    carries no `InResponseTo`, and so cannot be tied to the browser that is
 *    about to be handed a session. Accepting one means anyone who can obtain a
 *    valid assertion — including from a *different* session at the same IdP —
 *    can log a victim's browser into that account. This implementation refuses
 *    an assertion it did not ask for.
 *  - **`InResponseTo` is checked against our own request id**, which we
 *    generate and keep in the signed flow cookie. The library can do this
 *    itself, but only through a cache it keeps in memory, which stops working
 *    the moment a second replica handles the callback. The cookie travels with
 *    the browser, so it works across replicas *and* binds the assertion to the
 *    browser rather than merely to this cluster.
 *  - **`RelayState` is a random token, checked the same way.** It is SAML's
 *    equivalent of OIDC's `state` and it is what stands between this callback
 *    and login CSRF.
 *  - **SHA-256, never SHA-1.** The library still defaults to SHA-1 for
 *    compatibility; requests signed here use SHA-256.
 *  - **Assertions must be signed** (`wantAssertionsSigned`), and the audience
 *    must be *us*. An assertion minted for a different service provider at the
 *    same IdP is a perfectly valid assertion and must not work here.
 *  - **`returnTo` is a path, never a URL** — the same open redirect, one step
 *    after a session is issued.
 *
 * The cookie is `SameSite=None` for this flow alone, because the IdP returns
 * the assertion by a cross-site form POST and a `Lax` cookie is not sent on
 * one. That is safe only because the flow state is signed and single-use, and
 * it is why `RelayState` and `InResponseTo` are both checked.
 */

export interface SamlProvider {
  /** The name in the URL: `/auth/saml/:provider/login`. */
  name: string;
  /** The IdP's single sign-on URL, HTTP-Redirect binding. */
  entryPoint: string;
  /** Our entity id, as registered with the IdP. Also the expected audience. */
  issuer: string;
  /** The Assertion Consumer Service URL the IdP posts to. */
  callbackUrl: string;
  /** The IdP's signing certificate, or several during a rotation. */
  idpCert: string | string[];
  /** The namespace accounts are provisioned into. */
  namespace: string;
  /** Where to find the email, when the IdP uses a name other than the usual ones. */
  emailAttribute?: string;
  nameAttribute?: string;
  /** Signs our AuthnRequests. Optional: most IdPs do not require it. */
  privateKey?: string;
  /** Decrypts encrypted assertions. */
  decryptionPvk?: string;
  /** Our public certificate, published in the metadata so the IdP can verify and encrypt. */
  spCertificate?: string;
  identifierFormat?: string | null;
  signatureAlgorithm?: 'sha256' | 'sha512';
  acceptedClockSkewMs?: number;
}

export interface SamlFlow {
  provider: string;
  /** The `ID` of the AuthnRequest, which the assertion must answer. */
  requestId: string;
  /** SAML's `state`. */
  relay: string;
  returnTo: string;
}

/** An assertion is only accepted this long after it was issued, whatever the IdP allows. */
const MAX_ASSERTION_AGE_MS = 10 * 60 * 1000;

/** The usual attribute names for an email address, in the order IdPs favour them. */
const EMAIL_ATTRIBUTES = [
  'email',
  'mail',
  'emailAddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];

const NAME_ATTRIBUTES = [
  'displayName',
  'name',
  'cn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  'urn:oid:2.16.840.1.113730.3.1.241',
];

@Injectable()
export class SamlService {
  private readonly providers: Map<string, SamlProvider>;
  private readonly secret: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.providers = new Map(
      config.NODE_FLOW_SAML_PROVIDERS.map((provider: SamlProvider) => [provider.name, provider])
    );
    this.secret = config.NODE_FLOW_JWT_SECRET;
  }

  get enabled(): boolean {
    return this.providers.size > 0;
  }

  list(): { name: string; namespace: string; protocol: 'saml' }[] {
    return [...this.providers.values()].map((p) => ({ name: p.name, namespace: p.namespace, protocol: 'saml' }));
  }

  provider(name: string): SamlProvider | undefined {
    return this.providers.get(name);
  }

  /** Builds the redirect that starts a login, and the state to remember. */
  async begin(provider: SamlProvider, returnTo: string): Promise<{ url: string; flow: SamlFlow }> {
    const flow: SamlFlow = {
      provider: provider.name,
      // Must be an XML `ID`, which cannot start with a digit.
      requestId: `_${randomBytes(16).toString('hex')}`,
      relay: randomBytes(32).toString('base64url'),
      returnTo: safeReturnTo(returnTo),
    };

    // The id is fixed for this one request so the callback can check the
    // assertion answers *this* login, rather than any login at this IdP.
    const url = await this.samlFor(provider, () => flow.requestId).getAuthorizeUrlAsync(flow.relay, undefined, {});

    return { url, flow };
  }

  /**
   * Validates a posted assertion and reads the identity out of it.
   *
   * The caller has already confirmed `RelayState` matches the flow; this does
   * the cryptography and the binding to the request.
   */
  async complete(provider: SamlProvider, samlResponse: string, flow: SamlFlow): Promise<SsoIdentity> {
    const { profile, loggedOut } = await this.samlFor(provider).validatePostResponseAsync({ SAMLResponse: samlResponse });

    if (loggedOut || !profile) throw new Error('the identity provider sent a logout message, not a login');

    // The library has confirmed the assertion is authentic, current and meant
    // for us. This is the part it cannot know: that we asked for it.
    if (typeof profile.inResponseTo !== 'string' || !constantTimeEquals(profile.inResponseTo, flow.requestId)) {
      throw new Error('this assertion does not answer the login that started here');
    }

    const attributes = (profile.attributes ?? {}) as Record<string, unknown>;
    const email = first(attributes[provider.emailAttribute ?? ''] ?? pick(attributes, EMAIL_ATTRIBUTES) ?? profile.nameID);
    if (!email || !email.includes('@')) {
      throw new Error('the assertion carries no email address');
    }

    const name = first(attributes[provider.nameAttribute ?? ''] ?? pick(attributes, NAME_ATTRIBUTES));

    return {
      email: email.toLowerCase(),
      name: name && name !== email ? name : undefined,
      // `nameID` is the IdP's stable identifier for the person; the email is
      // what an account is keyed on here, as it is for OIDC.
      subject: profile.nameID ?? email,
    };
  }

  /**
   * The service-provider metadata an administrator uploads to the IdP.
   *
   * Saves transcribing an entity id and an ACS URL by hand, which is where
   * SAML setups usually go wrong: a mistyped ACS URL sends assertions
   * somewhere else, and a mistyped entity id makes every audience check fail.
   */
  metadata(provider: SamlProvider): string {
    const certificate = provider.spCertificate ?? null;
    return this.samlFor(provider).generateServiceProviderMetadata(
      provider.decryptionPvk ? certificate : null,
      certificate
    );
  }

  seal(flow: SamlFlow): string {
    return sealFlow(this.secret, flow);
  }

  open(sealed: string | undefined): SamlFlow | undefined {
    return openFlow<SamlFlow>(this.secret, sealed);
  }

  /** Constant-time comparison of the returned `RelayState` against the remembered one. */
  relayMatches(returned: string, remembered: string): boolean {
    return constantTimeEquals(returned, remembered);
  }

  /**
   * A configured SAML client.
   *
   * Built per call rather than cached: the only per-provider state worth
   * keeping is the certificate list, parsing it costs microseconds next to a
   * redirect, and a fresh instance is what lets `begin` pin the request id.
   */
  private samlFor(provider: SamlProvider, generateUniqueId?: () => string): SAML {
    return new SAML({
      entryPoint: provider.entryPoint,
      issuer: provider.issuer,
      callbackUrl: provider.callbackUrl,
      idpCert: provider.idpCert,
      // The assertion must name us. Without this, an assertion minted for
      // another service provider at the same IdP would be accepted here.
      audience: provider.issuer,
      wantAssertionsSigned: true,
      // Not every IdP signs the response envelope as well as the assertion, and
      // a signed assertion is what carries the identity. The library's own
      // default for the envelope is relaxed here, deliberately and only here.
      wantAuthnResponseSigned: false,
      // We check this ourselves against the flow cookie, which works across
      // replicas where the library's in-memory cache does not.
      validateInResponseTo: ValidateInResponseTo.never,
      maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
      acceptedClockSkewMs: provider.acceptedClockSkewMs ?? 5000,
      // The library still defaults to SHA-1.
      signatureAlgorithm: provider.signatureAlgorithm ?? 'sha256',
      digestAlgorithm: provider.signatureAlgorithm ?? 'sha256',
      identifierFormat: provider.identifierFormat ?? null,
      ...(provider.privateKey ? { privateKey: provider.privateKey } : {}),
      ...(provider.decryptionPvk ? { decryptionPvk: provider.decryptionPvk } : {}),
      ...(generateUniqueId ? { generateUniqueId } : {}),
    });
  }
}

/** SAML attributes arrive as a string or a list of them, depending on the IdP. */
function first(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  if (Array.isArray(value)) return first(value[0]);
  return undefined;
}

function pick(attributes: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (attributes[name] !== undefined) return attributes[name];
  }
  return undefined;
}
