import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ErrorCode,
  InvalidArgumentError,
  NodeFlowError,
  PrincipalType,
  isValidScope,
  type Principal,
} from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import type { GroupRepository } from './group.repository.js';
import { checkPasswordPolicy, fakeVerify, hashPassword, verifyPassword } from './password.js';

/**
 * People, and the browser sessions they log in with.
 *
 * Machine credentials live in `IdentityRepository`; this is deliberately
 * separate, because almost every decision differs. A password needs a slow KDF
 * and a lockout policy; an API key needs neither. A human session must be
 * revocable the instant someone is offboarded; a worker token can expire on its
 * own. Sharing one code path would mean compromising both.
 */

const SESSION_TOKEN_BYTES = 32;

/** Absolute lifetime. A session that only slides forward never actually ends. */
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
/** Idle lifetime, refreshed on use — bounds an abandoned session on a shared machine. */
const SESSION_IDLE_SECONDS = 2 * 60 * 60;

/**
 * Failed-login backoff.
 *
 * Doubling from one second, capped at fifteen minutes, and cleared on success.
 * Deliberately *not* a permanent lockout: a lockout is a denial-of-service
 * against any account whose email an attacker knows — they simply fail logins
 * until the owner is locked out. Backoff makes brute force impractical while
 * leaving the real owner a way in a few seconds later.
 *
 * This is per-account. Per-IP limiting is a separate axis and a real gap: an
 * attacker spreading one guess across many accounts is not slowed by this.
 */
const BACKOFF_BASE_SECONDS = 1;
const BACKOFF_MAX_SECONDS = 15 * 60;
const BACKOFF_AFTER_ATTEMPTS = 3;

export interface NewUser {
  namespaceId: string;
  email: string;
  name: string;
  password: string;
  scopes?: string[];
}

export interface UserSession {
  /** Returned once, set as a cookie, never stored in clear. */
  token: string;
  expiresAt: Date;
  sessionId: string;
}

export type LoginFailure =
  | { ok: false; reason: 'invalid_credentials' }
  | { ok: false; reason: 'locked'; retryAfterSeconds: number }
  | { ok: false; reason: 'disabled' };

export type LoginResult = { ok: true; principal: Principal; session: UserSession } | LoginFailure;

/**
 * A hash no password can produce.
 *
 * Federated accounts have no password. Storing a well-known placeholder that
 * the verifier might one day accept is the risk; a value that is not a valid
 * hash at all can only ever fail.
 */
const FEDERATED_PASSWORD_HASH = 'federated:no-password';

export class UserRepository {
  constructor(
    private readonly db: Db,
    /** Supplies the scopes a user holds through their groups. */
    private readonly groups?: GroupRepository
  ) {}

  // ---------------------------------------------------------------- accounts

