import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, Queryable } from './database.js';
import { json } from './schema.js';
import { isUniqueViolation } from './pg-errors.js';

/** What a handler does when a message matches. */
export type EventAction = 'START_WORKFLOW' | 'COMPLETE_TASK' | 'FAIL_TASK';

const ACTIONS: EventAction[] = ['START_WORKFLOW', 'COMPLETE_TASK', 'FAIL_TASK'];

export interface NewEventHandler {
  namespaceId: string;
  name: string;
  description?: string;
  /** A source the operator configured, e.g. `kafka:default`. */
  source: string;
  topic: string;
  condition?: string;
  action: EventAction;
  defName?: string;
  defVersion?: number;
  inputTemplate?: Record<string, JsonValue>;
  correlationId?: string;
  workflowIdExpr?: string;
  taskRefExpr?: string;
  enabled?: boolean;
}

export interface EventHandler {
  id: string;
  namespaceId: string;
  name: string;
  description: string | null;
  source: string;
  topic: string;
  condition: string | null;
  action: EventAction;
  defName: string | null;
  defVersion: number | null;
  inputTemplate: Record<string, JsonValue>;
  correlationId: string | null;
  workflowIdExpr: string | null;
  taskRefExpr: string | null;
  enabled: boolean;
  eventCount: number;
  lastEventAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class EventHandlerRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewEventHandler): Promise<EventHandler> {
    assertCoherent(input);

    const row = await this.db
      .insertInto('EventHandlers')
      .values({
        namespaceId: input.namespaceId,
        name: input.name,
        description: input.description ?? null,
        source: input.source,
        topic: input.topic,
        condition: input.condition ?? null,
        action: input.action,
        defName: input.defName ?? null,
        defVersion: input.defVersion ?? null,
        inputTemplate: json(input.inputTemplate ?? {}),
        correlationId: input.correlationId ?? null,
        workflowIdExpr: input.workflowIdExpr ?? null,
        taskRefExpr: input.taskRefExpr ?? null,
        enabled: input.enabled ?? true,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new NodeFlowError(
            ErrorCode.CONFLICT,
            `an event handler named "${input.name}" already exists`
          );
        }
        throw error;
      });

    return toHandler(row);
  }

  /**
   * Every enabled handler for one source and topic, across all namespaces.
   *
   * Not namespaced, because a message arrives before anyone knows whose it is —
   * the handler row is what assigns it to a namespace. That is also why a
   * handler must only ever be created by someone who already holds credentials
   * for the namespace it names.
   */
  async forTopic(source: string, topic: string, namespaceId?: string): Promise<EventHandler[]> {
    let query = this.db
      .selectFrom('EventHandlers')
      .selectAll()
      .where('source', '=', source)
      .where('topic', '=', topic)
      .where('enabled', '=', true);
    // Webhooks belong to a namespace, unlike a shared broker topic: their
    // requests must never reach a handler in another namespace that happens to
    // name the same topic.
    if (namespaceId) query = query.where('namespaceId', '=', namespaceId);
    const rows = await query.execute();

    return rows.map(toHandler);
  }

  /** Every topic a source must subscribe to. Drives what the consumer opens. */
  async topicsFor(source: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('EventHandlers')
      .select('topic')
      .distinct()
      .where('source', '=', source)
      .where('enabled', '=', true)
      .execute();

    return rows.map((row) => row.topic);
  }

  async list(namespaceId: string): Promise<EventHandler[]> {
    const rows = await this.db
      .selectFrom('EventHandlers')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .orderBy('name', 'asc')
      .execute();

    return rows.map(toHandler);
  }

  async findByName(namespaceId: string, name: string): Promise<EventHandler | undefined> {
    const row = await this.db
      .selectFrom('EventHandlers')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();

    return row ? toHandler(row) : undefined;
  }

  /**
   * Replaces a handler's settings, keeping its name and delivery counters.
   *
   * The same coherence rules as creation: an edit must not be the way to save
   * a `COMPLETE_TASK` handler that cannot say which task it completes.
   */
  async update(
    namespaceId: string,
    name: string,
    input: Omit<NewEventHandler, 'namespaceId' | 'name'>
  ): Promise<EventHandler> {
    assertCoherent({ ...input, namespaceId, name });

    const row = await this.db
      .updateTable('EventHandlers')
      .set({
        description: input.description ?? null,
        source: input.source,
        topic: input.topic,
        condition: input.condition ?? null,
        action: input.action,
        defName: input.defName ?? null,
        defVersion: input.defVersion ?? null,
        inputTemplate: json(input.inputTemplate ?? {}),
        correlationId: input.correlationId ?? null,
        workflowIdExpr: input.workflowIdExpr ?? null,
        taskRefExpr: input.taskRefExpr ?? null,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        // The error described the old settings.
        lastError: null,
        updatedAt: sql<Date>`now()`,
      })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returningAll()
      .executeTakeFirst();

    if (!row) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no event handler "${name}"`);
    return toHandler(row);
  }

  async setEnabled(namespaceId: string, name: string, enabled: boolean): Promise<EventHandler> {
    const row = await this.db
      .updateTable('EventHandlers')
      .set({ enabled, updatedAt: sql<Date>`now()` })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returningAll()
      .executeTakeFirst();

    if (!row) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no event handler "${name}"`);
    return toHandler(row);
  }

  async delete(namespaceId: string, name: string): Promise<boolean> {
    const rows = await this.db
      .deleteFrom('EventHandlers')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returning('id')
      .execute();

    return rows.length > 0;
  }

  /** Records that a handler saw a message. Best-effort bookkeeping. */
  async recordDelivery(id: string, error: string | undefined, tx?: Queryable): Promise<void> {
    await (tx ?? this.db)
      .updateTable('EventHandlers')
      .set({
        eventCount: sql<string>`"eventCount" + 1`,
        lastEventAt: sql<Date>`now()`,
        lastError: error ?? null,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .execute();
  }
}

/**
 * Rejects a handler that cannot do what it says.
 *
 * At creation rather than at delivery: a handler missing the workflow it is
 * supposed to start would otherwise look healthy until the first message
 * arrived, and then fail once per message with nobody watching.
 */
function assertCoherent(input: NewEventHandler): void {
  if (!ACTIONS.includes(input.action)) {
    throw new InvalidArgumentError(`action must be one of ${ACTIONS.join(', ')}`);
  }

  if (input.action === 'START_WORKFLOW' && !input.defName) {
    throw new InvalidArgumentError('START_WORKFLOW needs a workflow name');
  }

  if (input.action !== 'START_WORKFLOW') {
    if (!input.workflowIdExpr || !input.taskRefExpr) {
      throw new InvalidArgumentError(
        `${input.action} needs "workflowIdExpr" and "taskRefExpr" to say which task the message is about`
      );
    }
  }
}


function toHandler(row: Record<string, unknown>): EventHandler {
  return {
    ...(row as unknown as EventHandler),
    action: row['action'] as EventAction,
    inputTemplate: (row['inputTemplate'] ?? {}) as Record<string, JsonValue>,
    eventCount: Number(row['eventCount'] ?? 0),
  };
}
