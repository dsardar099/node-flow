import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import { json } from './schema.js';

export type EnvironmentVariableType = 'TEXT' | 'JSON';

export interface EnvironmentVariable {
  name: string;
  type: EnvironmentVariableType;
  value: JsonValue;
  description: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
/** Large enough for any configuration value; small enough that every evaluation can load them all. */
const MAX_VALUE_BYTES = 64 * 1024;
/** Evaluations read these constantly and they change rarely. */
const CACHE_MS = 5_000;

/**
 * Environment variables, per namespace.
 *
 * Loaded whole into each evaluation, so the decider can resolve
 * `${workflow.env.name}` without I/O. A short cache keeps that from being a
 * query per evaluation; an edit is visible within seconds, and immediately on
 * the process that made it.
 */
export class EnvironmentRepository {
  private readonly cache = new Map<string, { at: number; values: Record<string, JsonValue> }>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now
  ) {}

  async list(namespaceId: string): Promise<EnvironmentVariable[]> {
    const rows = await this.db
      .selectFrom('EnvironmentVariables')
      .select(['name', 'type', 'value', 'description', 'updatedBy', 'createdAt', 'updatedAt'])
      .where('namespaceId', '=', namespaceId)
      .orderBy('name')
      .execute();
    return rows.map((row) => ({ ...row, type: row.type as EnvironmentVariableType }));
  }

  async put(
    namespaceId: string,
    input: { name: string; type: EnvironmentVariableType; value: JsonValue; description?: string; updatedBy?: string }
  ): Promise<EnvironmentVariable> {
    if (!NAME.test(input.name)) {
      throw new InvalidArgumentError(
        `"${input.name}" is not a valid name: letters, digits and underscores, not starting with a digit`
      );
    }
    if (input.type === 'TEXT' && typeof input.value !== 'string') {
      throw new InvalidArgumentError('a TEXT variable holds a string; use type JSON for anything else');
    }
    const encoded = json(input.value);
    if (Buffer.byteLength(encoded) > MAX_VALUE_BYTES) {
      throw new InvalidArgumentError(`value is larger than ${MAX_VALUE_BYTES / 1024} KB`);
    }

    const values = {
      type: input.type,
      value: encoded,
      description: input.description ?? null,
      updatedBy: input.updatedBy ?? null,
    };
    const row = await this.db
      .insertInto('EnvironmentVariables')
      .values({ namespaceId, name: input.name, ...values })
      .onConflict((oc) => oc.columns(['namespaceId', 'name']).doUpdateSet({ ...values, updatedAt: sql<Date>`now()` }))
      .returning(['name', 'type', 'value', 'description', 'updatedBy', 'createdAt', 'updatedAt'])
      .executeTakeFirstOrThrow();

    this.cache.delete(namespaceId);
    return { ...row, type: row.type as EnvironmentVariableType };
  }

  async delete(namespaceId: string, name: string): Promise<void> {
    const result = await this.db
      .deleteFrom('EnvironmentVariables')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();
    this.cache.delete(namespaceId);
    if (Number(result.numDeletedRows) === 0) {
      throw new NodeFlowError(ErrorCode.NOT_FOUND, `no environment variable "${name}"`);
    }
  }

  /** Name → value, for expression resolution. */
  async load(namespaceId: string): Promise<Record<string, JsonValue>> {
    const cached = this.cache.get(namespaceId);
    if (cached && this.now() - cached.at < CACHE_MS) return cached.values;

    const rows = await this.db
      .selectFrom('EnvironmentVariables')
      .select(['name', 'value'])
      .where('namespaceId', '=', namespaceId)
      .execute();
    const values = Object.fromEntries(rows.map((row) => [row.name, row.value]));
    this.cache.set(namespaceId, { at: this.now(), values });
    return values;
  }
}
