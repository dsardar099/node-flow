import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkerPollRepository } from './worker-poll.repository.js';

let harness: PostgresHarness;
let namespaceId: string;
let clock: number;
let polls: WorkerPollRepository;

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
  polls = new WorkerPollRepository(harness.db, () => clock);
});

const rows = () => harness.db.selectFrom('WorkerPolls').selectAll().execute();

describe('worker polls', () => {
  it('records one row per worker and queue, overwritten by later polls', async () => {
    await polls.record(namespaceId, 'charge', 'w1');
    await polls.record(namespaceId, 'charge', 'w2');
    await polls.record(namespaceId, 'refund', 'w1');
    clock += 10_000;
    await polls.record(namespaceId, 'charge', 'w1');

    expect(await rows()).toHaveLength(3);
  });

  // The lease path is the hottest request there is; a fleet long-polling in a
  // loop must not turn every poll into a write.
  it('writes at most once per interval for the same worker and queue', async () => {
    await polls.record(namespaceId, 'charge', 'w1');
    await sql`UPDATE "WorkerPolls" SET "lastPollAt" = now() - interval '1 hour'`.execute(harness.db);

    clock += 1_000;
    await polls.record(namespaceId, 'charge', 'w1');
    const [throttled] = await rows();
    expect(Date.now() - throttled.lastPollAt.getTime()).toBeGreaterThan(3_000_000);

    clock += 5_000;
    await polls.record(namespaceId, 'charge', 'w1');
    const [written] = await rows();
    expect(Date.now() - written.lastPollAt.getTime()).toBeLessThan(60_000);
  });

  it('lists only recent sightings in the namespace, newest first', async () => {
    const other = await seedNamespace(harness.db, 'other');
    await polls.record(namespaceId, 'charge', 'old');
    await sql`UPDATE "WorkerPolls" SET "lastPollAt" = now() - interval '2 days'`.execute(harness.db);
    await polls.record(namespaceId, 'charge', 'fresh');
    await polls.record(other, 'charge', 'elsewhere');

    const recent = await polls.recent(namespaceId);
    expect(recent.map((row) => row.workerId)).toEqual(['fresh']);
  });
});
