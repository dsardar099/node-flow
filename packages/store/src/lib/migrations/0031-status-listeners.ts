import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Status listeners — change data capture for workflow executions.
 *
 * A listener names which executions it cares about (workflow names, lifecycle
 * events) and a sink (a signed webhook or a Kafka topic). Each matching change
 * writes one outbox row per listener in the transaction that made it, so a
 * broken sink backs off and dead-letters on its own without holding up others.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "StatusListeners" (
      "id"              UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId"     UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"            TEXT NOT NULL,
      "description"     TEXT,
      "enabled"         BOOLEAN NOT NULL DEFAULT true,
      "workflowNames"   TEXT[] NOT NULL DEFAULT '{}',
      "events"          TEXT[] NOT NULL DEFAULT '{}',
      "sink"            TEXT NOT NULL,
      "config"          JSONB NOT NULL DEFAULT '{}',
      "includeOutput"   BOOLEAN NOT NULL DEFAULT false,
      "deliveredCount"  BIGINT NOT NULL DEFAULT 0,
      "failedCount"     BIGINT NOT NULL DEFAULT 0,
      "lastDeliveredAt" TIMESTAMPTZ,
      "lastFailedAt"    TIMESTAMPTZ,
      "lastError"       TEXT,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("namespaceId", "name")
    );
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "StatusListeners"`).execute(db);
}

export const statusListeners = { name: '0031-status-listeners', up, down };