  async createUser(input: NewUser): Promise<{ id: string }> {
    const scopes = input.scopes ?? [];
    const invalid = scopes.filter((scope) => !isValidScope(scope));
    if (invalid.length > 0) {
      throw new InvalidArgumentError(`invalid scope(s): ${invalid.join(', ')}`);
    }

    const problems = checkPasswordPolicy(input.password, [input.email, input.name]);
    if (problems.length > 0) {
      throw new InvalidArgumentError(problems.map((p) => p.message).join('; '), {
        problems,
      });
    }

    const row = await this.db
      .insertInto('Users')
      .values({
        namespaceId: input.namespaceId,
        // Stored lowercase. The unique index is on `lower(email)`, so storing
        // mixed case would let the display value and the lookup key disagree.
        email: input.email.trim().toLowerCase(),
        name: input.name,
        passwordHash: await hashPassword(input.password),
        scopes,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { id: row.id };
  }

  /**
   * Authenticates an email and password, and opens a session.
   *
   * Every failure returns the *same* reason and takes roughly the same time. A
   * response that distinguishes "no such account" from "wrong password" is a
   * user-enumeration oracle, and one that returns faster for an unknown email
   * is the same oracle by another route — which is why the no-account path
   * still burns a KDF.
   */
  async login(options: {
    namespaceId: string;
    email: string;
    password: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<LoginResult> {
    const email = options.email.trim().toLowerCase();

    const user = await this.db
      .selectFrom('Users')
      .selectAll()
      .where('namespaceId', '=', options.namespaceId)
      // Matches the `lower("email")` unique index, so the lookup uses it.
      .where(sql<boolean>`lower("email") = ${email}`)
      .executeTakeFirst();

    if (!user) {
      await fakeVerify(options.password);
      return { ok: false, reason: 'invalid_credentials' };
    }

    if (user.disabledAt) {
      await fakeVerify(options.password);
      return { ok: false, reason: 'invalid_credentials' };
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return {
        ok: false,
        reason: 'locked',
        retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
      };
    }

    const { valid, needsRehash } = await verifyPassword(options.password, user.passwordHash);

    if (!valid) {
      await this.recordFailure(user.id, user.failedLogins + 1);
      return { ok: false, reason: 'invalid_credentials' };
    }

    // Upgrade the stored hash if it was made with weaker parameters. This is
    // the only moment the plaintext is available, so it is the only chance.
    if (needsRehash) {
      await this.db
        .updateTable('Users')
        .set({ passwordHash: await hashPassword(options.password) })
        .where('id', '=', user.id)
        .execute();
    }

    await this.db
      .updateTable('Users')
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: sql<Date>`now()` })
      .where('id', '=', user.id)
      .execute();

    const session = await this.openSession(user.id, options.userAgent, options.ipAddress);

    return {
      ok: true,
      session,
      principal: {
        type: PrincipalType.USER,
        id: user.id,
        name: user.name,
        namespaceId: user.namespaceId,
        // Group scopes here too, not only on session resolution: the principal
        // returned by login is what a client renders its UI from, and one that
        // disagrees with the next request's principal produces menus that lead
        // to 403s.
        scopes: await this.effectiveScopes(user.id, user.scopes),
        tagGrants: this.groups ? await this.groups.tagGrantsFor(user.id) : [],
      },
    };
  }

  /**
   * Signs in a user the identity provider has already authenticated.
   *
   * No password is involved and none is checked — the IdP made that decision,
   * and this is where its verdict becomes a session.
   *
   * **The account is provisioned on first sign-in.** The alternative is an
   * administrator creating every account by hand before anyone can log in,
   * which in practice means a shared login or SSO that nobody uses. What is
   * *not* provisioned is authority: a new account gets no scopes and reaches
   * nothing until it is put in a group, so a stranger who can authenticate at
   * the IdP gains an empty session and not access.
   *
   * The lockout counters that guard password login are deliberately untouched:
   * there is nothing here to brute-force, and letting a federated sign-in reset
   * them would hand an attacker a way to clear the evidence of one.
   */
  async loginFederated(options: {
    namespaceId: string;
    email: string;
    name?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{ principal: Principal; session: UserSession; provisioned: boolean }> {
    // Case-insensitively, matching how password login looks accounts up: an
    // IdP that changes the casing of an address must not create a second
    // account for the same person.
    const existing = await this.db
      .selectFrom('Users')
      .select(['id', 'name', 'namespaceId', 'scopes', 'disabledAt'])
      .where('namespaceId', '=', options.namespaceId)
      .where(sql`lower("email")`, '=', options.email.toLowerCase())
      .executeTakeFirst();

    if (existing?.disabledAt) {
      // A disabled account must stay disabled however the person authenticates.
      throw new NodeFlowError(ErrorCode.CONFLICT, 'this account is disabled');
    }

    let userId = existing?.id;
    let displayName = existing?.name ?? options.name ?? options.email;
    const provisioned = !existing;

    if (!userId) {
      const row = await this.db
        .insertInto('Users')
        .values({
          namespaceId: options.namespaceId,
          email: options.email,
          name: options.name ?? options.email,
          // Never usable: a federated account has no password, and storing a
          // placeholder that could be guessed would be worse than none.
          passwordHash: FEDERATED_PASSWORD_HASH,
          scopes: [],
        })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();

      userId = row.id;
      displayName = row.name;
    }

    const session = await this.openSession(userId, options.userAgent, options.ipAddress);

    return {
      principal: {
        type: PrincipalType.USER,
        id: userId,
        name: displayName,
        namespaceId: options.namespaceId,
        scopes: await this.effectiveScopes(userId, existing?.scopes ?? []),
        tagGrants: this.groups ? await this.groups.tagGrantsFor(userId) : [],
      },
      session,
      provisioned,
    };
  }

  // ---------------------------------------------------------------- sessions

  /**
   * Resolves a session cookie to a principal.
   *
   * Expiry, revocation and idle timeout are all checked in the query rather
   * than in JavaScript, so no code path can forget one and hand back a session
   * that should have ended.
   */
  async authenticateSession(token: string): Promise<Principal | undefined> {
    const row = await this.db
      .selectFrom('Sessions')
      .innerJoin('Users', 'Users.id', 'Sessions.userId')
      .select([
        'Sessions.id as sessionId',
        'Users.id as userId',
        'Users.name as name',
        'Users.namespaceId as namespaceId',
        'Users.scopes as scopes',
      ])
      .where('Sessions.tokenHash', '=', hashSessionToken(token))
      .where('Sessions.revokedAt', 'is', null)
      .where('Sessions.expiresAt', '>', sql<Date>`now()`)
      .where(
        'Sessions.lastSeenAt',
        '>',
        sql<Date>`now() - make_interval(secs => ${SESSION_IDLE_SECONDS})`
      )
      .where('Users.disabledAt', 'is', null)
      .executeTakeFirst();

    if (!row) return undefined;

    await this.touchSession(row.sessionId);

    return {
      type: PrincipalType.USER,
      id: row.userId,
      name: row.name,
      namespaceId: row.namespaceId,
      scopes: await this.effectiveScopes(row.userId, row.scopes),
      tagGrants: this.groups ? await this.groups.tagGrantsFor(row.userId) : [],
    };
  }

  /**
   * A user's own scopes plus everything their groups grant.
   *
   * Resolved here rather than at each authorization check, so every call site
   * reads one flat list and no check can forget to consider groups — the kind
   * of omission that produces "it works in the API but not in the UI".
   *
   * Scopes only ever accumulate; there is no deny. See `GroupRepository`.
   */
  private async effectiveScopes(userId: string, own: string[]): Promise<string[]> {
    if (!this.groups) return own;

    const granted = await this.groups.scopesFor(userId);
    return granted.length === 0 ? own : [...new Set([...own, ...granted])];
  }

  /** Ends one session. Idempotent. */
  async revokeSession(token: string): Promise<void> {
    await this.db
      .updateTable('Sessions')
      .set({ revokedAt: sql<Date>`now()` })
      .where('tokenHash', '=', hashSessionToken(token))
      .where('revokedAt', 'is', null)
      .execute();
  }

  /** "Sign out everywhere" — and what an admin does after a compromise. */
  async revokeAllSessions(userId: string): Promise<number> {
    const rows = await this.db
      .updateTable('Sessions')
      .set({ revokedAt: sql<Date>`now()` })
      .where('userId', '=', userId)
      .where('revokedAt', 'is', null)
      .returning('id')
      .execute();

    return rows.length;
  }

  /**
   * Changes a password and ends every other session.
   *
   * Revoking the rest is the point of changing a password after a suspected
   * compromise: leaving them alive means the attacker keeps their access and
   * the user believes they have fixed it.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const user = await this.db
      .selectFrom('Users')
      .select(['id', 'email', 'name', 'passwordHash'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) return false;

    const { valid } = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) return false;

    const problems = checkPasswordPolicy(newPassword, [user.email, user.name]);
    if (problems.length > 0) {
      throw new InvalidArgumentError(problems.map((p) => p.message).join('; '), { problems });
    }

    await this.db
      .updateTable('Users')
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: sql<Date>`now()` })
      .where('id', '=', userId)
      .execute();

    await this.revokeAllSessions(userId);
    return true;
  }

  async disableUser(namespaceId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .updateTable('Users')
      .set({ disabledAt: sql<Date>`now()` })
      .where('namespaceId', '=', namespaceId)
      .where('id', '=', userId)
      .returning('id')
      .execute();

    // Disabling without revoking would leave the person logged in until their
    // session happened to expire.
    if (rows.length > 0) await this.revokeAllSessions(userId);
    return rows.length > 0;
  }

  async listUsers(namespaceId: string) {
    return this.db
      .selectFrom('Users')
      .select(['id', 'email', 'name', 'scopes', 'disabledAt', 'lastLoginAt', 'createdAt'])
      .where('namespaceId', '=', namespaceId)
      .orderBy('createdAt')
      .execute();
  }

  /** Removes sessions that can no longer authenticate. For the poller. */
  async pruneExpiredSessions(): Promise<number> {
    const rows = await this.db
      .deleteFrom('Sessions')
      .where((eb) =>
        eb.or([
          eb('expiresAt', '<=', sql<Date>`now()`),
          eb('revokedAt', '<', sql<Date>`now() - interval '7 days'`),
        ])
      )
      .returning('id')
      .execute();

    return rows.length;
  }

  // ----------------------------------------------------------------- helpers

  private async openSession(
    userId: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<UserSession> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_SECONDS * 1000);

    const row = await this.db
      .insertInto('Sessions')
      .values({
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt,
        userAgent: userAgent?.slice(0, 512) ?? null,
        ipAddress: ipAddress?.slice(0, 64) ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { token, expiresAt, sessionId: row.id };
  }

  /**
   * Moves the idle deadline forward.
   *
   * Rate-limited to once a minute. Without that, every request writes a row —
   * turning a read-mostly authentication check into a write on the hot path,
   * and generating WAL for no benefit at second granularity.
   */
  private async touchSession(sessionId: string): Promise<void> {
    try {
      await this.db
        .updateTable('Sessions')
        .set({ lastSeenAt: sql<Date>`now()` })
        .where('id', '=', sessionId)
        .where('lastSeenAt', '<', sql<Date>`now() - interval '1 minute'`)
        .execute();
    } catch {
      // Telemetry-ish; a write failure must not fail a valid authentication.
    }
  }

  private async recordFailure(userId: string, attempts: number): Promise<void> {
    const over = attempts - BACKOFF_AFTER_ATTEMPTS;
    const seconds =
      over <= 0
        ? 0
        : Math.min(BACKOFF_BASE_SECONDS * 2 ** (over - 1), BACKOFF_MAX_SECONDS);

    await this.db
      .updateTable('Users')
      .set({
        failedLogins: attempts,
        lockedUntil:
          seconds > 0 ? sql<Date>`now() + make_interval(secs => ${seconds})` : null,
      })
      .where('id', '=', userId)
      .execute();
  }
}

/**
 * Hashes a session token for lookup.
 *
 * SHA-256, not a KDF — the token is 256 bits of generated entropy, so there is
 * no dictionary to slow down, and this runs on every authenticated request.
 * The same reasoning as API keys, and the opposite of passwords.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare, for callers checking a CSRF token. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
