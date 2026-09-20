import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { Pool, type PoolConfig } from 'pg';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';

/**
 * `JDBC` — runs a statement against a relational database.
 *
 * ## The connection string never comes from the workflow
 *
 * This is the single most important decision in the file, and it is the one
 * most likely to be "simplified" later by someone adding a `url` input because
 * it seems convenient.
 *
 * A workflow definition is user input. If it could name the database to connect
 * to, then whoever can register a workflow could:
 *
 *  - **point it at node-flow's own database** and read every namespace's
 *    executions, secrets and API key hashes, or forge task rows directly —
 *    total escalation past every check in the rest of the system;
 *  - reach any host the server can reach, which is the SSRF problem again
 *    except that here the blanket defence used by `HTTP` does not work: an
 *    internal address is not a red flag for a database, it is the normal case;
 *  - carry credentials in a definition that is stored, versioned, listed over
 *    the API and shown in the UI.
 *
 * So datasources are **named and configured by the operator**, and a workflow
 * may only reference one by name. The operator decides what is reachable; the
 * workflow author decides nothing about connectivity. An install that never
 * lists its own engine database cannot have a workflow reach it.
 *
 * ## Parameters are bound, never interpolated
 *
 * The statement comes from the definition, but the values come from task input,
 * which is derived from workflow input and upstream task output — attacker
 * influenced in any system that starts workflows from external requests. The
 * executor therefore offers no way to build a statement from values: bound
 * parameters are the only channel, so the injection has nowhere to go.
 */

export interface SqlDatasource {
  /** Connection string, from operator configuration. Never from a definition. */
  url: string;
  /** Caps concurrent connections this install will open to that database. */
  maxConnections?: number;
}

export interface SqlExecutorOptions {
  /** Datasources a workflow may name, by name. Empty disables the task. */
  datasources?: Record<string, SqlDatasource>;
  /** Bounds a runaway query. Enforced by the database, not by us. */
  statementTimeoutMs?: number;
  /** Bounds the result, which is stored, indexed and passed to the next task. */
  maxRows?: number;
}

const DEFAULTS = {
  statementTimeoutMs: 30_000,
  maxRows: 1_000,
  maxConnections: 4,
};

export class SqlTaskExecutor implements TaskExecutor {
  readonly type = TaskType.JDBC;
  private readonly pools = new Map<string, Pool>();
  private readonly datasources: Record<string, SqlDatasource>;
  private readonly statementTimeoutMs: number;
  private readonly maxRows: number;

  constructor(options: SqlExecutorOptions = {}) {
    this.datasources = options.datasources ?? {};
    this.statementTimeoutMs = options.statementTimeoutMs ?? DEFAULTS.statementTimeoutMs;
    this.maxRows = options.maxRows ?? DEFAULTS.maxRows;
  }

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const name = context.input['datasource'];
    if (typeof name !== 'string' || name === '') {
      return {
        status: 'FAILED',
        reason: 'JDBC requires a "datasource" naming one configured on the server',
        terminal: true,
      };
    }

    // A URL in the definition is refused outright rather than ignored, because
    // the author clearly expected it to be used and silently connecting
    // somewhere else would be worse than saying no.
    if (context.input['url'] ?? context.input['connectionString'] ?? context.input['uri']) {
      return {
        status: 'FAILED',
        reason:
          'JDBC does not accept a connection string from a workflow definition; ' +
          'reference a datasource configured on the server by name instead',
        terminal: true,
      };
    }

    const datasource = this.datasources[name];
    if (!datasource) {
      const known = Object.keys(this.datasources);
      return {
        status: 'FAILED',
        reason: known.length
          ? `no datasource "${name}" is configured; available: ${known.join(', ')}`
          : `no datasource "${name}" is configured, and this install has none`,
        terminal: true,
      };
    }

    const statement = context.input['statement'] ?? context.input['sql'];
    if (typeof statement !== 'string' || statement.trim() === '') {
      return { status: 'FAILED', reason: 'JDBC requires a "statement"', terminal: true };
    }

