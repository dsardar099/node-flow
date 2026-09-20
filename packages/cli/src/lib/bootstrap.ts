import { Scope, isValidScope } from '@node-flow-dev/core';
import {
  IdentityRepository,
  UserRepository,
  assertDatabaseCapabilities,
  createDatabase,
  migrate,
  type Db,
} from '@node-flow-dev/store';

/**
 * Creates the first namespace and the first credential.
 *
 * This exists because the API cannot do it. Every write endpoint requires a
 * principal, a principal comes from a credential, and a credential belongs to a
 * namespace — so a fresh database has no way in through the front door. Some
 * out-of-band step has to break that cycle.
 *
 * The alternatives were worse. A bootstrap token in the environment is a
 * standing credential that outlives its purpose and is forgotten in a config
 * file; auto-creating a default namespace with a known key ships every install
 * with the same credential, which is the single most reliably exploited
 * misconfiguration in self-hosted software. Requiring a deliberate local
 * command means the secret exists only once, on the operator's terminal.
 *
 * It connects directly to Postgres rather than to the API, which is the honest
 * shape of the operation: it is a database bootstrap, not an API call.
 */

export interface BootstrapOptions {
  databaseUrl: string;
  namespace: string;
  /** Name for the credential, so it is identifiable in an audit trail later. */
  keyName?: string;
  scopes?: string[];
  /** Run pending migrations first. On by default: a fresh database has none. */
  migrate?: boolean;
}

export interface BootstrapResult {
  namespaceId: string;
  namespaceCreated: boolean;
  migrationsApplied: string[];
  apiKeyId: string;
  /** Returned once. Never recoverable. */
  token: string;
}

export async function bootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  // `platform:admin` alongside `admin`, because this is the credential an
  // operator uses to stand the install up: `admin` runs the first namespace,
  // and creating the *second* one needs a scope `admin` deliberately does not
  // satisfy. Without it the namespace API would be unreachable on a fresh
  // install and the only way to add a tenant would be SQL — the exact gap this
  // closes.
  const scopes = options.scopes ?? [Scope.ADMIN, Scope.PLATFORM_ADMIN];
  const invalid = scopes.filter((scope) => !isValidScope(scope));
  if (invalid.length > 0) {
    throw new Error(`invalid scope(s): ${invalid.join(', ')}`);
  }

  const db = createDatabase({ url: options.databaseUrl, maxConnections: 2 });

  try {
    await assertDatabaseCapabilities(db);

    const migrationsApplied = options.migrate === false ? [] : await migrate(db);
    const { namespaceId, created } = await ensureNamespace(db, options.namespace);

    const issued = await new IdentityRepository(db).createApiKey({
      namespaceId,
      name: options.keyName ?? 'bootstrap',
      scopes,
    });

    return {
      namespaceId,
      namespaceCreated: created,
      migrationsApplied,
      apiKeyId: issued.id,
      token: issued.token,
    };
  } finally {
    await db.destroy();
  }
}

/**
 * Creates the namespace, or returns the existing one.
 *
 * Idempotent on the namespace but **not** on the credential: running bootstrap
 * twice issues a second key rather than failing. That is deliberate — the first
 * key is unrecoverable by design, so "I lost it" is the common reason to run
 * this again, and refusing would leave the operator locked out of their own
 * install with no path back that does not involve SQL.
 */
async function ensureNamespace(
  db: Db,
  slug: string
): Promise<{ namespaceId: string; created: boolean }> {
  const existing = await db
    .selectFrom('Namespaces')
    .select('id')
    .where('slug', '=', slug)
    .executeTakeFirst();

  if (existing) return { namespaceId: existing.id, created: false };

  const inserted = await db
    .insertInto('Namespaces')
    .values({ slug })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { namespaceId: inserted.id, created: true };
}

export interface CreateUserOptions {
  databaseUrl: string;
  namespace: string;
  email: string;
  name: string;
  password: string;
  scopes?: string[];
}

/**
 * Creates the first human account.
 *
 * The same chicken-and-egg as `bootstrap`, one layer up: creating a user needs
 * an `admin` credential, and the first admin is a person who cannot yet log in.
 * An operator at a terminal breaks the cycle.
 *
 * The password is taken as an argument rather than generated, because unlike a
 * machine secret a person has to be able to receive and then change it. It is
 * still held to the full policy — a bootstrap account is the most privileged
 * one in the install, and "temporary" passwords are the ones that survive
 * longest.
 */
export async function createUser(
  options: CreateUserOptions
): Promise<{ id: string; namespaceId: string }> {
  const db = createDatabase({ url: options.databaseUrl, maxConnections: 2 });

  try {
    const namespace = await db
      .selectFrom('Namespaces')
      .select('id')
      .where('slug', '=', options.namespace)
      .executeTakeFirst();

    if (!namespace) {
      throw new Error(`no namespace "${options.namespace}" — run \`nf bootstrap\` first`);
    }

    const created = await new UserRepository(db).createUser({
      namespaceId: namespace.id,
      email: options.email,
      name: options.name,
      password: options.password,
      scopes: options.scopes ?? [Scope.ADMIN],
    });

    return { id: created.id, namespaceId: namespace.id };
  } finally {
    await db.destroy();
  }
}
