import type { JsonValue } from '@node-flow-dev/core';
import type { Db } from './database.js';
import { OutboxRepository, type OutboxEvent } from './outbox.repository.js';

/**
 * Publishes outbox events after the transaction that produced them commits.
 *
 * This is the half of the transactional outbox that actually does something.
 * Writing events is useless without a relay — `StartSubWorkflow` reaches the
 * outbox and, until now, nothing consumed it, so sub-workflows were recorded
 * but never ran.
 *
 * Delivery is **at-least-once**. The claim, the handler and the mark-published
 * share one transaction, so a crash mid-delivery rolls back the mark and the
 * event is redelivered. Handlers must therefore be idempotent — which is why
 * `StartWorkflow` carries an idempotency key derived from the task identity.
 *
 * **Nothing is ever silently dropped.** An earlier version marked an event with
 * no registered handler as delivered, to stop the outbox growing without bound.
 * That conflated two very different situations: a topic nobody will ever
 * consume, and a handler that is not registered *yet* — a deploy ordering
 * problem, a crashed module, a config typo. In the second case the event is
 * lost, and since this relay is what starts sub-workflows, the result is a
 * parent workflow hanging forever with no evidence anywhere.
 *
 * Undeliverable events therefore back off, and past a limit move to the dead
 * letter, where they stay inspectable and replayable. The outbox still does not
 * grow unboundedly — dead-lettered rows leave the deliverable index — but
 * recovering the work remains possible once the missing handler ships.
 */

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export interface RelayResult {
  delivered: number;
  failed: number;
  deadLettered: number;
}

export interface OutboxRelayOptions {
  /**
   * Attempts before an event is dead-lettered.
   *
   * Generous by default: the common cause of an early failure is a handler that
   * has not finished registering, and giving up after one or two passes would
   * turn a slow boot into lost work.
   */
  maxAttempts?: number;
}

export class OutboxRelay {
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private readonly prefixHandlers = new Map<string, OutboxHandler[]>();
  private readonly maxAttempts: number;

  constructor(
    private readonly db: Db,
    private readonly outbox: OutboxRepository,
    options: OutboxRelayOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? 10;
  }

  /** Subscribes a handler to a topic. Several handlers may share one topic. */
  on(topic: string, handler: OutboxHandler): this {
    const existing = this.handlers.get(topic) ?? [];
    existing.push(handler);
    this.handlers.set(topic, existing);
    return this;
  }

  /**
   * Subscribes a handler to every topic starting with `prefix` — `nats:default:`
   * for any subject on that connection. Exact subscriptions win; among prefixes
   * the longest does.
   */
  onPrefix(prefix: string, handler: OutboxHandler): this {
    const existing = this.prefixHandlers.get(prefix) ?? [];
    existing.push(handler);
    this.prefixHandlers.set(prefix, existing);
    return this;
  }

  private handlersFor(topic: string): OutboxHandler[] {
    const exact = this.handlers.get(topic);
    if (exact?.length) return exact;
    let best: string | undefined;
    for (const prefix of this.prefixHandlers.keys()) {
      if (topic.startsWith(prefix) && topic.length > prefix.length && (!best || prefix.length > best.length)) best = prefix;
    }
    return best ? (this.prefixHandlers.get(best) ?? []) : [];
  }

  /**
   * Delivers one batch.
   *
   * A handler that throws leaves its event unpublished for the next pass rather
   * than failing the whole batch — one broken subscriber must not stall every
   * other topic. Repeated failures are visible as a growing pending count.
   */
  async relay(limit = 100): Promise<RelayResult> {
    return this.db.transaction().execute(async (tx) => {
      const batch = await this.outbox.claimBatch(limit, tx);
      if (batch.length === 0) return { delivered: 0, failed: 0, deadLettered: 0 };

      const delivered: string[] = [];
      let failed = 0;
      let deadLettered = 0;

      for (const event of batch) {
        const handlers = this.handlersFor(event.topic);

        // No handler is treated as a failure, not a success. It is usually
        // temporary — a module still starting — and the backoff gives it time
        // to appear. Only after maxAttempts is the event abandoned, and even
        // then it is kept rather than discarded.
        const outcome =
          handlers.length === 0
            ? { ok: false, error: `no handler registered for topic "${event.topic}"` }
            : await runHandlers(handlers, event);

        if (outcome.ok) {
          delivered.push(event.id);
          continue;
        }

        if (event.attempts + 1 >= this.maxAttempts) {
          await this.outbox.deadLetter(
            event.id,
            `${outcome.error} (abandoned after ${event.attempts + 1} attempts)`,
            tx
          );
          deadLettered++;
        } else {
          // One broken subscriber must not stall every other topic, so the
          // failure is recorded per-event rather than failing the batch.
          await this.outbox.recordFailure(event.id, outcome.error, event.attempts, tx);
          failed++;
        }
      }

      await this.outbox.markPublished(delivered, tx);
      return { delivered: delivered.length, failed, deadLettered };
    });
  }
}

async function runHandlers(
  handlers: OutboxHandler[],
  event: OutboxEvent
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    for (const handler of handlers) await handler(event);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Payload of a `subworkflow.start` event. */
export interface SubWorkflowStartPayload {
  parentWorkflowId: string;
  parentTaskRefName: string;
  /** Absent on events written before retries started their own child. */
  parentTaskAttempt?: number;
  defName: string;
  defVersion: number | null;
  input: Record<string, JsonValue>;
  /** The parent's routing merged with the task's own; absent on events from before it existed. */
  taskToDomain?: Record<string, string> | null;
}

/** Payload of a fire-and-forget `workflow.start` event. */
export interface WorkflowStartPayload {
  defName: string;
  defVersion: number | null;
  input: Record<string, JsonValue>;
  idempotencyKey: string | null;
  correlationId?: string | null;
}
