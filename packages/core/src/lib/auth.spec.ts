import { describe, expect, it } from 'vitest';
import {
  Principal,
  PrincipalType,
  Scope,
  hasAllScopes,
  hasScope,
  isValidScope,
  isValidTag,
  mayReachTags,
  queueScope,
  scopeSatisfies,
  systemPrincipal,
} from './auth.js';

/**
 * Scope matching, tested for what it must *refuse*.
 *
 * An authorization test that only checks the allow cases proves nothing — the
 * bug that matters is the one that grants something nobody intended, and it is
 * invisible unless the denials are asserted explicitly.
 */

const principal = (scopes: string[]): Principal => ({
  type: PrincipalType.SERVICE_ACCOUNT,
  id: 'sa-1',
  name: 'workers',
  namespaceId: 'ns-1',
  scopes,
});

describe('scopeSatisfies', () => {
  it('matches exactly', () => {
    expect(scopeSatisfies('executions:read', 'executions:read')).toBe(true);
    expect(scopeSatisfies('executions:read', 'executions:write')).toBe(false);
  });

  /**
   * The one exception to `admin` covering everything, and the reason
   * multi-tenancy holds: a tenant's administrator must not be able to create
   * tenants or enumerate them.
   */
  it('does not let admin, or any wildcard, satisfy platform:admin', () => {
    expect(scopeSatisfies('admin', 'platform:admin')).toBe(false);
    expect(scopeSatisfies('platform:*', 'platform:admin')).toBe(false);
    expect(scopeSatisfies('*', 'platform:admin')).toBe(false);
    // Only its exact name grants it.
    expect(scopeSatisfies('platform:admin', 'platform:admin')).toBe(true);
    // And holding it grants nothing else on its own.
    expect(scopeSatisfies('platform:admin', 'workflows:read')).toBe(false);
  });

  it('expands a trailing wildcard one segment', () => {
    expect(scopeSatisfies('queues:lease:*', 'queues:lease:charge')).toBe(true);
    expect(scopeSatisfies('queues:*', 'queues:lease')).toBe(true);
  });

  // The failure that matters: a wildcard must not satisfy its own bare prefix,
  // or `queues:lease:*` would grant `queues:lease` on every queue at once.
  it('does not let a wildcard match the empty remainder', () => {
    expect(scopeSatisfies('queues:lease:*', 'queues:lease:')).toBe(false);
    expect(scopeSatisfies('queues:lease:*', 'queues:lease')).toBe(false);
  });

  // Prefix matching would make `executions:read` satisfy `executions:readwrite`.
  it('never matches on a bare string prefix', () => {
    expect(scopeSatisfies('executions:read', 'executions:readwrite')).toBe(false);
    expect(scopeSatisfies('exec', 'executions:read')).toBe(false);
  });

  it('treats admin as satisfying everything', () => {
    expect(scopeSatisfies(Scope.ADMIN, 'queues:lease:charge')).toBe(true);
    expect(scopeSatisfies(Scope.ADMIN, 'anything:at:all')).toBe(true);
  });

  it('does not let a wildcard forge admin', () => {
    expect(scopeSatisfies('*', Scope.ADMIN)).toBe(false);
    expect(scopeSatisfies('admin:*', Scope.ADMIN)).toBe(false);
  });
});

describe('hasScope', () => {
  it('reads across every granted scope', () => {
    const worker = principal(['queues:lease:charge', Scope.TASKS_REPORT]);
    expect(hasScope(worker, queueScope('charge'))).toBe(true);
    expect(hasScope(worker, Scope.TASKS_REPORT)).toBe(true);
  });

  // A fleet processing `charge` must not be able to drain `send_email`. This is
  // the reason queue scopes carry the queue name at all.
  it('confines a worker to its own queue', () => {
    const worker = principal(['queues:lease:charge']);
    expect(hasScope(worker, queueScope('send_email'))).toBe(false);
  });

  it('grants nothing to a principal with no scopes', () => {
    const nobody = principal([]);
    expect(hasScope(nobody, Scope.EXECUTIONS_READ)).toBe(false);
    expect(hasScope(nobody, Scope.ADMIN)).toBe(false);
  });

  it('requires every scope, not merely one', () => {
    const reader = principal([Scope.EXECUTIONS_READ]);
    expect(hasAllScopes(reader, [Scope.EXECUTIONS_READ])).toBe(true);
    expect(hasAllScopes(reader, [Scope.EXECUTIONS_READ, Scope.EXECUTIONS_WRITE])).toBe(false);
  });

  it('allows an empty requirement', () => {
    expect(hasAllScopes(principal([]), [])).toBe(true);
  });
});

