import { randomBytes } from 'node:crypto';

/**
 * Session cookies, and the CSRF defence that has to come with them.
 *
 * The cookie is `HttpOnly`, which is the single most important decision here:
 * script cannot read it, so an XSS bug cannot exfiltrate a session. A token in
 * `localStorage` — the common alternative — is readable by any injected script,
 * which turns every XSS into a full account takeover.
 *
 * The cost of a cookie is that browsers attach it *automatically*, including on
 * requests another site caused. That is CSRF, and it is why the second half of
 * this file exists.
 */

export const SESSION_COOKIE = 'nf_session';
export const CSRF_COOKIE = 'nf_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface CookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

/**
 * Serialises the session cookie.
 *
 * - `HttpOnly` — script cannot read it, so XSS cannot steal the session.
 * - `SameSite=Lax` — not sent on cross-site POSTs, which blocks the classic
 *   form-submission CSRF outright while still surviving a top-level navigation
 *   back into the app, so following a link to the dashboard keeps you logged in.
 * - `Secure` — never sent over plaintext. Off only in development, because a
 *   `Secure` cookie over `http://localhost` is simply dropped and login appears
 *   to silently fail.
 * - `Path=/` — the API and the UI share an origin.
 */
export function sessionCookie(token: string, options: CookieOptions): string {
  return serialise(SESSION_COOKIE, token, {
    ...options,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

/**
 * The CSRF cookie, deliberately **readable by script**.
 *
 * This is the double-submit pattern: the same value goes in a cookie and, by
 * the page's own code, into a request header. An attacking site can cause the
 * cookie to be sent but cannot read it — the same-origin policy stops that —
 * so it cannot produce the matching header.
 *
 * `SameSite=Lax` already blocks most CSRF on its own. This is the second layer,
 * because `Lax` still permits top-level `GET` navigation and because a single
 * misconfigured `SameSite=None` cookie elsewhere should not undo everything.
 */
export function csrfCookie(token: string, options: CookieOptions): string {
  return serialise(CSRF_COOKIE, token, {
    ...options,
    httpOnly: false,
    sameSite: 'Lax',
  });
}

/** Expires a cookie. `Max-Age=0` with an empty value is the reliable spelling. */
export function clearCookie(name: string, secure: boolean): string {
  return serialise(name, '', { secure, maxAgeSeconds: 0, httpOnly: true, sameSite: 'Lax' });
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Reads one cookie out of a `Cookie` header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      // A malformed cookie is not a valid session; treat it as absent rather
      // than letting a decode error become a 500.
      return undefined;
    }
  }

  return undefined;
}

function serialise(
  name: string,
  value: string,
  options: CookieOptions & { httpOnly: boolean; sameSite: 'Lax' | 'Strict' | 'None' }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${options.maxAgeSeconds}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');

  return parts.join('; ');
}