    const parameters = context.input['parameters'];
    if (parameters !== undefined && !Array.isArray(parameters)) {
      return {
        status: 'FAILED',
        reason: '"parameters" must be an array, bound positionally as $1, $2, …',
        terminal: true,
      };
    }

    try {
      return await this.run(name, datasource, statement, (parameters ?? []) as JsonValue[]);
    } catch (error) {
      return {
        status: 'FAILED',
        // Redacted: a driver error can echo the connection string, and a task's
        // reason is stored, searchable and shown in the UI.
        reason: redact(error, datasource.url),
        // Transient by default. A syntax error will fail again, but so will a
        // deadlock or a failover, and the retry policy is the right place to
        // decide rather than guessing from a driver message.
        terminal: false,
      };
    }
  }

  private async run(
    name: string,
    datasource: SqlDatasource,
    statement: string,
    parameters: JsonValue[]
  ): Promise<TaskOutcome> {
    const pool = this.poolFor(name, datasource);
    const client = await pool.connect();

    try {
      // Enforced by Postgres, so it also bounds a query stuck *inside* the
      // database rather than in transit — which a client-side timer cannot do
      // anything about, because the query keeps running and keeps holding the
      // connection regardless of who stopped waiting.
      //
      // `SET`, not `SET LOCAL`. `SET LOCAL` only applies within an explicit
      // transaction and is silently a no-op outside one, so the first version
      // of this read as though it enforced a timeout and enforced nothing:
      // `pg_sleep(5)` sailed past a 250 ms limit. Session scope is safe here
      // because it is re-set before every statement on the connection.
      await client.query(`SET statement_timeout = ${this.statementTimeoutMs}`);

      const result = await client.query(statement, parameters);

      const rows = (result.rows ?? []) as Record<string, JsonValue>[];
      if (rows.length > this.maxRows) {
        return {
          status: 'FAILED',
          reason: `query returned ${rows.length} rows, over the ${this.maxRows}-row limit`,
          // Permanent: the same query returns the same volume next time. Add a
          // LIMIT rather than burning the retry budget.
          terminal: true,
        };
      }

      return {
        status: 'COMPLETED',
        output: {
          rows: rows as unknown as JsonValue,
          rowCount: result.rowCount ?? rows.length,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * One pool per datasource, built on first use.
   *
   * Pooled because a workflow step that opens and closes a connection per task
   * is the classic way to exhaust a database's connection limit under load —
   * and capped for the same reason, since this process is one of many.
   */
  private poolFor(name: string, datasource: SqlDatasource): Pool {
    const existing = this.pools.get(name);
    if (existing) return existing;

    const config: PoolConfig = {
      connectionString: datasource.url,
      max: datasource.maxConnections ?? DEFAULTS.maxConnections,
      // A pool that never closes idle connections holds them open against a
      // database that may have far more clients than this one.
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };

    const pool = new Pool(config);
    // Without a listener, an idle client erroring — a failover, a restart —
    // is an unhandled 'error' event, which takes the process down.
    pool.on('error', () => undefined);

    this.pools.set(name, pool);
    return pool;
  }

  /** Closes every pool. For shutdown. */
  async close(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.allSettled(pools.map((pool) => pool.end()));
  }
}

/**
 * Strips anything resembling the connection string out of an error.
 *
 * `pg` includes the host and, in some failure modes, the whole URL. A task's
 * failure reason is persisted, indexed and rendered in the UI, so a password
 * reaching it outlives the incident in a place nobody thinks to rotate.
 */
function redact(error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!url) return message;

  let cleaned = message.split(url).join('[datasource]');

  // Also the credentials on their own: a driver may report `user@host` without
  // the rest of the URL around it.
  try {
    const parsed = new URL(url);
    if (parsed.password) cleaned = cleaned.split(parsed.password).join('[redacted]');
  } catch {
    // Not a parseable URL — the whole-string replacement above is all there is.
  }

  return cleaned;
}
