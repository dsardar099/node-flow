import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Groups — named sets of people, carrying scopes.
 *
 * Deliberately one concept rather than the usual three. Orkes separates roles
 * from groups from applications; a role is a named bundle of permissions and a
 * group is a set of people, and in practice every installation ends up with one
 * group per role and a mapping nobody enjoys maintaining. A group that carries
 * scopes *is* a role with members, and collapsing them removes a whole layer of
 * indirection without removing any expressiveness.
 *
 * A user's effective scopes are their own plus every group's. Scopes only ever
 * accumulate — there is no deny — because a permission model where two rules
 * can disagree is a permission model where nobody can answer "can this person
 * do that?" by reading it.
 *
 * This also unblocks `HUMAN`: a task can now be routed to a group, which the
 * engine has been refusing to accept since Phase 3 rather than silently
 * dropping the routing.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "Groups" (
      "id"          UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId" UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "name"        TEXT NOT NULL,
      "description" TEXT,
      "scopes"      TEXT[] NOT NULL DEFAULT '{}',
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await run(`
    CREATE UNIQUE INDEX "Groups_name_key" ON "Groups" ("namespaceId", "name");
  `);

  await run(`
    CREATE TABLE "GroupMembers" (
      "groupId"  UUID NOT NULL REFERENCES "Groups"("id") ON DELETE CASCADE,
      "userId"   UUID NOT NULL REFERENCES "Users"("id") ON DELETE CASCADE,
      "addedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
      "addedBy"  TEXT,
      PRIMARY KEY ("groupId", "userId")
    );
  `);

  // Resolving a principal's scopes reads by user on every authenticated
  // request, so this index is on the hot path rather than an afterthought.
  await run(`
    CREATE INDEX "GroupMembers_user_idx" ON "GroupMembers" ("userId");
  `);

  // Routing a human task to a team rather than a person. Nullable, because
  // most tasks are assigned to nobody in particular and claimed from a pool.
  await run(`
    ALTER TABLE "HumanTasks"
      ADD COLUMN "assigneeGroupId" UUID REFERENCES "Groups"("id") ON DELETE SET NULL;
  `);

  // The inbox query gains a second shape: tasks routed to a group I am in.
  await run(`
    CREATE INDEX "HumanTasks_group_idx"
      ON "HumanTasks" ("namespaceId", "assigneeGroupId")
      WHERE "completedAt" IS NULL AND "assigneeGroupId" IS NOT NULL;
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`ALTER TABLE "HumanTasks" DROP COLUMN IF EXISTS "assigneeGroupId"`).execute(db);
  await sql.raw(`DROP TABLE IF EXISTS "GroupMembers" CASCADE`).execute(db);
  await sql.raw(`DROP TABLE IF EXISTS "Groups" CASCADE`).execute(db);
}

export const groups = { name: '0013-groups', up, down };
