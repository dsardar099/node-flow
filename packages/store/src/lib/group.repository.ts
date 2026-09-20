import {
  ErrorCode,
  InvalidArgumentError,
  NodeFlowError,
  isValidScope,
  isValidTag,
} from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, Queryable } from './database.js';
import { isUniqueViolation } from './pg-errors.js';

/**
 * Groups, and the scopes people get through them.
 *
 * The one rule worth stating: **scopes only accumulate.** There is no deny, and
 * that is a decision rather than an omission. A model where two rules can
 * disagree is a model where "can this person do that?" cannot be answered by
 * reading it — you have to simulate the evaluation order, and the answer
 * changes when an unrelated group is edited.
 */

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 _.-]{0,126}$/;

export interface NewGroup {
  namespaceId: string;
  name: string;
  description?: string;
  scopes?: string[];
  tagGrants?: string[];
}

export interface Group {
  id: string;
  namespaceId: string;
  name: string;
  description: string | null;
  scopes: string[];
  /** Tag patterns members may reach. See `mayReachTags`. */
  tagGrants: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMember {
  userId: string;
  email: string;
  name: string;
  addedAt: Date;
}

export class GroupRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewGroup): Promise<Group> {
    assertName(input.name);
    assertScopes(input.scopes ?? []);

    const row = await this.db
      .insertInto('Groups')
      .values({
        namespaceId: input.namespaceId,
        name: input.name,
        description: input.description ?? null,
        scopes: input.scopes ?? [],
        tagGrants: input.tagGrants ?? [],
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new NodeFlowError(
            ErrorCode.CONFLICT,
            `a group named "${input.name}" already exists`
          );
        }
        throw error;
      });

    return row as Group;
  }

  /** Replaces the tag patterns this group's members may reach. */
  async setTagGrants(namespaceId: string, name: string, tagGrants: string[]): Promise<Group> {
    const invalid = tagGrants.filter((grant) => !isValidTag(grant));
    if (invalid.length > 0) {
      throw new InvalidArgumentError(`invalid tag grant(s): ${invalid.join(', ')}`);
    }

    const row = await this.db
      .updateTable('Groups')
      .set({ tagGrants, updatedAt: sql<Date>`now()` })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returningAll()
      .executeTakeFirst();

    if (!row) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no group "${name}"`);
    return row as Group;
  }

  /**
   * Tag patterns a user holds through their groups.
   *
   * Read alongside scopes when a principal is resolved, so authorization reads
   * one flat list and no check can forget to consider groups.
   */
  async tagGrantsFor(userId: string, tx?: Queryable): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .selectFrom('GroupMembers')
      .innerJoin('Groups', 'Groups.id', 'GroupMembers.groupId')
      .select('Groups.tagGrants as tagGrants')
      .where('GroupMembers.userId', '=', userId)
      .execute();

    return [...new Set(rows.flatMap((row) => row.tagGrants))];
  }

  async setScopes(namespaceId: string, name: string, scopes: string[]): Promise<Group> {
    assertScopes(scopes);

    const row = await this.db
      .updateTable('Groups')
      .set({ scopes, updatedAt: sql<Date>`now()` })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returningAll()
      .executeTakeFirst();

    if (!row) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no group "${name}"`);
    return row as Group;
  }

  async list(namespaceId: string): Promise<Group[]> {
    const rows = await this.db
      .selectFrom('Groups')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .orderBy('name', 'asc')
      .execute();

    return rows as Group[];
  }

  async findByName(namespaceId: string, name: string): Promise<Group | undefined> {
    const row = await this.db
      .selectFrom('Groups')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();

    return row as Group | undefined;
  }

  async delete(namespaceId: string, name: string): Promise<boolean> {
    const rows = await this.db
      .deleteFrom('Groups')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returning('id')
      .execute();

    return rows.length > 0;
  }

  /**
   * Adds a member.
   *
   * The user is checked to be in the same namespace as the group. Without that,
   * a namespace admin could add anyone whose id they learned — the group grants
   * scopes, so this is a privilege boundary rather than bookkeeping.
   */
  async addMember(
    namespaceId: string,
    groupName: string,
    userId: string,
    by?: string
  ): Promise<void> {
    const group = await this.findByName(namespaceId, groupName);
    if (!group) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no group "${groupName}"`);

    const user = await this.db
      .selectFrom('Users')
      .select('id')
      .where('id', '=', userId)
      .where('namespaceId', '=', namespaceId)
      .executeTakeFirst();

    if (!user) {
      throw new NodeFlowError(ErrorCode.NOT_FOUND, `no user ${userId} in this namespace`);
    }

    await this.db
      .insertInto('GroupMembers')
      .values({ groupId: group.id, userId, addedBy: by ?? null })
      // Adding someone twice is not an error; it is a double-click.
      .onConflict((oc) => oc.columns(['groupId', 'userId']).doNothing())
      .execute();
  }

  async removeMember(namespaceId: string, groupName: string, userId: string): Promise<boolean> {
    const group = await this.findByName(namespaceId, groupName);
    if (!group) return false;

    const rows = await this.db
      .deleteFrom('GroupMembers')
      .where('groupId', '=', group.id)
      .where('userId', '=', userId)
      .returning('userId')
      .execute();

    return rows.length > 0;
  }

  async members(namespaceId: string, groupName: string): Promise<GroupMember[]> {
    const group = await this.findByName(namespaceId, groupName);
    if (!group) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no group "${groupName}"`);

    const rows = await this.db
      .selectFrom('GroupMembers')
      .innerJoin('Users', 'Users.id', 'GroupMembers.userId')
      .select([
        'Users.id as userId',
        'Users.email as email',
        'Users.name as name',
        'GroupMembers.addedAt as addedAt',
      ])
      .where('GroupMembers.groupId', '=', group.id)
      .orderBy('Users.email', 'asc')
      .execute();

    return rows;
  }

  /** Group ids a user belongs to. Drives human-task routing. */
  async groupIdsFor(userId: string, tx?: Queryable): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .selectFrom('GroupMembers')
      .select('groupId')
      .where('userId', '=', userId)
      .execute();

    return rows.map((row) => row.groupId);
  }

  /**
   * Scopes a user holds through their groups.
   *
   * Read on every authenticated request that resolves a session, so it is one
   * indexed query returning a small array rather than a join per group.
   */
  async scopesFor(userId: string, tx?: Queryable): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .selectFrom('GroupMembers')
      .innerJoin('Groups', 'Groups.id', 'GroupMembers.groupId')
      .select('Groups.scopes as scopes')
      .where('GroupMembers.userId', '=', userId)
      .execute();

    return [...new Set(rows.flatMap((row) => row.scopes))];
  }
}

/**
 * Scopes are validated when granted, not when checked.
 *
 * A typo like `executions:reed` would otherwise sit in a group looking like a
 * permission and granting nothing, and the person it was meant for would be
 * told they lack access to something the UI says they have.
 */
function assertScopes(scopes: string[]): void {
  const invalid = scopes.filter((scope) => !isValidScope(scope));
  if (invalid.length > 0) {
    throw new InvalidArgumentError(`invalid scope(s): ${invalid.join(', ')}`);
  }
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new InvalidArgumentError(
      `"${name}" is not a usable group name: start with a letter, then letters, digits, spaces, "_", "." or "-"`
    );
  }
}

