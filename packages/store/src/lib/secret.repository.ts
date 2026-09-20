import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import { json } from './schema.js';
import type { SealedSecret, SecretCipher } from './secret-crypto.js';

/**
 * Secrets and environment variables.
 *
 * The rule that shapes the whole API: **a sealed value is write-only.** It can
 * be created, replaced and deleted through the API, and listed by name — but
 * never read back. The engine resolves it on the dispatch path and nowhere
 * else.
 *
 * That is not caution for its own sake. An endpoint that returns a secret is an
 * endpoint that turns any over-broad credential, any logging middleware and any
 * screen-share into a credential disclosure. Someone who needs to know the
 * value already has it; someone who does not needs to rotate it instead.
 */

/** Naming is constrained because names are addressed from expressions. */
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,126}$/;

export interface SecretSummary {
  name: string;
  description: string | null;
  sealed: boolean;
  /** Present only for a variable, which is not a credential. */
  value?: JsonValue;
  keyId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class SecretRepository {
  constructor(
    private readonly db: Db,
    /** Absent when the install configured no master key, which disables sealing. */
    private readonly cipher?: SecretCipher
  ) {}

  get canSeal(): boolean {
    return this.cipher !== undefined;
  }

  /**
   * Creates or replaces a value.
   *
   * Upsert rather than create-then-update: rotating a credential is the common
   * operation, and making it two calls invites the window where the secret does
   * not exist.
   */
  async put(input: {
    namespaceId: string;
    name: string;
    value: string;
    description?: string;
    sealed?: boolean;
    by?: string;
  }): Promise<SecretSummary> {
    assertName(input.name);

    const sealed = input.sealed ?? true;
    if (sealed && !this.cipher) {
      throw new NodeFlowError(
        ErrorCode.INVALID_ARGUMENT,
        'this install stores no secrets: set NODE_FLOW_SECRET_KEYS to enable them'
      );
    }

    const stored: JsonValue = sealed
      ? (this.cipher!.seal(input.value, input.namespaceId, input.name) as unknown as JsonValue)
      : input.value;

    const row = await this.db
      .insertInto('Secrets')
      .values({
        namespaceId: input.namespaceId,
        name: input.name,
        description: input.description ?? null,
        sealed,
        value: json(stored),
        keyId: sealed ? this.cipher!.activeKeyId : null,
        createdBy: input.by ?? null,
        updatedBy: input.by ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['namespaceId', 'name']).doUpdateSet({
          description: input.description ?? null,
          sealed,
          value: json(stored),
          keyId: sealed ? this.cipher!.activeKeyId : null,
          updatedBy: input.by ?? null,
          updatedAt: sql<Date>`now()`,
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return toSummary(row);
  }

  /** Names and metadata. Never a sealed value. */
  async list(namespaceId: string): Promise<SecretSummary[]> {
    const rows = await this.db
      .selectFrom('Secrets')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .orderBy('name', 'asc')
      .execute();

    return rows.map(toSummary);
  }

  async delete(namespaceId: string, name: string): Promise<boolean> {
    const rows = await this.db
      .deleteFrom('Secrets')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returning('id')
      .execute();

    return rows.length > 0;
  }

  /**
   * Opens the named values, for the dispatch path only.
   *
   * Takes the names an expression actually referenced rather than loading the
   * namespace's secrets wholesale: a task that needs one credential should not
   * cause every other one to be decrypted into the same process memory.
   *
   * A name that does not exist is simply absent from the result. The caller
   * decides whether that is fatal, because for an optional variable it is not.
   */
  async resolve(namespaceId: string, names: string[]): Promise<Record<string, JsonValue>> {
    if (names.length === 0) return {};

    const rows = await this.db
      .selectFrom('Secrets')
      .select(['name', 'sealed', 'value'])
      .where('namespaceId', '=', namespaceId)
      .where('name', 'in', [...new Set(names)])
      .execute();

    const resolved: Record<string, JsonValue> = {};

    for (const row of rows) {
      if (!row.sealed) {
        resolved[row.name] = row.value as JsonValue;
        continue;
      }

      if (!this.cipher) {
        throw new NodeFlowError(
          ErrorCode.INTERNAL,
          `secret "${row.name}" is sealed but this install has no master key configured`
        );
      }

      resolved[row.name] = this.cipher.open(
        row.value as unknown as SealedSecret,
        namespaceId,
        row.name
      );
    }

    return resolved;
  }

  /**
   * Re-seals everything not under the active master key.
   *
   * The operation a rotation consists of. Each row is re-sealed on its own so a
   * single unreadable secret — sealed by a key that was dropped from the
   * configuration — does not abort the rest, and is reported instead.
   */
  async rotate(limit = 500): Promise<{ rotated: number; failed: { name: string; reason: string }[] }> {
    if (!this.cipher) return { rotated: 0, failed: [] };

    const stale = await this.db
      .selectFrom('Secrets')
      .select(['id', 'namespaceId', 'name', 'value'])
      .where('sealed', '=', true)
      .where((eb) => eb.or([eb('keyId', 'is', null), eb('keyId', '!=', this.cipher!.activeKeyId)]))
      .limit(limit)
      .execute();

    let rotated = 0;
    const failed: { name: string; reason: string }[] = [];

    for (const row of stale) {
      try {
        const plaintext = this.cipher.open(
          row.value as unknown as SealedSecret,
          row.namespaceId,
          row.name
        );
        const resealed = this.cipher.seal(plaintext, row.namespaceId, row.name);

        await this.db
          .updateTable('Secrets')
          .set({
            value: json(resealed as unknown as JsonValue),
            keyId: this.cipher.activeKeyId,
            updatedAt: sql<Date>`now()`,
          })
          .where('id', '=', row.id)
          .execute();

        rotated += 1;
      } catch (error) {
        failed.push({ name: row.name, reason: (error as Error).message });
      }
    }

    return { rotated, failed };
  }
}

/**
 * Names are addressed from `${secrets.NAME}`, so they have to be expressible.
 *
 * Rejected at write time rather than silently accepted: a secret named with a
 * space or a `$` can be stored and can never be referenced, which presents
 * later as "my secret does not work" with nothing to see.
 */
function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new InvalidArgumentError(
      `"${name}" is not a usable secret name: start with a letter, then letters, digits, "_", "." or "-"`
    );
  }
}

function toSummary(row: Record<string, unknown>): SecretSummary {
  const sealed = row['sealed'] === true;

  return {
    name: row['name'] as string,
    description: (row['description'] ?? null) as string | null,
    sealed,
    // A variable is returned; a sealed value never is, anywhere.
    ...(sealed ? {} : { value: row['value'] as JsonValue }),
    keyId: (row['keyId'] ?? null) as string | null,
    createdBy: (row['createdBy'] ?? null) as string | null,
    updatedBy: (row['updatedBy'] ?? null) as string | null,
    createdAt: row['createdAt'] as Date,
    updatedAt: row['updatedAt'] as Date,
  };
}
