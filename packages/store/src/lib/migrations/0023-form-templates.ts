import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Reusable, versioned forms for human tasks.
 *
 * A HUMAN task references one as `{ "template": "refund_review" }`, and the
 * form is copied onto the task when it opens: editing a template must not
 * change what a person halfway through an approval is looking at.
 */
async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "FormTemplates" (
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "version"     INTEGER NOT NULL,
      "schema"      JSONB NOT NULL,
      "description" TEXT,
      "createdBy"   TEXT,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("namespaceId", "name", "version")
    );
  `);

  // Which template a task's form came from — for display, and for finding the
  // open tasks a template change will not reach.
  await run(`ALTER TABLE "HumanTasks" ADD COLUMN "formTemplate" TEXT, ADD COLUMN "formVersion" INTEGER;`);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`ALTER TABLE "HumanTasks" DROP COLUMN IF EXISTS "formTemplate", DROP COLUMN IF EXISTS "formVersion"`).execute(db);
  await sql.raw(`DROP TABLE IF EXISTS "FormTemplates"`).execute(db);
}

export const formTemplates = { name: '0023-form-templates', up, down };
