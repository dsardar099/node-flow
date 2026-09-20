import { describe, expect, it } from 'vitest';
import { can, type CurrentUser } from './access';

/**
 * The dashboard's copy of the server's scope rule.
 *
 * Two copies of an authorization rule will drift, and the direction that hurt
 * here is the permissive one: this file treated `admin` as satisfying
 * everything, while the server deliberately excludes `platform:admin` from
 * that. The result was a namespace administrator being shown the Namespaces
 * screen and then refused by the API — and a menu that leads to a 403 teaches
 * people to distrust the menu.
 *
 * These assert the *refusals*. The permissive cases were never the problem.
 */

function user(scopes: string[]): CurrentUser {
  return {
    id: 'u1',
    email: 'a@b.c',
    name: 'A',
    namespaceId: 'n1',
    namespace: 'default',
    scopes,
    tagGrants: [],
  };
}

describe('can', () => {
  it('lets admin through for ordinary scopes', () => {
    expect(can(user(['admin']), 'workflows:read')).toBe(true);
    expect(can(user(['admin']), 'executions:start')).toBe(true);
  });

  /**
   * The carve-out, and the reason multi-tenancy means anything: a tenant's
   * administrator must not be able to create or enumerate tenants.
   */
  it('does not let admin through for platform:admin', () => {
    expect(can(user(['admin']), 'platform:admin')).toBe(false);
  });

  it('grants platform:admin only by its exact name', () => {
    expect(can(user(['platform:admin']), 'platform:admin')).toBe(true);
    expect(can(user(['admin', 'platform:admin']), 'platform:admin')).toBe(true);
  });

  it('does not let a wildcard reach platform:admin', () => {
    // `platform:*` would otherwise cover it, which is exactly the accidental
    // acquisition the server's rule exists to prevent.
    expect(can(user(['platform:*']), 'platform:admin')).toBe(false);
  });

  it('refuses everything without a user', () => {
    expect(can(undefined, 'workflows:read')).toBe(false);
    expect(can(undefined, 'platform:admin')).toBe(false);
  });

  it('still honours exact scopes and wildcards elsewhere', () => {
    expect(can(user(['workflows:read']), 'workflows:read')).toBe(true);
    expect(can(user(['workflows:read']), 'workflows:write')).toBe(false);
    expect(can(user(['executions:*']), 'executions:start')).toBe(true);
    expect(can(user(['executions:*']), 'workflows:read')).toBe(false);
  });
});
