/**
 * A post-login destination that cannot leave this site.
 *
 * `returnTo` arrives in the query string, so anyone can craft a sign-in link
 * that lands a freshly authenticated user on a look-alike page. Only a path on
 * this origin is honoured; the same rule the API applies to SSO.
 */
export function safeReturnTo(value: string | undefined | null, fallback = '/executions'): string {
  if (!value || !value.startsWith('/')) return fallback;
  // `//host` is protocol-relative, and browsers read `/\host` the same way.
  if (value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}
