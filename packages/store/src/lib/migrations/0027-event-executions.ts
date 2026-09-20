import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * What each event handler did with each message it saw — the event monitor.
 *
 * A handler's counter says messages arrive; it cannot say that the last forty
 * were skipped by a condition that never matches, or which message failed and
 * why. One row per (message, handler), kept for a bounded window and pruned by
 * the poller, because this is diagnosis, not history of record.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "EventExecutions" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "handlerName" TEXT NOT NULL,
      "action"      TEXT NOT NULL,
      "source"      TEXT NOT NULL,
      "topic"       TEXT NOT NULL,
      "messageKey"  TEXT,
      "deliveryId"  TEXT NOT NULL,
      "payload"     JSONB NOT NULL DEFAULT '{}',
      "outcome"     TEXT NOT NULL CHECK ("outcome" IN ('ACTED', 'SKIPPED', 'FAILED')),
      "workflowId"  UUID,
      "detail"      TEXT,
      "at"          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await run(`CREATE INDEX "EventExecutions_recent_idx" ON "EventExecutions" ("namespaceId", "at" DESC);`);
  await run(`CREATE INDEX "EventExecutions_handler_idx" ON "EventExecutions" ("namespaceId", "handlerName", "at" DESC);`);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "EventExecutions"`).execute(db);
}

export const eventExecutions = { name: '0027-event-executions', up, down };