describe('isValidScope', () => {
  it('accepts the shapes the system issues', () => {
    for (const scope of [
      Scope.ADMIN,
      Scope.EXECUTIONS_READ,
      'queues:lease:*',
      queueScope('charge'),
      queueScope('charge:eu-west'),
      // Multi-word names were rejected outright until the pattern allowed a
      // hyphen, which made the scope unissuable and the feature unusable.
      Scope.HUMAN_TASKS_READ,
      Scope.HUMAN_TASKS_WRITE,
    ]) {
      expect(isValidScope(scope), scope).toBe(true);
    }
  });

  // Granting an unsatisfiable scope is silent: the account is created, the
  // operator believes it is authorised, and every call 403s.
  it('rejects shapes that could never be satisfied', () => {
    for (const scope of ['', 'executions', 'EXECUTIONS:READ', 'executions read', '::']) {
      expect(isValidScope(scope), scope).toBe(false);
    }
  });
});

describe('systemPrincipal', () => {
  it('is scoped to one namespace despite being admin', () => {
    const system = systemPrincipal('ns-9');
    expect(system.namespaceId).toBe('ns-9');
    expect(hasScope(system, Scope.ADMIN)).toBe(true);
  });
});

/**
 * Tag-based access.
 *
 * Written for what it refuses, like the scope tests above: the failure that
 * matters is a grant reaching something nobody intended.
 */
describe('mayReachTags', () => {
  // An untagged resource is governed by scopes alone — exactly the access it
  // had before tagging existed.
  it('allows an untagged resource regardless of grants', () => {
    expect(mayReachTags([], [])).toBe(true);
    expect(mayReachTags(['env:dev'], [])).toBe(true);
  });

  it('allows a tagged resource when a grant matches', () => {
    expect(mayReachTags(['env:prod'], ['env:prod'])).toBe(true);
  });

  // One matching tag is enough: tags describe a resource from several angles,
  // and requiring all of them would make a second tag a lockout.
  it('allows when any one tag matches', () => {
    expect(mayReachTags(['team:payments'], ['env:prod', 'team:payments'])).toBe(true);
  });

  it('refuses a tagged resource with no matching grant', () => {
    expect(mayReachTags(['env:dev'], ['env:prod'])).toBe(false);
    expect(mayReachTags([], ['env:prod'])).toBe(false);
  });

  it('matches a trailing wildcard, like scopes do', () => {
    expect(mayReachTags(['team:*'], ['team:payments'])).toBe(true);
    expect(mayReachTags(['team:*'], ['env:prod'])).toBe(false);
  });

  // The wildcard must not match the bare prefix, or `team:*` would grant a tag
  // literally named `team:`.
  it('requires something after the wildcard prefix', () => {
    expect(mayReachTags(['team:*'], ['team:'])).toBe(false);
  });

  // No prefix matching, exactly as with scopes: `env:prod` must never reach
  // `env:production`.
  it('does not match by prefix', () => {
    expect(mayReachTags(['env:prod'], ['env:production'])).toBe(false);
  });

  it('admin reaches everything', () => {
    expect(mayReachTags([Scope.ADMIN], ['env:prod'])).toBe(true);
  });
});

describe('isValidTag', () => {
  it('accepts key:value', () => {
    for (const tag of ['env:prod', 'team:payments-eu', 'cost-centre:1234']) {
      expect(isValidTag(tag), tag).toBe(true);
    }
  });

  // A malformed tag can be stored and never matched, which presents as a
  // resource nobody can reach and nothing to explain why.
  it('refuses anything that could never be matched', () => {
    for (const tag of ['noseparator', 'Env:prod', ':prod', 'env:', 'env prod:x', '']) {
      expect(isValidTag(tag), tag).toBe(false);
    }
  });
});
