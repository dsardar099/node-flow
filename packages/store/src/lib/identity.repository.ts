import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrincipalType, isValidScope, type Principal } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';

/**
 * Credentials: issuing them, and turning one back into a {@link Principal}.
 *
 * All the cryptography lives here rather than in the server, for the same
 * reason the namespace filter does: a rule enforced at the HTTP layer is a rule
 * that the next caller — a runner, a test, a CLI — bypasses without noticing.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

/** Cost parameters are fixed rather than configurable; see `verifySecret`. */
const SCRYPT_KEY_BYTES = 64;
const SECRET_BYTES = 32;
const API_KEY_BYTES = 32;
const API_KEY_PREFIX = 'nf_';
/** Enough to identify a key in a list without narrowing the search space. */
const VISIBLE_PREFIX_LENGTH = API_KEY_PREFIX.length + 6;

export interface NewServiceAccount {
  namespaceId: string;
  name: string;
  scopes: string[];
}

export interface IssuedServiceAccount {
  id: string;
  keyId: string;
  /** Returned once, never stored in clear, never recoverable. */
  secret: string;
}

export interface IssuedApiKey {
  id: string;
  prefix: string;
  /** Returned once. */
  token: string;
}

export class InvalidScopeError extends Error {
  readonly code = 'INVALID_SCOPE';
}

export class IdentityRepository {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------ service accounts

  /**
   * Creates a service account and returns its secret exactly once.
   *
   * The secret is generated here rather than accepted from the caller. A
   * caller-chosen secret is a caller-chosen *weak* secret eventually, and there
   * is no reason a machine credential should ever be memorable.
   */
  async createServiceAccount(input: NewServiceAccount): Promise<IssuedServiceAccount> {
    this.assertScopes(input.scopes);

    const keyId = `sa_${randomBytes(9).toString('base64url')}`;
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(secret, salt, SCRYPT_KEY_BYTES)).toString('hex');

    const row = await this.db
      .insertInto('ServiceAccounts')
      .values({
        namespaceId: input.namespaceId,
        name: input.name,
        keyId,
        secretHash: hash,
        secretSalt: salt,
        scopes: input.scopes,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: row.id, keyId, secret };
  }

  /**
   * Verifies a key/secret pair.
   *
   * Returns `undefined` for every failure — unknown key, wrong secret, disabled
   * account — so a caller cannot turn the error into a key-enumeration oracle
   * by telling "no such key" apart from "wrong secret".
   */
  async authenticateServiceAccount(
    keyId: string,
    secret: string
  ): Promise<Principal | undefined> {
    const row = await this.db
      .selectFrom('ServiceAccounts')
      .selectAll()
      .where('keyId', '=', keyId)
      .executeTakeFirst();

    if (!row || row.disabledAt) {
      // Hash anyway. Returning early on an unknown key makes the response
      // measurably faster than a wrong secret, which is enough to enumerate
      // valid key ids over enough samples.
      await scrypt(secret, 'absent', SCRYPT_KEY_BYTES);
      return undefined;
    }

    const candidate = await scrypt(secret, row.secretSalt, SCRYPT_KEY_BYTES);
    const expected = Buffer.from(row.secretHash, 'hex');

    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      return undefined;
    }

    await this.touch('ServiceAccounts', row.id);

    return {
      type: PrincipalType.SERVICE_ACCOUNT,
      id: row.id,
      name: row.name,
      namespaceId: row.namespaceId,
      scopes: row.scopes,
    };
  }

  async disableServiceAccount(namespaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .updateTable('ServiceAccounts')
      .set({ disabledAt: sql<Date>`now()` })
      .where('namespaceId', '=', namespaceId)
      .where('id', '=', id)
      .returning('id')
      .execute();

    return rows.length > 0;
  }

  async listServiceAccounts(namespaceId: string) {
    return this.db
      .selectFrom('ServiceAccounts')
      .select(['id', 'name', 'keyId', 'scopes', 'disabledAt', 'createdAt', 'lastUsedAt'])
      .where('namespaceId', '=', namespaceId)
      .orderBy('createdAt')
      .execute();
  }

  // ------------------------------------------------------------------- API keys

  /** Creates an API key and returns the token exactly once. */
  async createApiKey(input: {
    namespaceId: string;
    name: string;
    scopes: string[];
    expiresAt?: Date;
  }): Promise<IssuedApiKey> {
    this.assertScopes(input.scopes);

    const token = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('base64url')}`;
    const prefix = token.slice(0, VISIBLE_PREFIX_LENGTH);

    const row = await this.db
      .insertInto('ApiKeys')
      .values({
        namespaceId: input.namespaceId,
        name: input.name,
        prefix,
        tokenHash: hashApiKey(token),
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: row.id, prefix, token };
  }

  /**
   * Resolves an API key to a principal.
   *
   * Expiry and revocation are checked in the query rather than in JavaScript,
   * so there is no window where code that forgets the check still gets a row.
   */
  async authenticateApiKey(token: string): Promise<Principal | undefined> {
    const row = await this.db
      .selectFrom('ApiKeys')
      .selectAll()
      .where('tokenHash', '=', hashApiKey(token))
      .where('revokedAt', 'is', null)
      .where((eb) =>
        eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', sql<Date>`now()`)])
      )
      .executeTakeFirst();

    if (!row) return undefined;

    await this.touch('ApiKeys', row.id);

    return {
      type: PrincipalType.SERVICE_ACCOUNT,
      id: row.id,
      name: row.name,
      namespaceId: row.namespaceId,
      scopes: row.scopes,
    };
  }

  async revokeApiKey(namespaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .updateTable('ApiKeys')
      .set({ revokedAt: sql<Date>`now()` })
      .where('namespaceId', '=', namespaceId)
      .where('id', '=', id)
      .where('revokedAt', 'is', null)
      .returning('id')
      .execute();

    return rows.length > 0;
  }

  async listApiKeys(namespaceId: string) {
    return this.db
      .selectFrom('ApiKeys')
      .select(['id', 'name', 'prefix', 'scopes', 'expiresAt', 'revokedAt', 'createdAt', 'lastUsedAt'])
      .where('namespaceId', '=', namespaceId)
      .orderBy('createdAt')
      .execute();
  }

  // -------------------------------------------------------------------- helpers

  private assertScopes(scopes: string[]): void {
    const invalid = scopes.filter((scope) => !isValidScope(scope));
    if (invalid.length > 0) {
      throw new InvalidScopeError(`invalid scope(s): ${invalid.join(', ')}`);
    }
  }

  /**
   * Records last use, without letting it fail the request.
   *
   * This is telemetry — "is this credential still in use before I revoke it?" —
   * and a write failure here must never turn a valid authentication into a 500.
   */
  private async touch(table: 'ServiceAccounts' | 'ApiKeys', id: string): Promise<void> {
    try {
      await this.db
        .updateTable(table)
        .set({ lastUsedAt: sql<Date>`now()` })
        .where('id', '=', id)
        .execute();
    } catch {
      // Deliberately ignored.
    }
  }
}

/**
 * Hashes an API key for lookup.
 *
 * Plain SHA-256, not a KDF, and that is correct here: the token is 256 bits of
 * generated entropy, so there is no dictionary to run and nothing for a slow
 * hash to slow down — while the cost would land on every single request.
 */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
