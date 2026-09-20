import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskContext } from './executor.js';
import { SqlTaskExecutor } from './sql.executor.js';

/**
 * `JDBC`.
 *
 * Against a real database, because the interesting behaviour is the driver's:
 * parameter binding, timeouts, row counts and what an error message contains.
 *
 * The refusal tests are the point of the file. A task that could be pointed at
 * an arbitrary database by a workflow definition would be a way to read every
 * other tenant's data out of node-flow's own Postgres, so "the definition
 * cannot choose the connection" is the property that has to hold.
 */

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

let container: StartedPostgreSqlContainer;
let url: string;

const context = (input: Record<string, JsonValue>): TaskContext => ({
  taskId: 't-1',
  workflowId: 'w-1',
  namespaceId: 'ns-1',
  input,
  state: {},
  signal: new AbortController().signal,
  heartbeat: async () => undefined,
});

const executors: SqlTaskExecutor[] = [];

function executor(options: Record<string, unknown> = {}) {
  const made = new SqlTaskExecutor({
    datasources: { reporting: { url } },
    ...options,
  });
  executors.push(made);
  return made;
}

beforeAll(async () => {
  ensureDockerHost();
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('app')
    .withUsername('app')
    .withPassword('sekrit-password-value')
    .start();

  url = container.getConnectionUri();

  const setup = executor();
  await setup.execute(
    context({
      datasource: 'reporting',
      statement: 'CREATE TABLE orders (id int primary key, customer text, total numeric)',
    })
  );
  await setup.execute(
    context({
      datasource: 'reporting',
      statement: "INSERT INTO orders VALUES (1,'ada',42),(2,'grace',99)",
    })
  );
}, 240_000);

afterAll(async () => {
  await Promise.allSettled(executors.map((e) => e.close()));
  await container?.stop();
}, 60_000);

describe('querying', () => {
  it('has the declared type', () => {
    expect(new SqlTaskExecutor().type).toBe(TaskType.JDBC);
  });

  it('returns rows and a count', async () => {
    const outcome = await executor().execute(
      context({ datasource: 'reporting', statement: 'SELECT id, customer FROM orders ORDER BY id' })
    );

    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.output?.['rowCount']).toBe(2);
    expect(outcome.output?.['rows']).toEqual([
      { id: 1, customer: 'ada' },
      { id: 2, customer: 'grace' },
    ]);
  });

  it('binds parameters positionally', async () => {
    const outcome = await executor().execute(
      context({
        datasource: 'reporting',
        statement: 'SELECT customer FROM orders WHERE id = $1',
        parameters: [2],
      })
    );

    expect(outcome.output?.['rows']).toEqual([{ customer: 'grace' }]);
  });

  /**
   * The injection that binding prevents.
   *
   * The value arrives from task input, which comes from workflow input and
   * upstream output — attacker-influenced wherever workflows are started from
   * external requests. Bound, it is a string that matches nothing. Interpolated,
   * it would drop the table.
   */
  it('treats a hostile parameter as a value, not as SQL', async () => {
    const outcome = await executor().execute(
      context({
        datasource: 'reporting',
        statement: 'SELECT customer FROM orders WHERE customer = $1',
        parameters: ["'; DROP TABLE orders; --"],
      })
    );

    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.output?.['rows']).toEqual([]);

    // Still there.
    const after = await executor().execute(
      context({ datasource: 'reporting', statement: 'SELECT count(*)::int AS n FROM orders' })
    );
    expect((after.output?.['rows'] as { n: number }[])[0].n).toBe(2);
  });

  it('reports rows affected by a write', async () => {
    const outcome = await executor().execute(
      context({
        datasource: 'reporting',
        statement: "INSERT INTO orders VALUES (99,'temp',1) ON CONFLICT DO NOTHING",
      })
    );

    expect(outcome.status).toBe('COMPLETED');
    expect(outcome.output?.['rowCount']).toBe(1);
  });

  // Output is stored, indexed and handed to the next task.
  it('refuses a result larger than its row limit', async () => {
    const outcome = await executor({ maxRows: 1 }).execute(
      context({ datasource: 'reporting', statement: 'SELECT * FROM orders' })
    );

    expect(outcome.status).toBe('FAILED');
    // Permanent: the same query returns the same volume next time.
    expect(outcome).toMatchObject({ terminal: true });
  });

  // Enforced by Postgres, so it also bounds a query stuck inside the database.
  it('gives up on a query that runs too long', async () => {
    const outcome = await executor({ statementTimeoutMs: 250 }).execute(
      context({ datasource: 'reporting', statement: 'SELECT pg_sleep(5)' })
    );

    expect(outcome.status).toBe('FAILED');
    // Transient: a slow query may be slow because of load.
    expect(outcome).toMatchObject({ terminal: false });
  }, 30_000);
});

describe('refusing to be pointed anywhere', () => {
  /**
   * The escalation this design exists to prevent.
   *
   * A definition that could name its own connection could name node-flow's own
   * database and read every namespace's executions and API key hashes.
   */
  it('refuses a connection string supplied by the definition', async () => {
    for (const key of ['url', 'connectionString', 'uri']) {
      const outcome = await executor().execute(
        context({
          datasource: 'reporting',
          [key]: 'postgres://someone@elsewhere/db',
          statement: 'SELECT 1',
        })
      );

      expect(outcome.status, key).toBe('FAILED');
      if (outcome.status === 'FAILED') {
        expect(outcome.reason, key).toContain('does not accept a connection string');
        expect(outcome.terminal, key).toBe(true);
      }
    }
  });

  it('refuses a datasource the operator did not configure', async () => {
    const outcome = await executor().execute(
      context({ datasource: 'engine-internals', statement: 'SELECT 1' })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    if (outcome.status === 'FAILED') expect(outcome.reason).toContain('no datasource');
  });

  it('does nothing at all when the install configures none', async () => {
    const outcome = await new SqlTaskExecutor().execute(
      context({ datasource: 'reporting', statement: 'SELECT 1' })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });

  it('requires a datasource and a statement', async () => {
    expect(
      await executor().execute(context({ statement: 'SELECT 1' }))
    ).toMatchObject({ status: 'FAILED', terminal: true });

    expect(
      await executor().execute(context({ datasource: 'reporting' }))
    ).toMatchObject({ status: 'FAILED', terminal: true });
  });

  it('refuses parameters that are not an array', async () => {
    const outcome = await executor().execute(
      context({
        datasource: 'reporting',
        statement: 'SELECT $1::int',
        parameters: { nope: true },
      })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
  });
});

describe('what an error is allowed to say', () => {
  /**
   * A failure reason is persisted, searchable and rendered in the UI, so a
   * password reaching it outlives the incident somewhere nobody thinks to
   * rotate.
   */
  it('keeps the password out of a driver error', async () => {
    const broken = new SqlTaskExecutor({
      datasources: { reporting: { url: 'postgres://app:sekrit-password-value@127.0.0.1:1/none' } },
    });
    executors.push(broken);

    const outcome = await broken.execute(
      context({ datasource: 'reporting', statement: 'SELECT 1' })
    );

    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') {
      expect(outcome.reason).not.toContain('sekrit-password-value');
    }
  }, 30_000);

  it('still reports a SQL error usefully', async () => {
    const outcome = await executor().execute(
      context({ datasource: 'reporting', statement: 'SELECT * FROM no_such_table' })
    );

    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') expect(outcome.reason).toContain('no_such_table');
  });
});
