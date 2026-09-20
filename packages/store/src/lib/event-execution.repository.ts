import type { JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import { json, type EventOutcome } from './schema.js';

/**
 * The event monitor's record: what each handler did with each message.
 *
 * Written best-effort after the handler acted — losing a monitor row must never
 * turn a delivered message into a failed one — and pruned on a window, since
 * this answers "why didn't my handler fire?", not "what happened in March?".
 */

export interface EventExecution {
  id: string;
  handlerName: string;
  action: string;
  source: string;
  topic: string;
  messageKey: string | null;
  deliveryId: string;
  payload: Record<string, JsonValue>;
  outcome: EventOutcome;
  workflowId: string | null;
  detail: string | null;
  at: Date;
}

export interface RecordEventExecution {
  namespaceId: string;
  handlerName: string;
  action: string;
  source: string;
  topic: string;
  messageKey?: string | null;
  deliveryId: string;
  payload: Record<string, JsonValue>;
  outcome: EventOutcome;
  workflowId?: string;
  detail?: string;
}

export interface EventHandlerActivity {
  handlerName: string;
  acted: number;
  skipped: number;
  failed: number;
  lastAt: Date;
}

/** Larger payloads are summarised: the monitor is for diagnosis, and the table is not blob storage. */
export const MAX_MONITOR_PAYLOAD_BYTES = 32 * 1024;

export class EventExecutionRepository {
  constructor(private readonly db: Db) {}

  async record(entry: RecordEventExecution): Promise<void> {
    const serialised = JSON.stringify(entry.payload ?? {});
    const bytes = Buffer.byteLength(serialised);
    const payload =
      bytes > MAX_MONITOR_PAYLOAD_BYTES ? { _truncated: true, sizeBytes: bytes } : (entry.payload ?? {});

    await this.db
      .insertInto('EventExecutions')
      .values({
        namespaceId: entry.namespaceId,
        handlerName: entry.handlerName,
        action: entry.action,
        source: entry.source,
        topic: entry.topic,
        messageKey: entry.messageKey ?? null,
        deliveryId: entry.deliveryId,
        payload: json(payload),
        outcome: entry.outcome,
        workflowId: entry.workflowId ?? null,
        detail: entry.detail?.slice(0, 2000) ?? null,
      })
      .execute();
  }

  /** Newest first. `before` is the id of the last row of the previous page. */
  async list(
    namespaceId: string,
    options: { handlerName?: string; outcome?: EventOutcome; before?: string; limit?: number } = {}
  ): Promise<{ executions: EventExecution[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    let query = this.db
      .selectFrom('EventExecutions')
      .select([
        'id',
        'handlerName',
        'action',
        'source',
        'topic',
        'messageKey',
        'deliveryId',
        'payload',
        'outcome',
        'workflowId',
        'detail',
        'at',
      ])
      .where('namespaceId', '=', namespaceId)
      .orderBy('id', 'desc')
      .limit(limit + 1);

    if (options.handlerName) query = query.where('handlerName', '=', options.handlerName);
    if (options.outcome) query = query.where('outcome', '=', options.outcome);
    // uuidv7 ids sort by time, so the id is a stable cursor even for rows sharing a timestamp.
    if (options.before) query = query.where('id', '<', options.before);

    const rows = await query.execute();
    const page = rows.slice(0, limit);
    return {
      executions: page.map((row) => ({ ...row, payload: row.payload as Record<string, JsonValue> })),
      nextCursor: rows.length > limit ? page[page.length - 1]?.id : undefined,
    };
  }

  /** Per-handler outcome counts over the last `hours`. */
  async activity(namespaceId: string, hours = 24): Promise<EventHandlerActivity[]> {
    const result = await sql<{ handlerName: string; acted: string; skipped: string; failed: string; lastAt: Date }>`
      SELECT "handlerName",
             count(*) FILTER (WHERE outcome = 'ACTED')   AS acted,
             count(*) FILTER (WHERE outcome = 'SKIPPED') AS skipped,
             count(*) FILTER (WHERE outcome = 'FAILED')  AS failed,
             max(at) AS "lastAt"
      FROM "EventExecutions"
      WHERE "namespaceId" = ${namespaceId} AND at > now() - make_interval(hours => ${hours})
      GROUP BY "handlerName"
      ORDER BY max(at) DESC
    `.execute(this.db);

    return result.rows.map((row) => ({
      handlerName: row.handlerName,
      acted: Number(row.acted),
      skipped: Number(row.skipped),
      failed: Number(row.failed),
      lastAt: row.lastAt,
    }));
  }

  /** Deletes rows older than the retention window, a bounded batch at a time. */
  async prune(retentionDays = 7, limit = 5000): Promise<number> {
    const result = await sql`
      DELETE FROM "EventExecutions" WHERE id IN (
        SELECT id FROM "EventExecutions" WHERE at < now() - make_interval(days => ${retentionDays}) LIMIT ${limit}
      )
    `.execute(this.db);
    return Number(result.numAffectedRows ?? 0);
  }
}
