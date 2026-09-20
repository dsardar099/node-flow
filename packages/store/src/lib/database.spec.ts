import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool } from './database.js';
import { startPostgresHarness, type PostgresHarness } from './testing/postgres-harness.js';

/**
 * The connection pool, when Postgres takes connections away.
 *
 * Found through a shutdown race in an unrelated test: a pooled client killed by
 * the server emitted an `error` on the pool, nothing was listening, and Node
 * turned that into an uncaught exception. In production the same path is a
 * Postgres restart, a failover or a network blip — and the consequence is not a
 * failed query but the whole server process exiting.
 */

let harness: PostgresHarness;

beforeAll(async () => {
  harness = await startPostgresHarness();
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

describe('a connection the server terminates', () => {
  it('does not crash the process when the connection was idle in the pool', async () => {
    const db = createDatabase({ url: harness.url, maxConnections: 1 });

    // One pooled connection, returned to the pool idle, and its backend pid.
    const { rows } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(db);

    // Terminated from outside, exactly as a restart or an administrator would.
    await sql`SELECT pg_terminate_backend(${rows[0].pid})`.execute(harness.db);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Still usable: the dead client is discarded and a fresh one opened.
    const after = await sql<{ ok: number }>`SELECT 1 AS ok`.execute(db);
    expect(after.rows).toEqual([{ ok: 1 }]);

    await db.destroy();
  });

  it('reports the loss rather than swallowing it', async () => {
    const seen: unknown[] = [];
    const pool = createPool({ url: harness.url, maxConnections: 1 }, (error) => seen.push(error));
    const db = createDatabase({ url: harness.url }, pool);

    const { rows } = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(db);
    await sql`SELECT pg_terminate_backend(${rows[0].pid})`.execute(harness.db);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(seen).toHaveLength(1);
    expect(String(seen[0])).toMatch(/terminating connection/);

    await db.destroy();
  });
});
