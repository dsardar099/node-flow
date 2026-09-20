import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Indexes for execution search.
 *
 * `0001` already covers filtering by status and by correlation id. What it does
 * not cover is the other question every dashboard asks first — "show me runs of
 * *this workflow*" — which without an index is a scan of every partition.
 *
 * Both are ordered `startedAt DESC` to match the query's sort. An index whose
 * order disagrees with the `ORDER BY` still filters, but the planner must then
 * sort the whole matched set before it can return the first page, which is
 * exactly the cost keyset pagination exists to avoid.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE INDEX "WorkflowExecutions_ns_def_idx"
      ON "WorkflowExecutions" ("namespaceId", "defName", "startedAt" DESC);
  `);

  // The unfiltered "newest first" listing, and the cursor's own range scan.
  await run(`
    CREATE INDEX "WorkflowExecutions_ns_started_idx"
      ON "WorkflowExecutions" ("namespaceId", "startedAt" DESC, "id" DESC);
  `);

  // Finding a child execution from its parent — how a sub-workflow is traced
  // back, and how the UI draws the tree.
  await run(`
    CREATE INDEX "WorkflowExecutions_parent_idx"
      ON "WorkflowExecutions" ("parentWorkflowId")
      WHERE "parentWorkflowId" IS NOT NULL;
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  for (const index of [
    'WorkflowExecutions_ns_def_idx',
    'WorkflowExecutions_ns_started_idx',
    'WorkflowExecutions_parent_idx',
  ]) {
    await sql.raw(`DROP INDEX IF EXISTS "${index}"`).execute(db);
  }
}

export const searchIndexes = { name: '0004-search-indexes', up, down };
