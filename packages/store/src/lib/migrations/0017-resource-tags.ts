import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Tag-based resource access.
 *
 * The model, stated once so every call site can be read against it:
 *
 *   **Tags restrict. They never grant.**
 *
 * An untagged resource is governed by scopes alone, exactly as before. A
 * resource carrying tags is additionally reachable only by a principal holding
 * a grant matching one of them. So adding a tag can only ever *narrow* access,
 * which is the safe direction: the mistake it invites is locking yourself out,
 * not quietly opening something up.
 *
 * The alternative — tags as grants, where holding `env:prod` gives you prod —
 * reads the same in the happy case and fails in the opposite direction: a
 * resource nobody has tagged yet is reachable by everyone, and forgetting to
 * tag something is far more common than forgetting to grant it.
 *
 * Grants live on groups rather than users for the same reason scopes do: the
 * question "who can touch production?" should be answerable by reading one
 * group, not by auditing every account.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  // `key:value` strings — `env:prod`, `team:payments`. A flat array rather than
  // a key/value table: they are matched, listed and set wholesale, never
  // queried by key alone.
  await run(`
    ALTER TABLE "WorkflowDefinitions"
      ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';
  `);

  // Grants may be exact (`env:prod`) or a trailing wildcard (`team:*`), using
  // the same matching rule as scopes so there is one thing to learn.
  await run(`
    ALTER TABLE "Groups"
      ADD COLUMN "tagGrants" TEXT[] NOT NULL DEFAULT '{}';
  `);

  // Finding everything tagged a given way is the question an access review
  // asks, and a GIN index is what makes `tags && ARRAY[...]` cheap.
  await run(`
    CREATE INDEX "WorkflowDefinitions_tags_idx" ON "WorkflowDefinitions" USING GIN ("tags");
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP INDEX IF EXISTS "WorkflowDefinitions_tags_idx"`).execute(db);
  await sql.raw(`ALTER TABLE "Groups" DROP COLUMN IF EXISTS "tagGrants"`).execute(db);
  await sql.raw(`ALTER TABLE "WorkflowDefinitions" DROP COLUMN IF EXISTS "tags"`).execute(db);
}

export const resourceTags = { name: '0017-resource-tags', up, down };
