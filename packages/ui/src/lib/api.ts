import { cookies } from 'next/headers';
import type { CurrentUser } from './access';

/**
 * Talking to the API from the server.
 *
 * Every page fetches its data **on the server**, forwarding the browser's
 * cookies. That is not a performance choice: the session is an `HttpOnly`
 * cookie, so client-side JavaScript cannot read it and must not be given a
 * second credential to work around that. Rendering on the server means the
 * token never reaches the page.
 *
 * Client components that need to *act* — retry a task, claim an approval — go
 * through `mutate.ts`, which is the one place that deals with CSRF.
 */

const API = process.env.NODE_FLOW_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Fetches from the API as the signed-in user.
 *
 * `cache: 'no-store'` on everything, deliberately. This is an operations
 * console: an execution view cached showing a workflow as running after it
 * failed is worse than a slow one, and every page here is about state that
 * changes underneath the reader.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const jar = await cookies();
  const cookie = jar.toString();

  // Search is a POST — the API takes a structured query rather than a
  // query-string DSL — so a *read* trips the CSRF check like any other
  // cookie-authenticated mutation. Supplying the header here is not a
  // workaround: the double-submit defence rests on an attacker's page being
  // unable to *read* the cookie, and this process legitimately holds it.
  const csrf = jar.get('nf_csrf')?.value;

  const response = await fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init.headers ?? {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      'content-type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };

    throw new ApiError(
      response.status,
      body.error ?? 'UNKNOWN',
      body.message ?? `request failed with ${response.status}`
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}



/**
 * The signed-in user, or `undefined` when nobody is.
 *
 * Any failure means "not signed in" as far as a page is concerned:
 * distinguishing an expired session from a missing one changes nothing about
 * what gets rendered, and trying to would put an error boundary around every
 * page in the application.
 */
export async function currentUser(): Promise<CurrentUser | undefined> {
  try {
    return await api<CurrentUser>('/v1/auth/me');
  } catch {
    return undefined;
  }
}

export type { CurrentUser } from './access';
