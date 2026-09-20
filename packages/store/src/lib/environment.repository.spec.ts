import { InvalidArgumentError } from '@node-flow-dev/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentRepository } from './environment.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';

let harness: PostgresHarness;
let namespaceId: string;
let clock: number;
let environment: EnvironmentRepository;

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
  environment = new EnvironmentRepository(harness.db, () => clock);
});

describe('environment variables', () => {
  it('stores text and JSON values and loads them by name', async () => {
    await environment.put(namespaceId, { name: 'API_BASE', type: 'TEXT', value: 'https://api.example.com' });
    await environment.put(namespaceId, { name: 'limits', type: 'JSON', value: { perMinute: 60, regions: ['eu'] } });

    expect(await environment.load(namespaceId)).toEqual({
      API_BASE: 'https://api.example.com',
      limits: { perMinute: 60, regions: ['eu'] },
    });
    expect((await environment.list(namespaceId)).map((v) => v.name)).toEqual(['API_BASE', 'limits']);
  });

  it('replaces a value, and the process that changed it sees the change at once', async () => {
    await environment.put(namespaceId, { name: 'FLAG', type: 'TEXT', value: 'off' });
    expect((await environment.load(namespaceId)).FLAG).toBe('off');

    await environment.put(namespaceId, { name: 'FLAG', type: 'TEXT', value: 'on' });
    expect((await environment.load(namespaceId)).FLAG).toBe('on');
  });

  it('refuses a name expressions could not reference', async () => {
    await expect(environment.put(namespaceId, { name: 'api-base', type: 'TEXT', value: 'x' })).rejects.toThrow(InvalidArgumentError);
    await expect(environment.put(namespaceId, { name: '1st', type: 'TEXT', value: 'x' })).rejects.toThrow(InvalidArgumentError);
  });

  it('refuses a non-string value typed as TEXT', async () => {
    await expect(environment.put(namespaceId, { name: 'N', type: 'TEXT', value: 5 })).rejects.toThrow(/TEXT variable holds a string/);
  });

  it('keeps namespaces apart', async () => {
    const other = await seedNamespace(harness.db, 'other');
    await environment.put(other, { name: 'SECRET_SAUCE', type: 'TEXT', value: 'theirs' });
    expect(await environment.load(namespaceId)).toEqual({});
  });

  it('reports deleting a variable that does not exist', async () => {
    await expect(environment.delete(namespaceId, 'MISSING')).rejects.toThrow(/no environment variable/);
  });
});
