import { PrincipalType, Scope, hasScope, queueScope } from '@node-flow-dev/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkloadIdentityRepository } from './workload-identity.repository.js';
import { IdentityRepository, InvalidScopeError, hashApiKey } from './identity.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';

/**
 * Credentials.
 *
 * Weighted toward refusal, because that is where the bugs live: a revoked key
 * that still works, an expired one that never expires, a credential that
 * authenticates into the wrong namespace. Every one of those looks like a
 * working system right up until it matters.
 */

let harness: PostgresHarness;
let identity: IdentityRepository;
let namespaceId: string;
let otherNamespaceId: string;

beforeAll(async () => {
  harness = await startPostgresHarness();
  identity = new IdentityRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db, 'tenant-a');
  otherNamespaceId = await seedNamespace(harness.db, 'tenant-b');
});

describe('service accounts', () => {
  it('authenticates with the secret it issued', async () => {
    const issued = await identity.createServiceAccount({
      namespaceId,
      name: 'workers',
      scopes: [queueScope('charge')],
    });

    const principal = await identity.authenticateServiceAccount(issued.keyId, issued.secret);

    expect(principal?.namespaceId).toBe(namespaceId);
    expect(principal?.name).toBe('workers');
    expect(hasScope(principal!, queueScope('charge'))).toBe(true);
  });

  it('never stores the secret in clear', async () => {
    const issued = await identity.createServiceAccount({
      namespaceId,
      name: 'workers',
      scopes: [],
    });

    const row = await harness.db
      .selectFrom('ServiceAccounts')
      .select(['secretHash', 'secretSalt'])
      .where('keyId', '=', issued.keyId)
      .executeTakeFirstOrThrow();

    expect(row.secretHash).not.toContain(issued.secret);
    expect(row.secretSalt).not.toContain(issued.secret);
  });

  it('refuses the wrong secret', async () => {
    const issued = await identity.createServiceAccount({
      namespaceId,
      name: 'workers',
      scopes: [],
    });

    expect(await identity.authenticateServiceAccount(issued.keyId, 'wrong')).toBeUndefined();
  });

  it('refuses an unknown key', async () => {
    expect(await identity.authenticateServiceAccount('sa_nope', 'whatever')).toBeUndefined();
  });

  // A disabled account that still authenticates is the worst kind of stale
  // credential: revocation appeared to work and did nothing.
  it('refuses a disabled account', async () => {
    const issued = await identity.createServiceAccount({
      namespaceId,
      name: 'workers',
      scopes: [],
    });
    expect(await identity.disableServiceAccount(namespaceId, issued.id)).toBe(true);

    expect(
      await identity.authenticateServiceAccount(issued.keyId, issued.secret)
    ).toBeUndefined();
  });

  // Otherwise one tenant's admin can disable another tenant's workers.
  it('will not disable an account in another namespace', async () => {
    const issued = await identity.createServiceAccount({
      namespaceId,
      name: 'workers',
      scopes: [],
    });

    expect(await identity.disableServiceAccount(otherNamespaceId, issued.id)).toBe(false);
    expect(await identity.authenticateServiceAccount(issued.keyId, issued.secret)).toBeDefined();
  });

  it('rejects a scope that could never be satisfied', async () => {
    await expect(
      identity.createServiceAccount({ namespaceId, name: 'broken', scopes: ['NOT A SCOPE'] })
    ).rejects.toBeInstanceOf(InvalidScopeError);
  });

  it('lists accounts of its own namespace only', async () => {
    await identity.createServiceAccount({ namespaceId, name: 'mine', scopes: [] });
    await identity.createServiceAccount({
      namespaceId: otherNamespaceId,
      name: 'theirs',
      scopes: [],
    });

    const listed = await identity.listServiceAccounts(namespaceId);
    expect(listed.map((a) => a.name)).toEqual(['mine']);
  });
});

