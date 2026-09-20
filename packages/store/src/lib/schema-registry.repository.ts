import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import { json } from './schema.js';

export interface RegisteredSchema {
  name: string;
  version: number;
  type: 'JSON';
  data: Record<string, JsonValue>;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** A pointer to a registered schema, as written in a definition. */
export interface SchemaReference {
  name: string;
  /** Omitted means the latest version at the time of use. */
  version?: number;
  type?: 'JSON';
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,199}$/;
/** How long "latest" is trusted before being looked up again. Pinned versions never change. */
const LATEST_TTL_MS = 5_000;

/**
 * Whether a definition's `inputSchema`/`outputSchema` points at the registry
 * rather than being a schema itself.
 *
 * A JSON Schema never has a string `name` alongside nothing but `version` and
 * `type: "JSON"`, so the shapes cannot be confused: `{ "type": "object", … }` is
 * inline, `{ "name": "order", "version": 2 }` is a reference.
 */
export function isSchemaReference(value: unknown): value is SchemaReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record['name'] !== 'string') return false;
  return Object.keys(record).every(
    (key) =>
      key === 'name' ||
      (key === 'version' && (record['version'] === undefined || Number.isInteger(record['version']))) ||
      (key === 'type' && record['type'] === 'JSON')
  );
}

export class SchemaRegistryRepository {
  private readonly pinned = new Map<string, RegisteredSchema>();
  private readonly latest = new Map<string, { at: number; schema: RegisteredSchema }>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now
  ) {}

  /** Registers a new version — always a new one; versions are immutable. */
  async register(
    namespaceId: string,
    input: { name: string; data: Record<string, JsonValue>; description?: string; createdBy?: string }
  ): Promise<RegisteredSchema> {
    if (!NAME.test(input.name)) {
      throw new InvalidArgumentError(`"${input.name}" is not a valid schema name`);
    }
    if (typeof input.data !== 'object' || input.data === null || Array.isArray(input.data)) {
      throw new InvalidArgumentError('a schema must be a JSON object');
    }

    return this.db.transaction().execute(async (tx) => {
      // Serialises version allocation per name: two concurrent registrations
      // must not both read the same max and collide.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${namespaceId}:schema:${input.name}`}))`.execute(tx);
      const current = await tx
        .selectFrom('Schemas')
        .select((eb) => eb.fn.max('version').as('max'))
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', input.name)
        .executeTakeFirst();

      const row = await tx
        .insertInto('Schemas')
        .values({
          namespaceId,
          name: input.name,
          version: Number(current?.max ?? 0) + 1,
          data: json(input.data),
          description: input.description ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning(['name', 'version', 'type', 'data', 'description', 'createdBy', 'createdAt'])
        .executeTakeFirstOrThrow();

      this.latest.delete(`${namespaceId}:${input.name}`);
      return toSchema(row);
    });
  }

  /** The newest version of each name, with how many versions exist. */
  async list(namespaceId: string): Promise<(RegisteredSchema & { versions: number })[]> {
    const rows = await this.db
      .selectFrom('Schemas as s')
      .select(['s.name', 's.version', 's.type', 's.data', 's.description', 's.createdBy', 's.createdAt'])
      .select((eb) =>
        eb
          .selectFrom('Schemas as c')
          .select((c) => c.fn.countAll<string>().as('n'))
          .whereRef('c.namespaceId', '=', 's.namespaceId')
          .whereRef('c.name', '=', 's.name')
          .as('versions')
      )
      .where('s.namespaceId', '=', namespaceId)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('Schemas as newer')
              .select('newer.version')
              .whereRef('newer.namespaceId', '=', 's.namespaceId')
              .whereRef('newer.name', '=', 's.name')
              .whereRef('newer.version', '>', 's.version')
          )
        )
      )
      .orderBy('s.name')
      .execute();
    return rows.map((row) => ({ ...toSchema(row), versions: Number(row.versions) }));
  }

  async versions(namespaceId: string, name: string): Promise<RegisteredSchema[]> {
    const rows = await this.db
      .selectFrom('Schemas')
      .select(['name', 'version', 'type', 'data', 'description', 'createdBy', 'createdAt'])
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .orderBy('version', 'desc')
      .execute();
    return rows.map(toSchema);
  }

  async get(namespaceId: string, name: string, version?: number): Promise<RegisteredSchema | undefined> {
    let query = this.db
      .selectFrom('Schemas')
      .select(['name', 'version', 'type', 'data', 'description', 'createdBy', 'createdAt'])
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name);
    query = version === undefined ? query.orderBy('version', 'desc').limit(1) : query.where('version', '=', version);
    const row = await query.executeTakeFirst();
    return row ? toSchema(row) : undefined;
  }

  async deleteVersion(namespaceId: string, name: string, version: number): Promise<boolean> {
    const result = await this.db
      .deleteFrom('Schemas')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .where('version', '=', version)
      .executeTakeFirst();
    this.pinned.delete(`${namespaceId}:${name}:${version}`);
    this.latest.delete(`${namespaceId}:${name}`);
    return Number(result.numDeletedRows) > 0;
  }

  /**
   * The concrete schema for an `inputSchema`/`outputSchema` value: itself when
   * inline, the registered one when a reference.
   *
   * A reference to a schema that does not exist throws — a contract that
   * silently stopped applying because its schema was deleted is exactly the
   * failure a registry exists to prevent.
   */
  async resolve(namespaceId: string, value: unknown): Promise<JsonValue | undefined> {
    if (!isSchemaReference(value)) return value as JsonValue | undefined;
    const schema = await this.cachedGet(namespaceId, value.name, value.version);
    if (!schema) {
      throw new NodeFlowError(
        ErrorCode.NOT_FOUND,
        `schema "${value.name}"${value.version ? ` version ${value.version}` : ''} is not registered`
      );
    }
    return schema.data;
  }

  private async cachedGet(namespaceId: string, name: string, version?: number) {
    if (version !== undefined) {
      const key = `${namespaceId}:${name}:${version}`;
      const hit = this.pinned.get(key);
      if (hit) return hit;
      const schema = await this.get(namespaceId, name, version);
      if (schema) {
        if (this.pinned.size > 1000) this.pinned.clear();
        this.pinned.set(key, schema);
      }
      return schema;
    }
    const key = `${namespaceId}:${name}`;
    const hit = this.latest.get(key);
    if (hit && this.now() - hit.at < LATEST_TTL_MS) return hit.schema;
    const schema = await this.get(namespaceId, name);
    if (schema) this.latest.set(key, { at: this.now(), schema });
    return schema;
  }
}

function toSchema(row: {
  name: string;
  version: number;
  type: string;
  data: unknown;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
}): RegisteredSchema {
  return { ...row, type: 'JSON', data: row.data as Record<string, JsonValue> };
}
