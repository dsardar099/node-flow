import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Indexes that make orphaned-payload collection affordable.
 *
 * The garbage collector's only question is "does any row still point at this
 * blob?" Without an index that is a sequential scan of two partitioned tables
 * per candidate blob, which makes collection so expensive it would never be run
 * — and payload storage grows without bound.
 *
 * They are **partial**, covering only rows that were actually offloaded. In a
 * deployment where nothing exceeds the threshold they hold zero entries and
 * cost nothing on the insert path, which is the common case.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  for (const [table, column] of [
    ['WorkflowExecutions', 'inputRef'],
    ['WorkflowExecutions', 'outputRef'],
    ['TaskExecutions', 'inputRef'],
    ['TaskExecutions', 'outputRef'],
  ] as const) {
    await run(`
      CREATE INDEX "${table}_${column}_idx" ON "${table}" ("${column}")
        WHERE "${column}" IS NOT NULL
    `);
  }
}

async function down(db: Kysely<Database>): Promise<void> {
  for (const index of [
    'WorkflowExecutions_inputRef_idx',
    'WorkflowExecutions_outputRef_idx',
    'TaskExecutions_inputRef_idx',
    'TaskExecutions_outputRef_idx',
  ]) {
    await sql.raw(`DROP INDEX IF EXISTS "${index}"`).execute(db);
  }
}

export const payloadRefs = { name: '0002-payload-refs', up, down };
