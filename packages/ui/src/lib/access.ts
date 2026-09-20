/**
 * What a user may do, decided without touching the server.
 *
 * Kept apart from `api.ts` deliberately: that module imports `next/headers` and
 * is therefore server-only, and a client component that merely wanted to know
 * whether to render a menu item would drag it — and the session cookie
 * machinery — into the browser bundle. Types and pure predicates live here so
 * both sides can share them.
 *
 * Everything here decides **what to show**, never what to allow. The server
 * makes the real decision on every request; this exists so the interface does
 * not offer actions that will come back 403.
 */

export interface CurrentUser {
  type: string;
  id: string;
  name: string;
  namespaceId: string;
  /** The slug every namespaced API path is written with. */
  namespace: string;
  scopes: string[];
  tagGrants: string[];
  /** Per-resource permissions: specific workflows or task definitions beyond the scopes. */
  resourceGrants?: { resourceType: 'WORKFLOW' | 'TASK_DEFINITION'; resource: string; access: string[] }[];
}

/**
 * Mirrors the server's scope rule: exact, `admin`, or a trailing wildcard —
 * with the one carve-out `admin` does not cover.
 *
 * `platform:admin` is granted only by its exact name. That is the whole of
 * multi-tenancy: a tenant's administrator must not be able to create or
 * enumerate tenants. The server has always enforced it (`scopeSatisfies` in
 * `@node-flow-dev/core`); this copy did not, so anyone holding `admin` was
 * shown platform screens the API would then refuse — and a menu that leads to a
 * 403 teaches people to distrust the menu.
 */
export function can(user: CurrentUser | undefined, scope: string): boolean {
  if (!user) return false;

  if (scope === 'platform:admin') return user.scopes.includes('platform:admin');

  return user.scopes.some(
    (held) =>
      held === 'admin' ||
      held === scope ||
      (held.endsWith(':*') && scope.startsWith(held.slice(0, -1)))
  );
}

/**
 * `can`, or a resource grant that could allow it somewhere — for showing a
 * screen whose contents the server filters to what the grants reach. Any
 * access implies READ.
 */
export function canUse(
  user: CurrentUser | undefined,
  scope: string,
  grant?: { type: 'WORKFLOW' | 'TASK_DEFINITION'; access: 'READ' | 'EXECUTE' | 'UPDATE' | 'DELETE' }
): boolean {
  if (can(user, scope)) return true;
  if (!user || !grant) return false;
  return (user.resourceGrants ?? []).some(
    (held) => held.resourceType === grant.type && (grant.access === 'READ' ? held.access.length > 0 : held.access.includes(grant.access))
  );
}
