import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedFirstInstall } from './seed.js';
import { UserRepository } from './user.repository.js';
import { startPostgresHarness, truncateAll, type PostgresHarness } from './testing/postgres-harness.js';

/**
 * The seed replaced two manual CLI commands, so the properties that make it
 * safe to run unattended on every boot are the ones worth testing: that it acts
 * exactly once in the life of a database, and that it never produces a
 * credential anyone could predict from the source.
 */

let harness: PostgresHarness;

beforeAll(async () => {
  harness = await startPostgresHarness();
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
});

describe('seedFirstInstall', () => {
  it('creates a namespace and a working administrator on an empty database', async () => {
    const result = await seedFirstInstall(harness.db, {
      namespace: 'default',
      email: 'admin@example.com',
    });

    expect(result.seeded).toBe(true);
    expect(result.namespaceId).toBeTruthy();

    const namespaces = await harness.db.selectFrom('Namespaces').select('slug').execute();
    expect(namespaces.map((n) => n.slug)).toEqual(['default']);

    // The account must actually log in. Creating a row that cannot would pass a
    // shallower test and leave the install unusable in exactly the way this
    // whole change set out to fix.
    const session = await new UserRepository(harness.db).login({
      namespaceId: result.namespaceId as string,
      email: 'admin@example.com',
      password: result.generatedPassword as string,
    });
    // `.ok`, not merely truthy: a refusal is also an object, so `toBeTruthy`
    // here passed for a rejected login too — the exact shape of assertion this
    // codebase has been bitten by.
    expect(session.ok).toBe(true);

    // And it refuses the wrong password, so the assertion above is about this
    // account rather than about `login` answering at all.
    const refused = await new UserRepository(harness.db).login({
      namespaceId: result.namespaceId as string,
      email: 'admin@example.com',
      password: 'not-the-generated-password',
    });
    expect(refused.ok).toBe(false);
  });

  /**
   * The property that makes it safe to leave on. Were this to regress, a
   * running install would be handed a brand-new administrator on each restart.
   */
  it('does nothing when any namespace already exists', async () => {
    await harness.db.insertInto('Namespaces').values({ slug: 'acme' }).execute();

    const result = await seedFirstInstall(harness.db, {
      namespace: 'default',
      email: 'admin@example.com',
    });

    expect(result.seeded).toBe(false);
    expect(result.generatedPassword).toBeUndefined();

    const slugs = await harness.db.selectFrom('Namespaces').select('slug').execute();
    expect(slugs.map((s) => s.slug)).toEqual(['acme']);

    // And no account either: a namespace it did not create is an install it
    // must not quietly add an administrator to.
    const users = await harness.db.selectFrom('Users').select('id').execute();
    expect(users).toHaveLength(0);
  });

  /**
   * Two installs must never share a credential. A fixed default password is the
   * failure this guards against, and it is the kind that reads as fine.
   */
  it('generates a different password each time', async () => {
    const first = await seedFirstInstall(harness.db, {
      namespace: 'default',
      email: 'admin@example.com',
    });

    await truncateAll(harness.db);

    const second = await seedFirstInstall(harness.db, {
      namespace: 'default',
      email: 'admin@example.com',
    });

    expect(first.generatedPassword).toBeTruthy();
    expect(first.generatedPassword).not.toEqual(second.generatedPassword);
    // 20 bytes as base64url: short enough to copy out of a log, long enough
    // that guessing is not a strategy.
    expect((first.generatedPassword as string).length).toBeGreaterThanOrEqual(26);
  });

  it('uses a supplied password and does not echo it back', async () => {
    const result = await seedFirstInstall(harness.db, {
      namespace: 'default',
      email: 'admin@example.com',
      password: 'a-development-password',
    });

    expect(result.seeded).toBe(true);
    // Nothing to log, because the operator already has it; repeating a known
    // secret into a log file only spreads it.
    expect(result.generatedPassword).toBeUndefined();

    const session = await new UserRepository(harness.db).login({
      namespaceId: result.namespaceId as string,
      email: 'admin@example.com',
      password: 'a-development-password',
    });
    expect(session.ok).toBe(true);
  });

  /**
   * The seeded administrator has to be able to create the *second* namespace
   * from the dashboard, which needs a scope `admin` deliberately excludes.
   * Getting this wrong reproduces the gap that made the CLI mandatory.
   */
  it('grants platform:admin as well as admin', async () => {
    await seedFirstInstall(harness.db, { namespace: 'default', email: 'admin@example.com' });

    const user = await harness.db.selectFrom('Users').select('scopes').executeTakeFirstOrThrow();
    expect(user.scopes).toContain('admin');
    expect(user.scopes).toContain('platform:admin');
  });
});
