import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SavedViewRepository } from './saved-view.repository.js';
import { seedNamespace, startPostgresHarness, truncateAll, type PostgresHarness } from './testing/postgres-harness.js';

let harness: PostgresHarness;
let views: SavedViewRepository;
let namespaceId: string;
let otherNamespaceId: string;
const ada = { id: 'user-ada', name: 'Ada' };
const bob = { id: 'user-bob', name: 'Bob' };

beforeAll(async () => {
  harness = await startPostgresHarness();
  views = new SavedViewRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db, 'acme');
  otherNamespaceId = await seedNamespace(harness.db, 'other');
});

describe('saved views', () => {
  it('shows people their own views and shared ones, never another person’s private ones', async () => {
    await views.create(namespaceId, ada, { page: 'executions', name: 'My failures', state: { q: 'status:FAILED' } });
    const shared = await views.create(namespaceId, ada, { page: 'executions', name: 'Team: stuck', state: { q: 'is:running' }, shared: true });
    await views.create(namespaceId, bob, { page: 'executions', name: 'Bob only', state: {} });
    await views.create(otherNamespaceId, ada, { page: 'executions', name: 'Elsewhere', state: {}, shared: true });

    expect((await views.list(namespaceId, 'executions', ada)).map((v) => v.name)).toEqual(['My failures', 'Team: stuck']);
    expect((await views.list(namespaceId, 'executions', bob)).map((v) => v.name)).toEqual(['Bob only', 'Team: stuck']);
    expect(await views.list(namespaceId, 'schedules', ada)).toEqual([]);

    // Shared is not editable by others, and to them it does not exist.
    expect(await views.update(namespaceId, bob, shared.id, { name: 'Hijacked' })).toBeUndefined();
    expect(await views.delete(namespaceId, bob, shared.id)).toBe(false);
    expect(await views.delete(namespaceId, bob, shared.id, true)).toBe(true);
  });

  it('refuses duplicates, bad names and oversized state', async () => {
    await views.create(namespaceId, ada, { page: 'executions', name: 'Failures', state: {} });
    await expect(views.create(namespaceId, ada, { page: 'executions', name: ' Failures ', state: {} })).rejects.toThrow(/already have/);
    await expect(views.create(namespaceId, bob, { page: 'executions', name: 'Failures', state: {} })).resolves.toBeTruthy();
    await expect(views.create(namespaceId, ada, { page: 'executions', name: '  ', state: {} })).rejects.toThrow(/1 to 100/);
    await expect(views.create(namespaceId, ada, { page: 'executions', name: 'Big', state: { q: 'x'.repeat(20_000) } })).rejects.toThrow(/16 KB/);
    expect(await views.update(namespaceId, ada, 'not-a-uuid', { name: 'x' })).toBeUndefined();
  });
});
