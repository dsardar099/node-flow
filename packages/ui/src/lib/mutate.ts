'use client';

/**
 * Acting on the API from the browser.
 *
 * The one place that knows about CSRF. Every mutating request carries the
 * `nf_csrf` cookie's value in a header, which is the double-submit half of the
 * protection: an attacker's page can cause the browser to *send* the cookie but
 * cannot read it, so it cannot produce the matching header.
 *
 * Requests go to `/v1/...` on this origin and are forwarded to the API by the
 * runtime proxy in `app/v1/[...path]/route.ts`, so the session cookie is sent
 * without `SameSite=None` or a CORS allowlist.
 */

export class MutationError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)nf_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function mutate<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken(),
    },
    // Same-origin by construction; stated rather than assumed, because a
    // future move to a separate host would silently stop sending the session.
    credentials: 'same-origin',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new MutationError(response.status, body.message ?? `request failed with ${response.status}`);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
