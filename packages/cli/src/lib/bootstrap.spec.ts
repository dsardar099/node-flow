import { Scope, hasScope, type Principal } from '@node-flow-dev/core';
import { IdentityRepository, createDatabase, type Db } from '@node-flow-dev/store';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { optionalList, parseArgs, requireString } from './args.js';
import { bootstrap } from './bootstrap.js';

/**
 * `nf bootstrap`.
 *
 * This is the only way into a fresh install, so the things worth proving are
 * that it works against an *empty* database — no schema, no namespace — and
 * that the credential it prints actually authenticates.
 */

let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let db: Db;

function ensureDockerHost(): void {
  if (process.env['DOCKER_HOST']) return;
  const home = homedir();
  const socket = [
    '/var/run/docker.sock',
    join(home, '.orbstack/run/docker.sock'),
    join(home, '.colima/default/docker.sock'),
    join(home, '.docker/run/docker.sock'),
    join(home, '.rd/docker.sock'),
  ].find((path) => existsSync(path));
  if (!socket) return;
  process.env['DOCKER_HOST'] = `unix://${socket}`;
  process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] ??= socket;
}

beforeAll(async () => {
  ensureDockerHost();
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('nodeflow_cli')
    .withUsername('nodeflow')
    .withPassword('nodeflow')
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off'])
    .start();

  databaseUrl = container.getConnectionUri();
  db = createDatabase({ url: databaseUrl });
}, 240_000);

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
}, 60_000);

let slug = 0;
const nextSlug = () => `tenant-${++slug}`;

describe('bootstrap', () => {
  // The whole point: a database with no schema at all.
  it('migrates an empty database and issues a working key', async () => {
    const namespace = nextSlug();
    const result = await bootstrap({ databaseUrl, namespace });

    expect(result.migrationsApplied.length).toBeGreaterThan(0);
    expect(result.namespaceCreated).toBe(true);

    const principal = await new IdentityRepository(db).authenticateApiKey(result.token);
    expect(principal).toBeDefined();
    expect(principal?.namespaceId).toBe(result.namespaceId);
    expect(hasScope(principal as Principal, Scope.ADMIN)).toBe(true);
  });

  it('applies no migrations the second time', async () => {
    const result = await bootstrap({ databaseUrl, namespace: nextSlug() });
    expect(result.migrationsApplied).toEqual([]);
  });

  it('reuses an existing namespace rather than failing', async () => {
    const namespace = nextSlug();
    const first = await bootstrap({ databaseUrl, namespace });
    const second = await bootstrap({ databaseUrl, namespace });

    expect(second.namespaceCreated).toBe(false);
    expect(second.namespaceId).toBe(first.namespaceId);
  });

  // The first key is unrecoverable by design, so "I lost it" is the common
  // reason to run this again. Refusing would lock an operator out of their own
  // install with no path back that does not involve SQL.
  it('issues a second key on a rerun instead of refusing', async () => {
    const namespace = nextSlug();
    const first = await bootstrap({ databaseUrl, namespace });
    const second = await bootstrap({ databaseUrl, namespace, keyName: 'recovery' });

    expect(second.token).not.toBe(first.token);

    const identity = new IdentityRepository(db);
    expect(await identity.authenticateApiKey(first.token)).toBeDefined();
    expect(await identity.authenticateApiKey(second.token)).toBeDefined();
  });

  it('grants only the scopes asked for', async () => {
    const result = await bootstrap({
      databaseUrl,
      namespace: nextSlug(),
      scopes: [Scope.EXECUTIONS_READ],
    });

    const principal = await new IdentityRepository(db).authenticateApiKey(result.token);
    expect(principal).toBeDefined();
    expect(hasScope(principal as Principal, Scope.EXECUTIONS_READ)).toBe(true);
    expect(hasScope(principal as Principal, Scope.ADMIN)).toBe(false);
  });

  it('rejects an unsatisfiable scope before touching the database', async () => {
    await expect(
      bootstrap({ databaseUrl, namespace: nextSlug(), scopes: ['NOT A SCOPE'] })
    ).rejects.toThrow(/invalid scope/);
  });

  it('reports a database it cannot reach', async () => {
    await expect(
      bootstrap({
        databaseUrl: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
        namespace: 'x',
      })
    ).rejects.toThrow();
  });
});

describe('argument parsing', () => {
  it('accepts --key value and --key=value alike', () => {
    expect(parseArgs(['bootstrap', '--namespace', 'acme']).flags['namespace']).toBe('acme');
    expect(parseArgs(['bootstrap', '--namespace=acme']).flags['namespace']).toBe('acme');
  });

  it('treats a flag with no value as a boolean', () => {
    const { flags } = parseArgs(['bootstrap', '--json', '--namespace', 'acme']);
    expect(flags['json']).toBe(true);
    expect(flags['namespace']).toBe('acme');
  });

  it('does not swallow the next flag as a value', () => {
    const { flags } = parseArgs(['bootstrap', '--no-migrate', '--namespace', 'acme']);
    expect(flags['no-migrate']).toBe(true);
    expect(flags['namespace']).toBe('acme');
  });

  it('reads the command and positionals', () => {
    const parsed = parseArgs(['migrate', 'extra']);
    expect(parsed.command).toBe('migrate');
    expect(parsed.positional).toEqual(['extra']);
  });

  it('names the flag that was missing', () => {
    expect(() => requireString({}, 'namespace')).toThrow('--namespace is required');
  });

  it('falls back to an environment default', () => {
    expect(requireString({}, 'database-url', 'postgres://x')).toBe('postgres://x');
  });

  it('rejects an empty fallback rather than accepting it', () => {
    expect(() => requireString({}, 'database-url', '')).toThrow(/required/);
  });

  it('splits a comma list and drops blanks', () => {
    expect(optionalList({ scopes: 'admin, executions:read ,' }, 'scopes')).toEqual([
      'admin',
      'executions:read',
    ]);
  });

  it('returns undefined for an absent list, not an empty one', () => {
    // The distinction matters: absent means "use the default scopes", while an
    // empty list would mean "grant nothing".
    expect(optionalList({}, 'scopes')).toBeUndefined();
  });
});
