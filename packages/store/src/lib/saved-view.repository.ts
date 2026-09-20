import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import { json } from './schema.js';
import { isUniqueViolation } from './pg-errors.js';

/**
 * Saved views: a search, its columns and its sort, under a name.
 *
 * Personal by default. A shared view is visible to everyone in the namespace
 * who can see the page, but stays its owner's to change — a team's "failed
 * checkouts this week" should not be rewritten by whoever opened it last.
 * The state is the page's own business: stored as given, capped in size.
 */

export interface SavedView {
  id: string;
  page: string;
  name: string;
  state: Record<string, JsonValue>;
  shared: boolean;
  ownerId: string;
  ownerName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedViewOwner {
  id: string;
  name?: string | null;
}

const MAX_STATE_BYTES = 16_000;
const MAX_VIEWS_PER_OWNER = 100;

export class SavedViewRepository {
  constructor(private readonly db: Db) {}

  /** The caller's own views and everyone's shared ones, own first. */
  async list(namespaceId: string, page: string, owner: SavedViewOwner): Promise<SavedView[]> {
    const rows = await this.db
      .selectFrom('SavedViews')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('page', '=', page)
      .where((eb) => eb.or([eb('ownerId', '=', owner.id), eb('shared', '=', true)]))
      .orderBy(sql`"ownerId" = ${owner.id}`, 'desc')
      .orderBy('name')
      .execute();
    return rows.map(toView);
  }

  async create(
    namespaceId: string,
    owner: SavedViewOwner,
    input: { page: string; name: string; state: Record<string, JsonValue>; shared?: boolean }
  ): Promise<SavedView> {
    const name = validName(input.name);
    assertSize(input.state);

    const count = await this.db
      .selectFrom('SavedViews')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('namespaceId', '=', namespaceId)
      .where('ownerId', '=', owner.id)
      .executeTakeFirstOrThrow();
    if (Number(count.n) >= MAX_VIEWS_PER_OWNER) {
      throw new InvalidArgumentError(`you can keep at most ${MAX_VIEWS_PER_OWNER} saved views; delete one first`);
    }

    const row = await this.db
      .insertInto('SavedViews')
      .values({
        namespaceId,
        page: input.page,
        ownerId: owner.id,
        ownerName: owner.name ?? null,
        name,
        state: json(input.state),
        shared: input.shared ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new NodeFlowError(ErrorCode.CONFLICT, `you already have a view named "${name}"`);
        }
        throw error;
      });
    return toView(row);
  }

  /** Changes a view. Only its owner may; anyone else is told it does not exist. */
  async update(
    namespaceId: string,
    owner: SavedViewOwner,
    id: string,
    input: { name?: string; state?: Record<string, JsonValue>; shared?: boolean }
  ): Promise<SavedView | undefined> {
    if (!UUID.test(id)) return undefined;
    if (input.state) assertSize(input.state);
    const row = await this.db
      .updateTable('SavedViews')
      .set({
        ...(input.name !== undefined ? { name: validName(input.name) } : {}),
        ...(input.state !== undefined ? { state: json(input.state) } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
        updatedAt: sql<Date>`now()`,
      })
      .where('namespaceId', '=', namespaceId)
      .where('id', '=', id)
      .where('ownerId', '=', owner.id)
      .returningAll()
      .executeTakeFirst()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new NodeFlowError(ErrorCode.CONFLICT, `you already have a view named "${input.name}"`);
        }
        throw error;
      });
    return row ? toView(row) : undefined;
  }

  /** Deletes a view: its owner's, or any view for an administrator. */
  async delete(namespaceId: string, owner: SavedViewOwner, id: string, asAdmin = false): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const result = await this.db
      .deleteFrom('SavedViews')
      .where('namespaceId', '=', namespaceId)
      .where('id', '=', id)
      .$if(!asAdmin, (q) => q.where('ownerId', '=', owner.id))
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > 100) throw new InvalidArgumentError('a view name is 1 to 100 characters');
  return trimmed;
}

function assertSize(state: Record<string, JsonValue>): void {
  if (JSON.stringify(state).length > MAX_STATE_BYTES) throw new InvalidArgumentError('a saved view is limited to 16 KB');
}

function toView(row: Record<string, unknown>): SavedView {
  return {
    id: row['id'] as string,
    page: row['page'] as string,
    name: row['name'] as string,
    state: (row['state'] as Record<string, JsonValue>) ?? {},
    shared: row['shared'] as boolean,
    ownerId: row['ownerId'] as string,
    ownerName: (row['ownerName'] as string | null) ?? null,
    createdAt: row['createdAt'] as Date,
    updatedAt: row['updatedAt'] as Date,
  };
}
