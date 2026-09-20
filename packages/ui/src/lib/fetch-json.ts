'use client';

import { MutationError } from './mutate';

/**
 * A GET from the browser, through the same-origin proxy.
 *
 * Reads need no CSRF header — double-submit protects state changes — so this
 * is separate from `mutate`, and throws the same error type so callers handle
 * both alike.
 */
export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new MutationError(response.status, body.message ?? `request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}
