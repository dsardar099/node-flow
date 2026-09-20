import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Callback slots for `WAIT_FOR_WEBHOOK`.
 *
 * A row per waiting task, keyed by an unguessable token. The token *is* the
 * authorisation: whoever holds it may complete that one task and nothing else,
 * which is what lets a third party call back without holding an API credential
 * — the entire point of a webhook.
 *
 * Consequences of that, all of which the schema has to support:
 *
 *  - The token is stored **hashed**. A leaked database backup must not hand
 *    over the ability to complete live workflows.
 *  - It is **single-use**. A webhook delivery that is retried — which every
 *    sender does — must not complete the task twice, and a replayed capture
 *    must not work at all.
 *  - It **expires**, so an abandoned workflow does not leave a live callback
 *    slot open indefinitely.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "WebhookCallbacks" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "workflowId"  UUID NOT NULL,
      "taskId"      UUID NOT NULL,
      "refName"     TEXT NOT NULL,
      -- SHA-256 of the token. Fast is right: the token is 256 bits of generated
      -- entropy, so there is no dictionary for a slow hash to slow down, and
      -- this is checked on the request path.
      "tokenHash"   TEXT NOT NULL,
      -- Optional shared secret for HMAC-signed deliveries. Senders that sign
      -- (Stripe, GitHub, Shopify) let the receiver verify the payload really
      -- came from them rather than from whoever learned the URL.
      "signingKey"  TEXT,
      "expiresAt"   TIMESTAMPTZ,
      "consumedAt"  TIMESTAMPTZ,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await run(`
    CREATE UNIQUE INDEX "WebhookCallbacks_token_key" ON "WebhookCallbacks" ("tokenHash");
  `);
  // Terminating a workflow has to close its open callback slots.
  await run(`
    CREATE INDEX "WebhookCallbacks_workflow_idx" ON "WebhookCallbacks" ("workflowId");
  `);
  // Drives the sweep that removes expired and long-consumed rows.
  await run(`
    CREATE INDEX "WebhookCallbacks_expiry_idx" ON "WebhookCallbacks" ("expiresAt");
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "WebhookCallbacks" CASCADE`).execute(db);
}

export const webhookCallbacks = { name: '0008-webhook-callbacks', up, down };