describe('API keys', () => {
  it('authenticates with the token it issued', async () => {
    const issued = await identity.createApiKey({
      namespaceId,
      name: 'ci',
      scopes: [Scope.EXECUTIONS_START],
    });

    const principal = await identity.authenticateApiKey(issued.token);
    expect(principal?.namespaceId).toBe(namespaceId);
    expect(hasScope(principal!, Scope.EXECUTIONS_START)).toBe(true);
  });

  it('stores only the hash, and keeps an identifiable prefix', async () => {
    const issued = await identity.createApiKey({ namespaceId, name: 'ci', scopes: [] });

    const row = await harness.db
      .selectFrom('ApiKeys')
      .select(['tokenHash', 'prefix'])
      .where('id', '=', issued.id)
      .executeTakeFirstOrThrow();

    expect(row.tokenHash).toBe(hashApiKey(issued.token));
    expect(row.tokenHash).not.toContain(issued.token);
    expect(issued.token.startsWith(row.prefix)).toBe(true);
    // The prefix must not be enough to reconstruct the token.
    expect(row.prefix.length).toBeLessThan(issued.token.length / 2);
  });

  it('refuses a token that was never issued', async () => {
    expect(await identity.authenticateApiKey('nf_madeup')).toBeUndefined();
  });

  it('refuses a revoked key', async () => {
    const issued = await identity.createApiKey({ namespaceId, name: 'ci', scopes: [] });
    expect(await identity.revokeApiKey(namespaceId, issued.id)).toBe(true);

    expect(await identity.authenticateApiKey(issued.token)).toBeUndefined();
  });

  it('reports a second revocation as a no-op', async () => {
    const issued = await identity.createApiKey({ namespaceId, name: 'ci', scopes: [] });
    await identity.revokeApiKey(namespaceId, issued.id);

    expect(await identity.revokeApiKey(namespaceId, issued.id)).toBe(false);
  });

  it('will not revoke a key in another namespace', async () => {
    const issued = await identity.createApiKey({ namespaceId, name: 'ci', scopes: [] });

    expect(await identity.revokeApiKey(otherNamespaceId, issued.id)).toBe(false);
    expect(await identity.authenticateApiKey(issued.token)).toBeDefined();
  });

  // Expiry checked in SQL rather than in JS, so no code path can forget it.
  it('refuses an expired key', async () => {
    const issued = await identity.createApiKey({
      namespaceId,
      name: 'ci',
      scopes: [],
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await identity.authenticateApiKey(issued.token)).toBeDefined();

    await sql`UPDATE "ApiKeys" SET "expiresAt" = now() - interval '1 second'`.execute(harness.db);

    expect(await identity.authenticateApiKey(issued.token)).toBeUndefined();
  });

  it('treats a null expiry as never expiring', async () => {
    const issued = await identity.createApiKey({ namespaceId, name: 'ci', scopes: [] });
    expect(await identity.authenticateApiKey(issued.token)).toBeDefined();
  });

  it('issues a distinct token every time', async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const issued = await identity.createApiKey({ namespaceId, name: `k${i}`, scopes: [] });
      tokens.add(issued.token);
    }
    expect(tokens.size).toBe(10);
  });

  it('records last use', async () => {
    const issued = await identity.createApiKey({ namespaceId, name: 'ci', scopes: [] });
    await identity.authenticateApiKey(issued.token);

    const [row] = await identity.listApiKeys(namespaceId);
    expect(row.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe('namespace isolation', () => {
  // The credential carries its namespace; nothing the caller sends can change
  // it. This is what makes every downstream repository filter trustworthy.
  it('binds a principal to the namespace that issued it', async () => {
    const mine = await identity.createApiKey({
      namespaceId,
      name: 'mine',
      scopes: [Scope.ADMIN],
    });

    const principal = await identity.authenticateApiKey(mine.token);
    expect(principal?.namespaceId).toBe(namespaceId);
    expect(principal?.namespaceId).not.toBe(otherNamespaceId);
  });

  it('deletes credentials with their namespace', async () => {
    const issued = await identity.createApiKey({ namespaceId, name: 'ci', scopes: [] });
    await harness.db.deleteFrom('Namespaces').where('id', '=', namespaceId).execute();

    expect(await identity.authenticateApiKey(issued.token)).toBeUndefined();
  });
});

/**
 * Workload identity bindings.
 *
 * The binding is what turns "some CA vouched for this certificate" into "this
 * request may do these things". Both halves are tested: that a bound identity
 * resolves, and that everything else does not.
 */
describe('workload identities', () => {
  let workloads: WorkloadIdentityRepository;
  let accountName: string;
  let seq = 0;

  beforeEach(async () => {
    workloads = new WorkloadIdentityRepository(harness.db);
    accountName = `worker-${++seq}`;
    await identity.createServiceAccount({
      namespaceId,
      name: accountName,
      scopes: [Scope.TASKS_REPORT],
    });
  });

  const bind = (overrides: Record<string, string> = {}) =>
    workloads.bind({
      namespaceId,
      serviceAccountName: accountName,
      kind: 'oidc',
      issuer: 'https://oidc.example.com',
      subject: `system:serviceaccount:prod:${accountName}`,
      ...overrides,
    });

  it('resolves a bound identity to the service account', async () => {
    const binding = await bind();

    const principal = await workloads.resolve('oidc', binding.issuer, binding.subject);

    expect(principal?.type).toBe(PrincipalType.SERVICE_ACCOUNT);
    expect(principal?.name).toBe(accountName);
    expect(principal?.scopes).toContain(Scope.TASKS_REPORT);
  });

  it('does not resolve an unbound identity', async () => {
    await bind();

    expect(
      await workloads.resolve('oidc', 'https://oidc.example.com', 'someone-else')
    ).toBeUndefined();
  });

  // The kind is part of the identity: a certificate subject that happens to
  // equal a token subject is not the same principal.
  it('does not resolve across kinds', async () => {
    const binding = await bind();

    expect(await workloads.resolve('mtls', binding.issuer, binding.subject)).toBeUndefined();
  });

  it('refuses a binding to a service account that does not exist', async () => {
    await expect(bind({ serviceAccountName: 'no-such-account' })).rejects.toThrow(/no service account/);
  });

  // The same certificate meaning different things in different tenants is the
  // failure this prevents.
  it('refuses to bind one identity twice', async () => {
    await bind();
    await expect(bind()).rejects.toThrow(/already bound/);
  });

  /**
   * The credential that outlives its owner.
   *
   * Disabling a service account has to close every door into it, including one
   * opened by a binding nobody remembered to remove.
   */
  it('stops resolving when the service account is disabled', async () => {
    const binding = await bind();
    const accounts = await identity.listServiceAccounts(namespaceId);
    const account = accounts.find((a) => a.name === accountName)!;

    await identity.disableServiceAccount(namespaceId, account.id);

    expect(await workloads.resolve('oidc', binding.issuer, binding.subject)).toBeUndefined();
  });

  it('stops resolving once unbound', async () => {
    const binding = await bind();
    expect(await workloads.unbind(namespaceId, binding.id)).toBe(true);

    expect(await workloads.resolve('oidc', binding.issuer, binding.subject)).toBeUndefined();
  });
});
