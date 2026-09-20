import { describe, expect, it } from 'vitest';
import { PrincipalType, Scope, type Principal } from './auth.js';
import { grantCovers, hasAnyGrant, isValidGrantTarget, mayAccess, type ResourceGrant } from './permissions.js';

const principal = (scopes: string[], resourceGrants: ResourceGrant[] = [], tagGrants: string[] = []): Principal => ({
  type: PrincipalType.USER,
  id: 'u1',
  name: 'Ada',
  namespaceId: 'ns',
  scopes,
  tagGrants,
  resourceGrants,
});
const workflow = (name: string, tags: string[] = []) => ({ type: 'WORKFLOW' as const, name, tags });

describe('resource grants', () => {
  it('matches exact names, prefixes, tags and everything', () => {
    expect(grantCovers('checkout', 'checkout', [])).toBe(true);
    expect(grantCovers('checkout', 'checkout_eu', [])).toBe(false);
    expect(grantCovers('checkout*', 'checkout_eu', [])).toBe(true);
    expect(grantCovers('tag:team:payments', 'x', ['team:payments'])).toBe(true);
    expect(grantCovers('tag:team:*', 'x', ['team:billing'])).toBe(true);
    expect(grantCovers('tag:team:payments', 'x', ['team:billing'])).toBe(false);
    expect(grantCovers('*', 'anything', [])).toBe(true);
  });

  it('validates targets', () => {
    for (const ok of ['checkout', 'checkout_*', 'tag:team:payments', 'tag:env:*', '*']) expect(isValidGrantTarget(ok)).toBe(true);
    for (const bad of ['', 'has space', 'tag:', 'tag:NoColon', 'tag:team:pay*ments', 'a*b']) expect(isValidGrantTarget(bad)).toBe(false);
  });

  it('lets a grant stand in for a missing scope, for that resource and that access only', () => {
    const contractor = principal([], [{ resourceType: 'WORKFLOW', resource: 'refund', access: ['EXECUTE'] }]);
    expect(mayAccess(contractor, workflow('refund'), 'EXECUTE', Scope.EXECUTIONS_START)).toBe(true);
    // Any access implies reading.
    expect(mayAccess(contractor, workflow('refund'), 'READ', Scope.EXECUTIONS_READ)).toBe(true);
    expect(mayAccess(contractor, workflow('refund'), 'UPDATE', Scope.WORKFLOWS_WRITE)).toBe(false);
    expect(mayAccess(contractor, workflow('checkout'), 'READ', Scope.EXECUTIONS_READ)).toBe(false);
    expect(hasAnyGrant(contractor, 'WORKFLOW', 'EXECUTE')).toBe(true);
    expect(hasAnyGrant(contractor, 'WORKFLOW', 'DELETE')).toBe(false);
    expect(hasAnyGrant(contractor, 'TASK_DEFINITION', 'READ')).toBe(false);
  });

  it('keeps scopes and tag restrictions as they were, and lets a named grant reach a tagged resource', () => {
    const reader = principal([Scope.EXECUTIONS_READ]);
    expect(mayAccess(reader, workflow('open'), 'READ', Scope.EXECUTIONS_READ)).toBe(true);
    expect(mayAccess(reader, workflow('vault', ['env:prod']), 'READ', Scope.EXECUTIONS_READ)).toBe(false);

    const named = principal([Scope.EXECUTIONS_READ], [{ resourceType: 'WORKFLOW', resource: 'vault', access: ['READ'] }]);
    expect(mayAccess(named, workflow('vault', ['env:prod']), 'READ', Scope.EXECUTIONS_READ)).toBe(true);
    expect(mayAccess(principal([Scope.ADMIN]), workflow('vault', ['env:prod']), 'DELETE', Scope.WORKFLOWS_WRITE)).toBe(true);
  });
});
