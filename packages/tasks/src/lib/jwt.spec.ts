import { generateKeyPairSync } from 'node:crypto';
import {
  constants,
  createVerify,
  createHmac,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import type { TaskContext } from './executor.js';
import { SignedJwtTaskExecutor } from './jwt.executor.js';

/**
 * `GET_SIGNED_JWT`.
 *
 * A token that merely looks well-formed is worthless, so these tests verify
 * signatures with an independent code path rather than asserting on the shape
 * of the string — which is exactly the mistake that lets a wrongly-encoded ES256
 * signature pass a test suite and fail against every real verifier.
 */

const context = (input: Record<string, JsonValue>): TaskContext => ({
  taskId: 'task-1',
  workflowId: 'wf-1',
  namespaceId: 'ns-1',
  input,
  signal: new AbortController().signal,
  state: {},
  heartbeat: async () => undefined,
});

const run = (input: Record<string, JsonValue>) =>
  new SignedJwtTaskExecutor().execute(context(input));

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = (key: KeyObject) =>
  String(key.export({ type: 'pkcs8', format: 'pem' }));

const parts = (token: string) => token.split('.');
const decode = (segment: string) =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

async function token(input: Record<string, JsonValue>): Promise<string> {
  const outcome = await run(input);
  expect(outcome.status).toBe('COMPLETED');
  return String(outcome.output?.['token']);
}

describe('minting', () => {
  it('has the declared type', () => {
    expect(new SignedJwtTaskExecutor().type).toBe(TaskType.GET_SIGNED_JWT);
  });

  it('produces three base64url segments', async () => {
    const value = await token({
      privateKey: pem(rsa.privateKey),
      subject: 'a',
    });
    expect(parts(value)).toHaveLength(3);
    expect(value).not.toContain('=');
    expect(value).not.toContain('+');
  });

  it('carries the registered claims', async () => {
    const value = await token({
      privateKey: pem(rsa.privateKey),
      issuer: 'node-flow',
      subject: 'svc@example.com',
      audience: 'https://api.example.com',
      ttlInSecond: 600,
    });

    const claims = decode(parts(value)[1]);
    expect(claims.iss).toBe('node-flow');
    expect(claims.sub).toBe('svc@example.com');
    expect(claims.aud).toBe('https://api.example.com');
    expect(claims.exp - claims.iat).toBe(600);
  });

  // Seconds, not milliseconds. A millisecond `exp` produces a token that looks
  // valid and is rejected everywhere, dated some 54,000 years out.
  it('expresses time in seconds since the epoch', async () => {
    const claims = decode(
      parts(await token({ privateKey: pem(rsa.privateKey) }))[1],
    );
    const now = Math.floor(Date.now() / 1000);

    expect(claims.iat).toBeGreaterThan(now - 5);
    expect(claims.iat).toBeLessThanOrEqual(now + 1);
  });

  it('sets kid when a key id is given', async () => {
    const value = await token({
      privateKey: pem(rsa.privateKey),
      privateKeyId: 'key-7',
    });
    expect(decode(parts(value)[0]).kid).toBe('key-7');
  });

  it('merges caller claims without letting them override expiry', async () => {
    const value = await token({
      privateKey: pem(rsa.privateKey),
      ttlInSecond: 60,
      payload: { role: 'admin', exp: 99 },
    });

    const claims = decode(parts(value)[1]);
    expect(claims.role).toBe('admin');
    expect(claims.exp).not.toBe(99);
  });

  // Output is stored, indexed and shown in the UI.
  it('never echoes the key into its output', async () => {
    const key = pem(rsa.privateKey);
    const outcome = await run({ privateKey: key, subject: 'a' });

    expect(JSON.stringify(outcome.output)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(outcome.output)).not.toContain(key.slice(40, 80));
  });
});

describe('signatures a real verifier would accept', () => {
  it('RS256 verifies against the public key', async () => {
    const value = await token({
      privateKey: pem(rsa.privateKey),
      algorithm: 'RS256',
    });
    const [header, payload, signature] = parts(value);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);

    expect(
      verifier.verify(rsa.publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true);
  });

  /**
   * The one most likely to be wrong.
   *
   * OpenSSL emits a DER-wrapped ECDSA signature; JWS requires the raw r‖s pair.
   * A DER signature is a perfectly well-formed token that every conforming
   * verifier rejects — invisible to any test that only checks the shape.
   */
  it('ES256 is raw r‖s, not DER', async () => {
    const value = await token({
      privateKey: pem(ec.privateKey),
      algorithm: 'ES256',
    });
    const [header, payload, signature] = parts(value);
    const raw = Buffer.from(signature, 'base64url');

    // Raw r‖s for P-256 is always exactly 64 bytes. DER is 69–72 — measured
    // over 20,000 signatures, never once 64 — so the length alone rules DER
    // out, and the `ieee-p1363` verification below rules it out again: DER
    // bytes fed to a raw verifier do not verify. Both are deterministic.
    //
    // This used to also assert `raw[0] !== 0x30`, on the reasoning that DER
    // starts with the SEQUENCE tag. That check was redundant against the two
    // above, and it failed roughly once in 256 runs for the most boring reason
    // there is: `r` is a random 256-bit integer, so its first byte is 0x30 as
    // often as any other value. Measured at 0.34% over 20,000 signatures. It
    // failed on the v1.0.0 release tag and stopped the publish.
    expect(raw).toHaveLength(64);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(
      verifier.verify({ key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, raw),
    ).toBe(true);
  });

  it('HS256 verifies against the shared secret', async () => {
    const secret = 'a-shared-secret-of-reasonable-length';
    const value = await token({ privateKey: secret, algorithm: 'HS256' });
    const [header, payload, signature] = parts(value);

    const expected = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest();
    const actual = Buffer.from(signature, 'base64url');

    expect(actual.length).toBe(expected.length);
    expect(timingSafeEqual(actual, expected)).toBe(true);
  });

  it('PS256 verifies with PSS padding', async () => {
    const value = await token({
      privateKey: pem(rsa.privateKey),
      algorithm: 'PS256',
    });
    const [header, payload, signature] = parts(value);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);

    expect(
      verifier.verify(
        {
          key: rsa.publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
        },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });
});

describe('refusing', () => {
  // `none` is a legal JWT algorithm and the most exploited weakness in JWT's
  // history: a token signed with it validates against any verifier honouring
  // the header. There is no legitimate use for it.
  it('refuses the "none" algorithm', async () => {
    const outcome = await run({ privateKey: 'x', algorithm: 'none' });
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });

  it('refuses an unknown algorithm', async () => {
    const outcome = await run({ privateKey: 'x', algorithm: 'RS999' });
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });

  it('fails terminally with no key', async () => {
    const outcome = await run({ subject: 'a' });
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });

  // A malformed key is malformed on every attempt.
  it('treats an unusable key as terminal', async () => {
    const outcome = await run({ privateKey: 'not a pem', algorithm: 'RS256' });
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });
});
