import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'kysely';
import { createDatabase, migrate, type Db } from '../database.js';

/**
 * A real Postgres 18 for integration tests.
 *
 * No mocks and no in-memory substitute: everything worth testing here —
 * `SKIP LOCKED` under contention, partial indexes, partition routing, `uuidv7()`
 * — is behaviour of the actual database. A fake would only test the fake.
 */

export interface PostgresHarness {
  db: Db;
  /** Connection string, for anything needing its own connection — the notifier. */
  url: string;
  stop: () => Promise<void>;
}

/**
 * Points Testcontainers at whichever Docker runtime is actually installed.
 *
 * Testcontainers probes `/var/run/docker.sock`, which OrbStack, Colima and
 * Rancher Desktop do not create — they each use their own path under $HOME. On
 * those setups it fails with "Could not find a working container runtime
 * strategy" even though `docker` works fine from the shell, which is a
 * genuinely confusing first-contributor experience.
 *
 * Detecting the socket here means `nx test store` works on a fresh clone with
 * any common runtime, rather than requiring everyone to export DOCKER_HOST.
 */
function ensureDockerHost(): void {
  if (process.env['DOCKER_HOST']) return;

  const home = homedir();
  const candidates = [
    '/var/run/docker.sock',
    join(home, '.orbstack/run/docker.sock'),
    join(home, '.colima/default/docker.sock'),
    join(home, '.docker/run/docker.sock'),
    join(home, '.rd/docker.sock'),
  ];

  const socket = candidates.find((path) => existsSync(path));
  if (!socket) return; // Let Testcontainers report its own, clearer error.

  process.env['DOCKER_HOST'] = `unix://${socket}`;
  // Ryuk, the reaper container, mounts the socket by path from inside Docker,
  // so it needs the real location too — not just the client connection string.
  process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] ??= socket;
}

export async function startPostgresHarness(options: { image?: string } = {}): Promise<PostgresHarness> {
  ensureDockerHost();

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(options.image ?? 'postgres:18-alpine')
    .withDatabase('nodeflow_test')
    .withUsername('nodeflow')
    .withPassword('nodeflow')
    // Tests assert on lease expiry within seconds, so keep autovacuum lively
    // enough that churn on the queue tables does not skew timings.
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
      '-c',
      'autovacuum_naptime=5s',
    ])
    .start();

  const url = container.getConnectionUri();
  const db = createDatabase({ url, maxConnections: 25 });
  await migrate(db);

  return {
    db,
    url,
    stop: async () => {
      await db.destroy();
      await container.stop();
    },
  };
}

/** Empties every table between tests without paying to recreate the schema. */
export async function truncateAll(db: Db): Promise<void> {
  await sql`
    TRUNCATE "IdempotencyKeys", "TaskQueues", "DecideQueues", "TaskExecutions", "WorkflowExecutions",
             "Timers", "OutboxEvents", "WorkflowEvents", "SemaphoreHolders",
             "Semaphores", "WorkflowDefinitions", "TaskDefinitions",
             "ApiKeys", "ServiceAccounts", "RateLimitBuckets",
             "Sessions", "Users", "WebhookCallbacks", "Namespaces"
    RESTART IDENTITY CASCADE
  `.execute(db);
}

/** Inserts a namespace and returns its id. */
export async function seedNamespace(db: Db, slug = 'default'): Promise<string> {
  const row = await db
    .insertInto('Namespaces')
    .values({ slug })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}
