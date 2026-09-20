import { PrincipalType, Scope, hasScope } from '@node-flow-dev/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { UserRepository, hashSessionToken } from './user.repository.js';

/**
 * Human login.
 *
 * Password authentication is the part of a system attackers actually attack, so
 * these tests are weighted almost entirely toward refusal: enumeration, brute
 * force, stale sessions, and the gap between disabling an account and the
 * person actually losing access.
 */

let harness: PostgresHarness;
let users: UserRepository;
let namespaceId: string;
let otherNamespaceId: string;

const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  harness = await startPostgresHarness();
  users = new UserRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  namespaceId = await seedNamespace(harness.db, 'acme');
  otherNamespaceId = await seedNamespace(harness.db, 'other');
});

const create = (overrides: Partial<Parameters<UserRepository['createUser']>[0]> = {}) =>
  users.createUser({
    namespaceId,
    email: 'ada@example.com',
    name: 'Ada',
    password: PASSWORD,
    scopes: [Scope.EXECUTIONS_READ],
    ...overrides,
  });

const login = (overrides: Partial<Parameters<UserRepository['login']>[0]> = {}) =>
  users.login({ namespaceId, email: 'ada@example.com', password: PASSWORD, ...overrides });

describe('password hashing', () => {
  it('never stores the password', async () => {
    await create();
    const row = await harness.db
      .selectFrom('Users')
      .select('passwordHash')
      .executeTakeFirstOrThrow();

    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  // Hard-coding the parameters would freeze them forever: raising them later
  // would make every existing hash unverifiable.
  it('records its cost parameters alongside the digest', async () => {
    const hash = await hashPassword(PASSWORD);
    const [algorithm, N, r, p] = hash.split('$');

    expect(algorithm).toBe('scrypt');
    expect(Number(N)).toBeGreaterThanOrEqual(32_768);
    expect(Number(r)).toBeGreaterThanOrEqual(8);
    expect(Number(p)).toBeGreaterThanOrEqual(1);
  });

  it('salts, so the same password hashes differently each time', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('verifies the right password and refuses the wrong one', async () => {
    const hash = await hashPassword(PASSWORD);

    expect((await verifyPassword(PASSWORD, hash)).valid).toBe(true);
    expect((await verifyPassword('wrong', hash)).valid).toBe(false);
  });

  // A corrupt row must not turn a login into a 500 — that tells an attacker
  // they have found something interesting.
  it('returns invalid rather than throwing on a malformed hash', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$1$2$3', 'bcrypt$1$1$1$aa$bb']) {
      expect((await verifyPassword(PASSWORD, bad)).valid, bad).toBe(false);
    }
  });

  // A hash is attacker-influenced data the moment anything can write one, and
  // `N = 2^40` from a poisoned row is a memory-exhaustion attack.
  it('refuses absurd cost parameters instead of honouring them', async () => {
    const absurd = `scrypt$1099511627776$8$1$${Buffer.from('salt').toString('base64url')}$${Buffer.from('hash').toString('base64url')}`;
    expect((await verifyPassword(PASSWORD, absurd)).valid).toBe(false);
  });

  it('flags a hash made with weaker parameters for upgrade', async () => {
    const weak = `scrypt$16384$8$1$${Buffer.from('0123456789abcdef').toString('base64url')}$${Buffer.from('x').toString('base64url')}`;
    // Wrong digest, so invalid — and `needsRehash` must not be claimed for a
    // password that did not actually verify.
    expect(await verifyPassword(PASSWORD, weak)).toEqual({ valid: false, needsRehash: false });
  });

  it('upgrades a weakly-hashed password on next login', async () => {
    await create();

    // Rewrite the stored hash with weaker-but-valid parameters.
    const { scrypt } = await import('node:crypto');
    const weakHash = await new Promise<string>((resolve, reject) => {
      const salt = Buffer.from('0123456789abcdef');
      scrypt(PASSWORD, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
        err
          ? reject(err)
          : resolve(`scrypt$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`)
      );
    });
    await harness.db.updateTable('Users').set({ passwordHash: weakHash }).execute();

    expect((await login()).ok).toBe(true);

    const after = await harness.db
      .selectFrom('Users')
      .select('passwordHash')
      .executeTakeFirstOrThrow();
    expect(after.passwordHash.split('$')[1]).toBe('32768');
  });
});

describe('password policy', () => {
  it('requires length, not composition', () => {
    // Long and all-lowercase is fine; short with symbols is not. Composition
    // rules push people to `Password1!` and to reuse.
    expect(checkPasswordPolicy('a-perfectly-fine-passphrase')).toEqual([]);
    expect(checkPasswordPolicy('Sh0rt!').map((p) => p.code)).toContain('too_short');
  });

  it('rejects a password containing the account identifier', () => {
    const problems = checkPasswordPolicy('ada-loves-numbers', ['ada@example.com', 'Ada']);
    expect(problems.map((p) => p.code)).toContain('contains_identifier');
  });

  it('rejects the passwords a stuffing run opens with', () => {
    expect(checkPasswordPolicy('password123').map((p) => p.code)).toContain('too_common');
  });

  // An unbounded password is a denial-of-service against a deliberately
  // expensive KDF.
  it('rejects an enormous password', () => {
    expect(checkPasswordPolicy('x'.repeat(10_000)).map((p) => p.code)).toContain('too_long');
  });

  // One problem per attempt turns fixing a password into a guessing loop.
  it('reports every problem at once', () => {
    const problems = checkPasswordPolicy('ada', ['ada@example.com']);
    expect(problems.map((p) => p.code)).toEqual(
      expect.arrayContaining(['too_short', 'contains_identifier'])
    );
  });

  it('is enforced when creating a user', async () => {
    await expect(create({ password: 'short' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('login', () => {
  it('authenticates and returns a USER principal', async () => {
    await create();
    const result = await login();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.principal.type).toBe(PrincipalType.USER);
    expect(result.principal.namespaceId).toBe(namespaceId);
    expect(hasScope(result.principal, Scope.EXECUTIONS_READ)).toBe(true);
  });

  it('treats the email as case-insensitive', async () => {
    await create();
    expect((await login({ email: 'ADA@Example.COM' })).ok).toBe(true);
  });

  // Distinguishing "no such account" from "wrong password" is a
  // user-enumeration oracle.
  it('gives the same answer for an unknown email and a wrong password', async () => {
    await create();

    const unknown = await login({ email: 'nobody@example.com' });
    const wrong = await login({ password: 'not-the-password' });

    expect(unknown).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(wrong).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  // The same oracle by another route: returning early for an unknown email
  // makes it measurably faster than a real verification.
  it('takes comparable time for an unknown email', async () => {
    await create();

    const time = async (fn: () => Promise<unknown>) => {
      const started = process.hrtime.bigint();
      await fn();
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    const unknownMs = await time(() => login({ email: 'nobody@example.com' }));
    const wrongMs = await time(() => login({ password: 'not-the-password' }));

    // Generous: the point is that the unknown path is not *trivially* faster,
    // not that the two are identical.
    expect(unknownMs).toBeGreaterThan(wrongMs * 0.3);
  });

  it('refuses a disabled account without saying so', async () => {
    const user = await create();
    await users.disableUser(namespaceId, user.id);

    expect(await login()).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('will not authenticate across namespaces', async () => {
    await create();
    expect((await users.login({
      namespaceId: otherNamespaceId,
      email: 'ada@example.com',
      password: PASSWORD,
    })).ok).toBe(false);
  });

  it('records the last login', async () => {
    await create();
    await login();

    const [row] = await users.listUsers(namespaceId);
    expect(row.lastLoginAt).toBeInstanceOf(Date);
  });
});

describe('brute-force backoff', () => {
  it('locks out after repeated failures', async () => {
    await create();

    for (let i = 0; i < 5; i++) await login({ password: 'wrong' });

    const result = await login({ password: 'wrong' });
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'locked') throw new Error('expected a lock');
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  /**
   * Drives the failure counter up by `times`.
   *
   * The lock is cleared before each attempt because a locked account does not
   * count further failures — the login short-circuits before recording one. A
   * loop without this walks a single tier however many times it runs.
   */
  async function failTimes(times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await harness.db.updateTable('Users').set({ lockedUntil: null }).execute();
      await login({ password: 'wrong' });
    }
  }

  const delayOf = (r: Awaited<ReturnType<typeof login>>) =>
    !r.ok && r.reason === 'locked' ? r.retryAfterSeconds : 0;

  it('grows the delay with each failure', async () => {
    await create();

    await failTimes(4);
    const early = await login({ password: 'wrong' });

    // Four more tiers, not one. `retryAfterSeconds` is a `Math.ceil` over the
    // difference between a Postgres timestamp and the host clock, so a value
    // that should be 1 can read as 2 when the two clocks differ by even a
    // fraction of a millisecond — and comparing two adjacent one-second tiers
    // then compares 2 with 2 about one run in fifty. Separating the tiers by
    // 16× puts the assertion far outside the rounding, which is the difference
    // between testing the backoff and testing the clock.
    await failTimes(4);
    const later = await login({ password: 'wrong' });

    expect(delayOf(early)).toBeGreaterThan(0);
    expect(delayOf(later)).toBeGreaterThanOrEqual(delayOf(early) * 4);
  });

  // A permanent lockout is a denial-of-service against any account whose email
  // an attacker knows. Backoff has to expire.
  it('lets the real owner back in once the delay passes', async () => {
    await create();
    for (let i = 0; i < 5; i++) await login({ password: 'wrong' });

    await sql`UPDATE "Users" SET "lockedUntil" = now() - interval '1 second'`.execute(harness.db);

    expect((await login()).ok).toBe(true);
  });

  it('clears the counter on a successful login', async () => {
    await create();
    await login({ password: 'wrong' });
    await login({ password: 'wrong' });
    await login();

    const row = await harness.db
      .selectFrom('Users')
      .select(['failedLogins', 'lockedUntil'])
      .executeTakeFirstOrThrow();

    expect(row.failedLogins).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });
});

describe('sessions', () => {
  const openSession = async () => {
    await create();
    const result = await login();
    if (!result.ok) throw new Error('login failed');
    return result.session;
  };

  it('authenticates with the token it issued', async () => {
    const session = await openSession();
    const principal = await users.authenticateSession(session.token);

    expect(principal?.type).toBe(PrincipalType.USER);
    expect(principal?.namespaceId).toBe(namespaceId);
  });

  it('stores only a hash of the token', async () => {
    const session = await openSession();
    const row = await harness.db
      .selectFrom('Sessions')
      .select('tokenHash')
      .executeTakeFirstOrThrow();

    expect(row.tokenHash).toBe(hashSessionToken(session.token));
    expect(row.tokenHash).not.toContain(session.token);
  });

  it('refuses a token that was never issued', async () => {
    await openSession();
    expect(await users.authenticateSession('made-up')).toBeUndefined();
  });

  // The whole reason sessions are rows rather than signed tokens.
  it('stops working the instant it is revoked', async () => {
    const session = await openSession();
    await users.revokeSession(session.token);

    expect(await users.authenticateSession(session.token)).toBeUndefined();
  });

  it('expires at its absolute deadline', async () => {
    const session = await openSession();
    await sql`UPDATE "Sessions" SET "expiresAt" = now() - interval '1 second'`.execute(harness.db);

    expect(await users.authenticateSession(session.token)).toBeUndefined();
  });

  // Bounds an abandoned session on a shared machine, separately from the
  // absolute deadline.
  it('expires after being idle', async () => {
    const session = await openSession();
    await sql`UPDATE "Sessions" SET "lastSeenAt" = now() - interval '10 hours'`.execute(
      harness.db
    );

    expect(await users.authenticateSession(session.token)).toBeUndefined();
  });

  it('moves the idle deadline forward on use', async () => {
    const session = await openSession();
    await sql`UPDATE "Sessions" SET "lastSeenAt" = now() - interval '5 minutes'`.execute(
      harness.db
    );

    await users.authenticateSession(session.token);

    const row = await harness.db
      .selectFrom('Sessions')
      .select('lastSeenAt')
      .executeTakeFirstOrThrow();
    expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(60_000);
  });

  // Disabling an account without revoking leaves the person logged in until
  // their session happens to expire — which is not what "disabled" means.
  it('ends every session when the account is disabled', async () => {
    const session = await openSession();
    const [user] = await users.listUsers(namespaceId);

    await users.disableUser(namespaceId, user.id);

    expect(await users.authenticateSession(session.token)).toBeUndefined();
  });

  it('signs out everywhere', async () => {
    await create();
    const first = await login();
    const second = await login();
    if (!first.ok || !second.ok) throw new Error('login failed');

    const [user] = await users.listUsers(namespaceId);
    expect(await users.revokeAllSessions(user.id)).toBe(2);

    expect(await users.authenticateSession(first.session.token)).toBeUndefined();
    expect(await users.authenticateSession(second.session.token)).toBeUndefined();
  });

  it('prunes sessions that can no longer authenticate', async () => {
    await openSession();
    await sql`UPDATE "Sessions" SET "expiresAt" = now() - interval '1 day'`.execute(harness.db);

    expect(await users.pruneExpiredSessions()).toBe(1);
  });
});

describe('changing a password', () => {
  it('requires the current password', async () => {
    const user = await create();

    expect(await users.changePassword(user.id, 'wrong', 'a-brand-new-passphrase')).toBe(false);
    expect((await login()).ok).toBe(true);
  });

  it('replaces the password', async () => {
    const user = await create();
    expect(await users.changePassword(user.id, PASSWORD, 'a-brand-new-passphrase')).toBe(true);

    expect((await login()).ok).toBe(false);
    expect((await login({ password: 'a-brand-new-passphrase' })).ok).toBe(true);
  });

  // Leaving other sessions alive means an attacker keeps their access while the
  // user believes they have just locked them out.
  it('ends every other session', async () => {
    const user = await create();
    const before = await login();
    if (!before.ok) throw new Error('login failed');

    await users.changePassword(user.id, PASSWORD, 'a-brand-new-passphrase');

    expect(await users.authenticateSession(before.session.token)).toBeUndefined();
  });

  it('applies the password policy to the new password', async () => {
    const user = await create();
    await expect(users.changePassword(user.id, PASSWORD, 'short')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('namespace isolation', () => {
  it('allows the same email in two namespaces', async () => {
    await create();
    await expect(
      users.createUser({
        namespaceId: otherNamespaceId,
        email: 'ada@example.com',
        name: 'Ada',
        password: PASSWORD,
      })
    ).resolves.toBeDefined();
  });

  it('rejects a duplicate email within one namespace', async () => {
    await create();
    await expect(create({ email: 'ADA@example.com' })).rejects.toThrow();
  });

  it('will not disable a user in another namespace', async () => {
    const user = await create();
    expect(await users.disableUser(otherNamespaceId, user.id)).toBe(false);
  });

  it('lists only its own namespace', async () => {
    await create();
    await users.createUser({
      namespaceId: otherNamespaceId,
      email: 'grace@example.com',
      name: 'Grace',
      password: PASSWORD,
    });

    expect((await users.listUsers(namespaceId)).map((u) => u.email)).toEqual([
      'ada@example.com',
    ]);
  });
});
