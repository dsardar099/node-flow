import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * `secretOutputFields` on a task definition.
 *
 * Added as its own migration rather than folded into the secrets one because
 * it was found the way these things are found: the field was accepted by the
 * schema, validated, returned by the API — and dropped on write, because
 * `upsertTaskDefinition` names its columns explicitly and this one did not
 * exist. A live run showed the credential sitting in the task output in clear
 * while every unit test passed, since they exercise the sealer directly.
 */

async function up(db: Kysely<Database>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE "TaskDefinitions"
         ADD COLUMN "secretOutputFields" TEXT[] NOT NULL DEFAULT '{}'`
    )
    .execute(db);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql
    .raw(`ALTER TABLE "TaskDefinitions" DROP COLUMN IF EXISTS "secretOutputFields"`)
    .execute(db);
}

export const secretOutputFields = { name: '0015-secret-output-fields', up, down };
