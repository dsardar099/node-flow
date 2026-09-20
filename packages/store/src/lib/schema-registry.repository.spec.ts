import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetadataRepository } from './metadata.repository.js';
import { SchemaRegistryRepository, isSchemaReference } from './schema-registry.repository.js';
import { SchemaValidator } from './schema-validator.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';

let harness: PostgresHarness;
let namespaceId: string;
let clock: number;
let registry: SchemaRegistryRepository;
let metadata: MetadataRepository;

const order = (required: string[]) => ({
  type: 'object',
  required,
  properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
});

beforeAll(async () => {
  harness = await startPostgresHarness();
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db);
  clock = 1_000_000;
  registry = new SchemaRegistryRepository(harness.db, () => clock);
  metadata = new MetadataRepository(harness.db, undefined, new SchemaValidator(), registry);
});

describe('isSchemaReference', () => {
  it('tells a reference from an inline schema', () => {
    expect(isSchemaReference({ name: 'order' })).toBe(true);
    expect(isSchemaReference({ name: 'order', version: 2, type: 'JSON' })).toBe(true);
    expect(isSchemaReference(order(['orderId']))).toBe(false);
    // A JSON Schema can carry a title, but never a bare string `name` alone with JSON type.
    expect(isSchemaReference({ name: 'order', type: 'object' })).toBe(false);
    expect(isSchemaReference({ name: 'order', properties: {} })).toBe(false);
  });
});

describe('the schema registry', () => {
  it('numbers versions and lists each name once, at its newest', async () => {
    await registry.register(namespaceId, { name: 'order', data: order([]) });
    const v2 = await registry.register(namespaceId, { name: 'order', data: order(['orderId']) });
    await registry.register(namespaceId, { name: 'refund', data: order([]) });

    expect(v2.version).toBe(2);
    expect((await registry.list(namespaceId)).map((s) => [s.name, s.version, s.versions])).toEqual([
      ['order', 2, 2],
      ['refund', 1, 1],
    ]);
  });

  // Two registrations landing together must not both claim version 2.
  it('allocates distinct versions under concurrent registration', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => registry.register(namespaceId, { name: 'burst', data: order([]) }))
    );
    expect(results.map((r) => r.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('resolves pinned and latest references, and refuses a dangling one', async () => {
    await registry.register(namespaceId, { name: 'order', data: order([]) });
    await registry.register(namespaceId, { name: 'order', data: order(['orderId']) });

    expect(await registry.resolve(namespaceId, { name: 'order', version: 1 })).toEqual(order([]));
    expect(await registry.resolve(namespaceId, { name: 'order' })).toEqual(order(['orderId']));
    await expect(registry.resolve(namespaceId, { name: 'missing' })).rejects.toThrow(/not registered/);
    expect(await registry.resolve(namespaceId, order(['x']))).toEqual(order(['x']));
  });
});

describe('task definitions referencing the registry', () => {
  it('refuses a reference to a schema that is not registered', async () => {
    await expect(
      metadata.upsertTaskDefinition(namespaceId, { name: 'charge', inputSchema: { name: 'nope' } })
    ).rejects.toThrow(/inputSchema: schema "nope" is not registered/);
  });

  it('enforces the referenced schema, following "latest" as new versions land', async () => {
    await registry.register(namespaceId, { name: 'order', data: order([]) });
    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge', inputSchema: { name: 'order' } });

    const first = (await metadata.loadTaskDefs(namespaceId, ['charge'])).get('charge');
    expect(first?.inputSchema).toEqual(order([]));

    await registry.register(namespaceId, { name: 'order', data: order(['orderId']) });
    clock += 10_000;
    const second = (await metadata.loadTaskDefs(namespaceId, ['charge'])).get('charge');
    expect(second?.inputSchema).toEqual(order(['orderId']));
  });

  it('keeps a pinned reference on its version', async () => {
    await registry.register(namespaceId, { name: 'order', data: order([]) });
    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge', inputSchema: { name: 'order', version: 1 } });
    await registry.register(namespaceId, { name: 'order', data: order(['orderId']) });
    clock += 10_000;

    expect((await metadata.loadTaskDefs(namespaceId, ['charge'])).get('charge')?.inputSchema).toEqual(order([]));
  });
});
