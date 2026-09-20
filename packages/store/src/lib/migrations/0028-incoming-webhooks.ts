import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Named inbound webhook endpoints.
 *
 * A webhook here is only the verified front door: it checks a platform's
 * signature and turns the request into a message. What the message *does* is
 * decided by event handlers on source `webhook` and the webhook's name as topic,
 * so starting a workflow, completing a task, conditions, templates and the
 * event monitor all work the same way they do for Kafka.
 *
 * The secret is a *name* in the namespace's secret store, never a value here.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "IncomingWebhooks" (
      "id"             UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId"    UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"           TEXT NOT NULL,
      "description"    TEXT,
      "verifier"       TEXT NOT NULL,
      "config"         JSONB NOT NULL DEFAULT '{}',
      "secretName"     TEXT,
      "enabled"        BOOLEAN NOT NULL DEFAULT true,
      "receivedCount"  BIGINT NOT NULL DEFAULT 0,
      "rejectedCount"  BIGINT NOT NULL DEFAULT 0,
      "lastReceivedAt" TIMESTAMPTZ,
      "lastError"      TEXT,
      "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("namespaceId", "name")
    );
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "IncomingWebhooks"`).execute(db);
}

export const incomingWebhooks = { name: '0028-incoming-webhooks', up, down };
