import type { JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, DbTransaction, Queryable } from './database.js';
import { json } from './schema.js';

/**
 * Transactional outbox.
 *
 * Every side effect the engine wants — starting a child workflow, notifying a
 * webhook, indexing an execution — is written here in the *same transaction* as
 * the state change that justified it, and published only after that transaction
 * commits.
 *
 * The alternative, performing side effects inline, fails in both directions: a
 * rollback after an external call has already gone out cannot recall it, and a
 * crash between commit and call loses it silently. The outbox trades those for
 * at-least-once delivery, which consumers handle with an idempotency key.
 */

export interface OutboxEvent {
  id: string;
  namespaceId: string;
  topic: string;
  payload: Record<string, JsonValue>;
  createdAt: Date;
  attempts: number;
}

export interface DeadLetteredEvent extends OutboxEvent {
  lastError: string | null;
  deadLetteredAt: Date;
}

export class OutboxRepository {
  constructor(private readonly db: Db) {}

  /** Queues an event. Must share the transaction with the change it describes. */
  async publish(
    namespaceId: string,
    topic: string,
    payload: Record<string, JsonValue>,
    tx: Queryable
  ): Promise<void> {
    await tx
      .insertInto('OutboxEvents')
      .values({ namespaceId, topic, payload: json(payload) })
      .execute();
  }

  /**
   * Claims a batch for delivery.
   *
   * `SKIP LOCKED` inside the caller's transaction lets several relay processes
   * run without coordination; rows stay locked until the relay commits, so no
   * two relays deliver the same event concurrently.
   *
   * Excludes events that are backing off or dead-lettered, so one failing
   * subscriber cannot crowd the batch and starve every other topic.
   */
  async claimBatch(limit: number, tx: DbTransaction): Promise<OutboxEvent[]> {
    const rows = await tx
      .selectFrom('OutboxEvents')
      .select([
        sql<string>`"id"::text`.as('id'),
        'namespaceId',
        'topic',
        'payload',
        'createdAt',
        'attempts',
      ])
      .where('publishedAt', 'is', null)
      .where('deadLetteredAt', 'is', null)
      .where('nextAttemptAt', '<=', sql<Date>`now()`)
      .orderBy('id')
      .forUpdate()
      .skipLocked()
      .limit(limit)
      .execute();

    return rows as unknown as OutboxEvent[];
  }

  /** Marks events delivered. Same transaction as the claim that produced them. */
  async markPublished(ids: string[], tx: DbTransaction): Promise<void> {
    if (ids.length === 0) return;

    await tx
      .updateTable('OutboxEvents')
      .set({ publishedAt: sql<Date>`now()` })
      .where(sql<boolean>`"id" = ANY(${ids}::bigint[])`)
      .execute();
  }

  /**
   * Records a failed delivery and schedules the next attempt.
   *
   * Backs off exponentially rather than retrying on every pass — a permanently
   * broken handler would otherwise busy-loop on its row, burning a claim slot
   * each time and slowing every other topic.
   */
  async recordFailure(
    id: string,
    error: string,
    attempts: number,
    tx: DbTransaction
  ): Promise<void> {
    const backoffSeconds = Math.min(2 ** attempts, 300);

    await tx
      .updateTable('OutboxEvents')
      .set({
        attempts: attempts + 1,
        lastError: error.slice(0, 2000),
        nextAttemptAt: sql<Date>`now() + make_interval(secs => ${backoffSeconds})`,
      })
      .where(sql<boolean>`"id" = ${id}::bigint`)
      .execute();
  }

  /**
   * Abandons delivery, keeping the event for inspection and replay.
   *
   * The row is never deleted. Silently discarding an undeliverable event is the
   * worst option available: the relay is what starts sub-workflows, so a
   * dropped event leaves a parent waiting forever with nothing to explain it.
   */
  async deadLetter(id: string, reason: string, tx: DbTransaction): Promise<void> {
    await tx
      .updateTable('OutboxEvents')
      .set({ deadLetteredAt: sql<Date>`now()`, lastError: reason.slice(0, 2000) })
      .where(sql<boolean>`"id" = ${id}::bigint`)
      .execute();
  }

  /** Dead-lettered events, for an operator to inspect or replay. */
  async listDeadLettered(limit = 100): Promise<DeadLetteredEvent[]> {
    const rows = await this.db
      .selectFrom('OutboxEvents')
      .select([
        sql<string>`"id"::text`.as('id'),
        'namespaceId',
        'topic',
        'payload',
        'createdAt',
        'attempts',
        'lastError',
        'deadLetteredAt',
      ])
      .where('deadLetteredAt', 'is not', null)
      .orderBy('deadLetteredAt', 'desc')
      .limit(limit)
      .execute();

    return rows as unknown as DeadLetteredEvent[];
  }

  /**
   * Returns dead-lettered events to the queue.
   *
   * The reason a dead letter exists rather than a delete: once the missing
   * handler is deployed or the bug fixed, the work can actually be recovered.
   */
  async replayDeadLettered(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const rows = await this.db
      .updateTable('OutboxEvents')
      .set({
        deadLetteredAt: null,
        attempts: 0,
        lastError: null,
        nextAttemptAt: sql<Date>`now()`,
      })
      .where(sql<boolean>`"id" = ANY(${ids}::bigint[])`)
      .returning('id')
      .execute();

    return rows.length;
  }

  async pendingCount(): Promise<number> {
    const row = await this.db
      .selectFrom('OutboxEvents')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('publishedAt', 'is', null)
      .where('deadLetteredAt', 'is', null)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }

  async deadLetterCount(): Promise<number> {
    const row = await this.db
      .selectFrom('OutboxEvents')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('deadLetteredAt', 'is not', null)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }
}
