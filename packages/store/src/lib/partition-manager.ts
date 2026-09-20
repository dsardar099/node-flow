import { sql } from 'kysely';
import type { Db } from './database.js';
import { UNIQUE_VIOLATION } from './pg-errors.js';

/**
 * Creates partitions ahead of time and drops expired ones.
 *
 * Range partitioning only pays for itself if something maintains it. Without
 * this, every row lands in the `DEFAULT` partition, and that has two costs that
 * both grow with time:
 *
 *  - **Retention becomes impossible.** Dropping a month of history is meant to
 *    be an instant `DROP TABLE`; against a DEFAULT partition it is a `DELETE`
 *    of millions of rows followed by a vacuum.
 *  - **Attaching a real partition later requires a full scan** of DEFAULT, to
 *    prove no row belongs in the new range. The longer it is left, the longer
 *    that scan locks the table.
 *
 * So this is not an optimisation to add when convenient — it gets strictly more
 * expensive to adopt the longer it is deferred.
 */

export type PartitionGranularity = 'hour' | 'month';

interface PartitionedTable {
  table: string;
  granularity: PartitionGranularity;
  /** How long to keep data before the partition is dropped. */
  retentionPeriods: number;
}

/**
 * Timers churn hourly and are worthless once fired; executions and history are
 * kept far longer because they are what an operator goes back to read.
 */
const PARTITIONED_TABLES: PartitionedTable[] = [
  { table: 'Timers', granularity: 'hour', retentionPeriods: 48 },
  { table: 'WorkflowExecutions', granularity: 'month', retentionPeriods: 12 },
  { table: 'WorkflowEvents', granularity: 'month', retentionPeriods: 12 },
  // Audit entries outlive execution history on purpose: the question they
  // answer ("who changed this?") is usually asked long after the executions
  // involved have been pruned. Seven years is the common compliance floor.
  { table: 'AuditEvents', granularity: 'month', retentionPeriods: 84 },
];

/** Postgres error codes this manager expects and handles rather than raises. */
const DUPLICATE_TABLE = '42P07';
const OVERLAPPING_PARTITION = '42P17';
const CHECK_VIOLATION = '23514';
/**
 * Two concurrent `CREATE TABLE`s can collide on the `pg_class` index rather
 * than raising `duplicate_table` — which of the two you get depends on how far
 * each transaction had progressed, so both have to be treated as "someone else
 * got there first". `UNIQUE_VIOLATION` is imported from `pg-errors` above.
 */

/** The range key each partitioned table is keyed on. */
const PARTITION_COLUMN: Record<string, string> = {
  Timers: 'fireAt',
  WorkflowExecutions: 'startedAt',
  WorkflowEvents: 'at',
  AuditEvents: 'at',
};

export interface PartitionMaintenanceResult {
  created: string[];
  dropped: string[];
}

export class PartitionManager {
  constructor(
    private readonly db: Db,
    private readonly tables: PartitionedTable[] = PARTITIONED_TABLES
  ) {}

  /**
   * Ensures partitions exist for the current and upcoming periods.
   *
   * `lookahead` matters more than it appears: if a partition does not exist
   * when a row arrives, the row silently lands in DEFAULT and the retention
   * guarantee is quietly broken for that period. Creating several ahead means a
   * missed maintenance run is harmless rather than permanent.
   */
  async ensureAhead(lookahead = 3): Promise<string[]> {
    const created: string[] = [];

    for (const spec of this.tables) {
      for (let offset = 0; offset <= lookahead; offset++) {
        const name = await this.createPartition(spec, offset);
        if (name) created.push(name);
      }
    }

    return created;
  }

  /**
   * Drops partitions older than the retention window.
   *
   * `DROP TABLE` on a partition is near-instant and leaves nothing to vacuum,
   * which is the entire reason for partitioning by time.
   */
  async dropExpired(): Promise<string[]> {
    const dropped: string[] = [];

    for (const spec of this.tables) {
      const cutoff = this.boundary(spec.granularity, -spec.retentionPeriods);

      const partitions = await sql<{ name: string }>`
        SELECT c.relname AS name
          FROM pg_class c
          JOIN pg_inherits i ON i.inhrelid = c.oid
          JOIN pg_class p ON p.oid = i.inhparent
         WHERE p.relname = ${spec.table}
           AND c.relname <> ${`${spec.table}_default`}
      `.execute(this.db);

      for (const partition of partitions.rows) {
        const start = this.parseSuffix(spec, partition.name);
        if (start && start < cutoff) {
          await sql.raw(`DROP TABLE IF EXISTS "${partition.name}"`).execute(this.db);
          dropped.push(partition.name);
        }
      }
    }

    return dropped;
  }

  /** One maintenance pass: create ahead, then drop expired. */
  async maintain(lookahead = 3): Promise<PartitionMaintenanceResult> {
    return { created: await this.ensureAhead(lookahead), dropped: await this.dropExpired() };
  }

