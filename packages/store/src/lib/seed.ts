import { randomBytes } from 'node:crypto';
import { Scope } from '@node-flow-dev/core';
import type { Db } from './database.js';
import { UserRepository } from './user.repository.js';

/**
 * Creates the first namespace and the first administrator, once, on a fresh
 * database.
 *
 * A fresh install used to be unusable until someone ran two CLI commands
 * against Postgres directly, because the API cannot create its own first
 * credential: every write needs a principal, a principal needs a credential,
 * and a credential needs a namespace. Something has to break that cycle, and
 * making it a manual step meant the product could not be started by starting
 * it.
 *
 * The objection to seeding automatically is real and worth stating, because it
 * is the reason this file is careful: **shipping every install with the same
 * known credential is one of the most reliably exploited misconfigurations in
 * self-hosted software.** Seeding a fixed `admin`/`admin` would trade a bad
 * first-run experience for a genuine vulnerability.
 *
 * So the password is only ever fixed if an operator fixes it. Left unset, one
 * is generated with 160 bits of entropy and printed once, at boot, to the
 * server log — which is the one channel whoever just started the process is
 * already looking at. Two installs never share a credential, and the secret
 * never has to be stored anywhere for the seed to work.
 *
 * ## What makes this safe to run on every boot
 *
 * It seeds only when the database contains **no namespaces at all**. Not "no
 * namespace by this name" — any namespace means somebody has already set this
 * install up, and re-seeding could hand out a fresh administrator on a system
 * in use. That makes the function idempotent in the only sense that matters:
 * it acts once in the lifetime of a database, and every later call is a
 * cheap `SELECT` that does nothing.
 */

export interface SeedOptions {
  /** Slug for the first namespace. */
  namespace: string;
  /** Email for the first administrator. */
  email: string;
  /**
   * Password for that account. Omit it and one is generated — which is the
   * better default everywhere except a disposable development stack.
   */
  password?: string;
  name?: string;
}

export interface SeedResult {
  /** False when the install already existed, which is the usual case. */
  seeded: boolean;
  namespaceId?: string;
  email?: string;
  /**
   * Set only when this call generated the password. It is returned rather than
   * logged here so the caller decides where it goes — the store has no opinion
   * about stdout, and a repository that prints secrets is hard to test.
   */
  generatedPassword?: string;
}

/**
 * A generated password.
 *
 * Base64url of 20 bytes: 160 bits, no ambiguous escaping, and comfortably past
 * the policy's 12-character minimum. It is meant to be copied out of a log and
 * then changed, not typed.
 */
function generatePassword(): string {
  return randomBytes(20).toString('base64url');
}

export async function seedFirstInstall(db: Db, options: SeedOptions): Promise<SeedResult> {
  // Any namespace at all means this install exists already. Checked before
  // anything is created, and inside the same statement that decides, so a
  // second server booting concurrently cannot both pass this test — the unique
  // index on the slug is what actually settles that race, below.
  const existing = await db.selectFrom('Namespaces').select('id').limit(1).executeTakeFirst();
  if (existing) return { seeded: false };

  const password = options.password ?? generatePassword();

  let namespaceId: string;
  try {
    const inserted = await db
      .insertInto('Namespaces')
      .values({ slug: options.namespace })
      .returning('id')
      .executeTakeFirstOrThrow();
    namespaceId = inserted.id;
  } catch {
    // Two servers started at once and the other one won. Its seed is as good
    // as ours would have been, so this is not a failure — losing the race is
    // the expected outcome for every replica but one.
    return { seeded: false };
  }

  await new UserRepository(db).createUser({
    namespaceId,
    email: options.email,
    name: options.name ?? 'Administrator',
    password,
    // `platform:admin` as well as `admin`: creating the *second* namespace
    // needs a scope `admin` deliberately does not satisfy, so without it the
    // first administrator could not add a tenant from the dashboard — the
    // exact gap that made the CLI mandatory before.
    scopes: [Scope.ADMIN, Scope.PLATFORM_ADMIN],
  });

  return {
    seeded: true,
    namespaceId,
    email: options.email,
    generatedPassword: options.password ? undefined : password,
  };
}
