import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * When each worker last polled each queue.
 *
 * Queue depth says work is waiting; it cannot say whether anyone is listening.
 * "Three tasks queued, last poll 40 minutes ago" is an outage with its cause
 * attached, and "last poll 2 seconds ago by a worker on the `eu` domain" is a
 * routing mistake with its cause attached. Conductor calls this poll data.
 *
 * One row per (namespace, queue, worker), overwritten — history is not the
 * point, the latest sighting is.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "WorkerPolls" (
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "queueName"   TEXT NOT NULL,
      "workerId"    TEXT NOT NULL,
      "lastPollAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespaceId", "queueName", "workerId")
    );
  `);

  await run(`CREATE INDEX "WorkerPolls_recent_idx" ON "WorkerPolls" ("namespaceId", "lastPollAt");`);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "WorkerPolls"`).execute(db);
}

export const workerPolls = { name: '0020-worker-polls', up, down };