  /**
   * Rows sitting in a DEFAULT partition.
   *
   * Should be zero. Anything here means a row arrived for a period with no
   * partition, and it will not be covered by retention — worth alerting on,
   * because it also blocks attaching a partition for that range later.
   */
  async defaultPartitionRows(): Promise<{ table: string; rows: number }[]> {
    const counts: { table: string; rows: number }[] = [];

    for (const spec of this.tables) {
      const result = await sql
        .raw<{ count: string }>(`SELECT count(*)::text AS count FROM "${spec.table}_default"`)
        .execute(this.db);
      counts.push({ table: spec.table, rows: Number(result.rows[0]?.count ?? 0) });
    }

    return counts;
  }

  private async createPartition(
    spec: PartitionedTable,
    offset: number
  ): Promise<string | undefined> {
    const from = this.boundary(spec.granularity, offset);
    const to = this.boundary(spec.granularity, offset + 1);
    const name = `${spec.table}_${this.suffix(spec.granularity, from)}`;

    const existing = await sql<{ exists: boolean }>`
      SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = ${name}) AS exists
    `.execute(this.db);
    if (existing.rows[0]?.exists) return undefined;

    try {
      // Deliberately not `IF NOT EXISTS`.
      //
      // It looks like the safe spelling and quietly breaks the return value:
      // the losing side of a race no-ops *successfully* and then reports having
      // created the partition, so `ensureAhead` returns more names than
      // partitions it made. Letting the duplicate raise means exactly one
      // caller claims each creation, which is what any count built on this can
      // then rely on.
      await sql
        .raw(
          `CREATE TABLE "${name}" PARTITION OF "${spec.table}"
             FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`
        )
        .execute(this.db);

      return name;
    } catch (error) {
      const code = (error as { code?: string }).code;

      // Another replica created it between the check and the create. Every
      // poller runs this loop, so the race is the normal case, not an edge one.
      if (
        code === DUPLICATE_TABLE ||
        code === OVERLAPPING_PARTITION ||
        code === UNIQUE_VIOLATION
      ) {
        return undefined;
      }

      // The DEFAULT partition already holds rows in this range, so Postgres
      // refuses to create a partition that would orphan them. This is the trap
      // described at the top of the file, and it is not recoverable by
      // retrying — without the move below, the roller fails on this same
      // period forever and every subsequent row keeps landing in DEFAULT.
      if (code === CHECK_VIOLATION) {
        await this.createByRelocating(spec, name, from, to);
        return name;
      }

      throw error;
    }
  }

  /**
   * Creates a partition and moves the rows DEFAULT was holding for its range.
   *
   * Detaching DEFAULT first is what makes this affordable: attaching or
   * creating a partition alongside a populated DEFAULT forces Postgres to scan
   * the whole of it to prove no row belongs in the new range, holding an
   * exclusive lock throughout. Detached, the new partition is created
   * instantly and only the rows actually in range are read.
   *
   * All in one transaction — a crash midway must not leave the table without
   * its DEFAULT partition, which would make every out-of-range insert fail.
   */
  private async createByRelocating(
    spec: PartitionedTable,
    name: string,
    from: Date,
    to: Date
  ): Promise<void> {
    const column = PARTITION_COLUMN[spec.table] ?? 'createdAt';
    const fallback = `${spec.table}_default`;

    await this.db.transaction().execute(async (tx) => {
      const run = (query: string) => sql.raw(query).execute(tx);

      await run(`ALTER TABLE "${spec.table}" DETACH PARTITION "${fallback}"`);
      await run(
        `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${spec.table}"
           FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`
      );
      await run(`
        WITH moved AS (
          DELETE FROM "${fallback}"
           WHERE "${column}" >= '${from.toISOString()}'
             AND "${column}" <  '${to.toISOString()}'
          RETURNING *
        )
        INSERT INTO "${spec.table}" SELECT * FROM moved
      `);
      await run(`ALTER TABLE "${spec.table}" ATTACH PARTITION "${fallback}" DEFAULT`);
    });
  }

  /** Start of the period `offset` periods from the current one. */
  private boundary(granularity: PartitionGranularity, offset: number): Date {
    const now = new Date();
    if (granularity === 'hour') {
      return new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          now.getUTCHours() + offset
        )
      );
    }
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  }

  private suffix(granularity: PartitionGranularity, at: Date): string {
    const y = at.getUTCFullYear();
    const m = String(at.getUTCMonth() + 1).padStart(2, '0');
    if (granularity === 'month') return `${y}${m}`;
    const d = String(at.getUTCDate()).padStart(2, '0');
    const h = String(at.getUTCHours()).padStart(2, '0');
    return `${y}${m}${d}${h}`;
  }

  private parseSuffix(spec: PartitionedTable, partitionName: string): Date | undefined {
    const suffix = partitionName.slice(spec.table.length + 1);

    if (spec.granularity === 'month' && /^\d{6}$/.test(suffix)) {
      return new Date(Date.UTC(Number(suffix.slice(0, 4)), Number(suffix.slice(4, 6)) - 1, 1));
    }
    if (spec.granularity === 'hour' && /^\d{10}$/.test(suffix)) {
      return new Date(
        Date.UTC(
          Number(suffix.slice(0, 4)),
          Number(suffix.slice(4, 6)) - 1,
          Number(suffix.slice(6, 8)),
          Number(suffix.slice(8, 10))
        )
      );
    }
    return undefined;
  }
}
