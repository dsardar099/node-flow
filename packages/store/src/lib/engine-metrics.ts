import { sql } from 'kysely';
import type { Db } from './database.js';

/**
 * The numbers worth alerting on.
 *
 * These are chosen rather than collected: queue depth, decider lag, timer
 * backlog and outbox backlog are the leading indicators of essentially every
 * incident this system can have, and each one moves *before* users notice
 * anything. Task throughput and completion counts are lagging indicators —
 * useful for capacity, useless for paging someone.
 *
 * Deliberately **not** labelled per queue. Queue names come from user-chosen
 * task names, so a busy install has thousands; a per-queue gauge would create a
 * time series per queue per namespace and turn the metrics endpoint into the
 * most expensive thing in the deployment. Per-namespace totals answer "is
 * anything backing up", and the API answers "which queue" when someone asks.
 */

export interface EngineGauges {
  /** Workflows waiting to be evaluated. The single best measure of decider lag. */
  decideQueueDepth: number;
  /**
   * How long the oldest pending evaluation has been waiting, in seconds.
   *
   * Depth alone is ambiguous — a thousand entries drained in a second is
   * healthy, ten entries stuck for an hour is not. Age distinguishes them.
   */
  decideQueueOldestSeconds: number;
  /** Tasks queued and visible, across all queues in the install. */
  tasksReady: number;
  /** Tasks leased by a worker right now. */
  tasksLeased: number;
  /** Tasks waiting out a retry backoff — invisible in both counts above. */
  tasksDelayed: number;
  /** Timers due but not yet fired. Non-zero and rising means the sweeper is behind. */
  timersOverdue: number;
  outboxPending: number;
  outboxDeadLettered: number;
  /** Live executions. */
  workflowsRunning: number;
}

export class EngineMetrics {
  private cached?: { at: number; gauges: EngineGauges };

  constructor(
    private readonly db: Db,
    /**
     * How long a reading may be reused.
     *
     * Every gauge here is a query, and Prometheus scrapes on a fixed interval
     * from every replica — so an uncached endpoint multiplies that load by the
     * replica count against the same database the engine is trying to use. A
     * few seconds of staleness is invisible at any sane scrape interval.
     */
    private readonly cacheMs = 5_000
  ) {}

  async gauges(): Promise<EngineGauges> {
    if (this.cached && Date.now() - this.cached.at < this.cacheMs) return this.cached.gauges;

    const gauges = await this.collect();
    this.cached = { at: Date.now(), gauges };
    return gauges;
  }

  /**
   * One round trip, not nine.
   *
   * Each count is cheap on its own, but issuing them separately means nine
   * round trips per scrape per replica. Scalar subqueries let the database do
   * it in one, and none of them needs to be consistent with the others.
   */
  private async collect(): Promise<EngineGauges> {
    const result = await sql<{
      decideDepth: string;
      decideOldest: string;
      ready: string;
      leased: string;
      delayed: string;
      timersOverdue: string;
      outboxPending: string;
      outboxDead: string;
      running: string;
    }>`
      SELECT
        (SELECT count(*) FROM "DecideQueues")::text AS "decideDepth",
        (SELECT coalesce(extract(epoch FROM now() - min("enqueuedAt")), 0)
           FROM "DecideQueues")::text AS "decideOldest",
        (SELECT count(*) FROM "TaskQueues"
          WHERE "leaseExpiresAt" IS NULL AND "visibleAt" <= now())::text AS "ready",
        (SELECT count(*) FROM "TaskQueues"
          WHERE "leaseExpiresAt" IS NOT NULL)::text AS "leased",
        (SELECT count(*) FROM "TaskQueues"
          WHERE "leaseExpiresAt" IS NULL AND "visibleAt" > now())::text AS "delayed",
        (SELECT count(*) FROM "Timers"
          WHERE "claimedAt" IS NULL AND "fireAt" <= now())::text AS "timersOverdue",
        (SELECT count(*) FROM "OutboxEvents"
          WHERE "publishedAt" IS NULL AND "deadLetteredAt" IS NULL)::text AS "outboxPending",
        (SELECT count(*) FROM "OutboxEvents"
          WHERE "deadLetteredAt" IS NOT NULL)::text AS "outboxDead",
        (SELECT count(*) FROM "WorkflowExecutions"
          WHERE "status" IN ('RUNNING', 'PAUSED'))::text AS "running"
    `.execute(this.db);

    const row = result.rows[0];

    return {
      decideQueueDepth: Number(row?.decideDepth ?? 0),
      decideQueueOldestSeconds: Math.round(Number(row?.decideOldest ?? 0)),
      tasksReady: Number(row?.ready ?? 0),
      tasksLeased: Number(row?.leased ?? 0),
      tasksDelayed: Number(row?.delayed ?? 0),
      timersOverdue: Number(row?.timersOverdue ?? 0),
      outboxPending: Number(row?.outboxPending ?? 0),
      outboxDeadLettered: Number(row?.outboxDead ?? 0),
      workflowsRunning: Number(row?.running ?? 0),
    };
  }
}
