import { generateKeyPairSync } from 'node:crypto';
import { signSamlPost } from '@node-saml/node-saml/lib/saml-post-signing.js';

/**
 * A stand-in identity provider, for tests.
 *
 * Imported only by specs — nothing in the running server references it, so it
 * never reaches a bundle. It lives beside the service rather than inside one
 * spec file because two suites need it: the unit tests that attack the
 * assertion, and the API tests that drive the routes end to end.
 *
 * Signing uses `@node-saml/node-saml`'s own signer, which is what makes a
 * "correctly signed, wrong login" assertion possible to construct — the case
 * that matters most and that a hand-rolled fixture usually cannot produce.
 */

export interface IdentityProvider {
  /** An RSA public key in PEM, usable directly as `idpCert`. */
  publicKey: string;
  privateKey: string;
  entityId: string;
}

export function fakeIdp(entityId = 'https://idp.test/metadata'): IdentityProvider {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey: pair.publicKey, privateKey: pair.privateKey, entityId };
}

export interface AssertionOptions {
  idp: IdentityProvider;
  inResponseTo: string;
  /** The service provider the assertion is addressed to. */
  audience: string;
  /** The ACS URL it may be delivered to. */
  recipient: string;
  email?: string;
  name?: string;
  notOnOrAfter?: Date;
  issueInstant?: Date;
  /** What the provider signs: the assertion, only the envelope, or nothing. */
  sign?: 'assertion' | 'response' | 'none';
}

/** A base64 `SAMLResponse`, as an identity provider would post one. */
export function samlResponse(options: AssertionOptions): string {
  const now = options.issueInstant ?? new Date();
  const until = options.notOnOrAfter ?? new Date(Date.now() + 5 * 60_000);
  const email = options.email ?? 'ada@example.com';
  const id = Date.now().toString(16) + Math.random().toString(16).slice(2, 8);

  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp${id}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${options.recipient}" InResponseTo="${options.inResponseTo}">
  <saml:Issuer>${options.idp.entityId}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="_a${id}" Version="2.0" IssueInstant="${now.toISOString()}">
    <saml:Issuer>${options.idp.entityId}</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData InResponseTo="${options.inResponseTo}" Recipient="${options.recipient}" NotOnOrAfter="${until.toISOString()}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="${new Date(now.getTime() - 60_000).toISOString()}" NotOnOrAfter="${until.toISOString()}">
      <saml:AudienceRestriction><saml:Audience>${options.audience}</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="_s1">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="displayName"><saml:AttributeValue>${options.name ?? 'Ada Lovelace'}</saml:AttributeValue></saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

  const target = options.sign ?? 'assertion';
  const signed =
    target === 'none'
      ? xml
      : signSamlPost(xml, `//*[local-name(.)='${target === 'response' ? 'Response' : 'Assertion'}']`, {
          privateKey: options.idp.privateKey,
          signatureAlgorithm: 'sha256',
          digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        });

  return Buffer.from(signed).toString('base64');
}
