import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A short-lived login flow carried in a signed cookie.
 *
 * Both single sign-on protocols need the same thing: a few values remembered
 * across a round trip through an identity provider, in a place the browser
 * carries but cannot forge. A table would need a sweeper for the abandoned
 * logins that are the normal case, and the state is browser-bound by nature,
 * so it rides in an HttpOnly cookie with an HMAC over it.
 *
 * The signature is what makes this safe: an unsigned cookie would let a caller
 * choose their own `state`, which is the same as having no `state` at all.
 */

export function sealFlow(secret: string, flow: unknown): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${payload}.${signPayload(secret, payload)}`;
}

export function openFlow<T>(secret: string, sealed: string | undefined): T | undefined {
  if (!sealed) return undefined;

  const [payload, signature] = sealed.split('.');
  if (!payload || !signature) return undefined;

  if (!constantTimeEquals(signature, signPayload(secret, payload))) return undefined;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

/**
 * Compares two values without leaking where they first differ.
 *
 * The length check comes first because `timingSafeEqual` *throws* on differing
 * lengths, which would turn a forged cookie into a 500 rather than a refusal.
 */
export function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
