import { ErrorCode, InvalidArgumentError, maskFields, NodeFlowError, WorkflowStatus, type JsonValue } from '@node-flow-dev/core';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { BrokerSink } from './brokers.js';
import type { Db, Queryable } from './database.js';
import type { KafkaProducer } from './kafka-sink.js';
import type { OutboxHandler } from './outbox-relay.js';
import type { OutboxEvent } from './outbox.repository.js';
import { isUniqueViolation } from './pg-errors.js';
import { json } from './schema.js';
import type { SecretRepository } from './secret.repository.js';

/**
 * Status listeners — change data capture for workflow executions.
 *
 * A listener says which executions it wants (workflow names, lifecycle events)
 * and where they go: a signed webhook or a Kafka topic. When an execution
 * changes state, one outbox row is written per matching listener **in the
 * transaction that changed it** — so an event is never sent for a change that
 * rolled back, never lost to a crash between the two, and a sink that is down
 * backs off and dead-letters on its own without delaying any other listener.
 *
 * Delivery is at-least-once. Every event carries a stable `id` for the receiver
 * to deduplicate on, and webhook deliveries are signed over timestamp and body.
 */

export const STATUS_LISTENER_TOPIC = 'status-listener';

export const STATUS_EVENTS = ['STARTED', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'TERMINATED', 'PAUSED', 'RESUMED', 'RESTARTED'] as const;
export type StatusEvent = (typeof STATUS_EVENTS)[number];

export const STATUS_SINKS = ['WEBHOOK', 'KAFKA', 'NATS', 'AMQP', 'SQS'] as const;
export type StatusSink = (typeof STATUS_SINKS)[number];

export interface WebhookSinkConfig {
  url: string;
  /** A secret whose value signs each delivery. */
  secretName?: string;
  headers?: Record<string, string>;
}

export interface KafkaSinkConfig {
  cluster: string;
  topic: string;
}

/** A NATS subject, an AMQP queue or `exchange/routingKey`, or an SQS queue name, on a configured connection. */
export interface BrokerSinkConfig {
  connection: string;
  destination: string;
}

export interface StatusListenerDefinition {
  name: string;
  description?: string;
  enabled?: boolean;
  workflowNames?: string[];
  events?: StatusEvent[];
  sink: StatusSink;
  config: WebhookSinkConfig | KafkaSinkConfig | BrokerSinkConfig;
  includeOutput?: boolean;
}

export interface StatusListener extends Required<Omit<StatusListenerDefinition, 'description'>> {
  id: string;
  namespaceId: string;
  description: string | null;
  deliveredCount: number;
  failedCount: number;
  lastDeliveredAt: Date | null;
  lastFailedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What a sink receives. */
export interface StatusChangeEvent {
  [key: string]: JsonValue;
  id: string;
  type: 'workflow.status';
  event: StatusEvent;
  status: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  correlationId: string | null;
  parentWorkflowId: string | null;
  reason: string | null;
  at: string;
}

/** A change as the workflow repository reports it. */
export interface StatusChange {
  workflowId: string;
  event: StatusEvent;
  reason?: string;
  output?: Record<string, JsonValue>;
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;
/** Output bigger than this is left out of the event; the receiver can fetch it. */
const MAX_OUTPUT_BYTES = 256_000;
const CACHE_MS = 5_000;

export class StatusListenerRepository {
  /** Enabled listeners per namespace, so a change in a namespace with none costs one map lookup. */
  private readonly cache = new Map<string, { at: number; listeners: StatusListener[] }>();

  constructor(private readonly db: Db) {}

  async create(namespaceId: string, definition: StatusListenerDefinition): Promise<StatusListener> {
    const clean = validate(definition);
    const row = await this.db
      .insertInto('StatusListeners')
      .values({ namespaceId, ...toColumns(clean) })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new NodeFlowError(ErrorCode.CONFLICT, `a status listener named "${definition.name}" already exists`);
        }
        throw error;
      });
    this.cache.delete(namespaceId);
    return toListener(row);
  }

  async update(namespaceId: string, name: string, definition: Omit<StatusListenerDefinition, 'name'>): Promise<StatusListener> {
    const clean = validate({ ...definition, name });
    const row = await this.db
      .updateTable('StatusListeners')
      .set({ ...toColumns(clean), lastError: null, updatedAt: sql<Date>`now()` })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no status listener "${name}"`);
    this.cache.delete(namespaceId);
    return toListener(row);
  }

  async list(namespaceId: string): Promise<StatusListener[]> {
    const rows = await this.db.selectFrom('StatusListeners').selectAll().where('namespaceId', '=', namespaceId).orderBy('name').execute();
    return rows.map(toListener);
  }

  async get(namespaceId: string, name: string): Promise<StatusListener | undefined> {
    const row = await this.db
      .selectFrom('StatusListeners')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();
    return row ? toListener(row) : undefined;
  }

  async findById(id: string): Promise<StatusListener | undefined> {
    const row = await this.db.selectFrom('StatusListeners').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toListener(row) : undefined;
  }

  async delete(namespaceId: string, name: string): Promise<boolean> {
    const result = await this.db.deleteFrom('StatusListeners').where('namespaceId', '=', namespaceId).where('name', '=', name).executeTakeFirst();
    this.cache.delete(namespaceId);
    return Number(result.numDeletedRows) > 0;
  }

  /**
   * Writes one outbox row per listener that wants this change.
   *
   * Called by the workflow repository wherever an execution's status changes,
   * with the transaction that changed it. The listener set is cached for a few
   * seconds per process, which bounds how long a newly created listener can
   * miss events on another replica.
   */
  async onStatusChange(change: StatusChange, tx: Queryable): Promise<void> {
    const workflow = await tx
      .selectFrom('WorkflowExecutions')
      .select(['namespaceId', 'defName', 'defVersion', 'status', 'correlationId', 'parentWorkflowId'])
      .where('id', '=', change.workflowId)
      .executeTakeFirst();
    if (!workflow) return;

    const listeners = (await this.enabledIn(workflow.namespaceId, tx)).filter(
      (listener) =>
        (listener.events.length === 0 || listener.events.includes(change.event)) &&
        (listener.workflowNames.length === 0 || listener.workflowNames.some((pattern) => matchesName(pattern, workflow.defName)))
    );
    if (listeners.length === 0) return;

    const event: StatusChangeEvent = {
      id: randomUUID(),
      type: 'workflow.status',
      event: change.event,
      status: workflow.status,
      workflowId: change.workflowId,
      workflowName: workflow.defName,
      workflowVersion: workflow.defVersion,
      correlationId: workflow.correlationId ?? null,
      parentWorkflowId: workflow.parentWorkflowId ?? null,
      reason: change.reason ?? null,
      at: new Date().toISOString(),
    };
    const output = change.output === undefined ? undefined : JSON.stringify(change.output).length > MAX_OUTPUT_BYTES ? null : change.output;

    await tx
      .insertInto('OutboxEvents')
      .values(
        listeners.map((listener) => ({
          namespaceId: workflow.namespaceId,
          topic: STATUS_LISTENER_TOPIC,
          payload: json({
            listenerId: listener.id,
            // The same id for every listener: it identifies the change, not the delivery.
            event: listener.includeOutput && output !== undefined ? { ...event, output, ...(output === null ? { outputOmitted: true } : {}) } : event,
          }),
        }))
      )
      .execute();
  }

  async recordDelivery(id: string, error?: string): Promise<void> {
    await this.db
      .updateTable('StatusListeners')
      .set(
        error === undefined
          ? { deliveredCount: sql<string>`"deliveredCount" + 1`, lastDeliveredAt: sql<Date>`now()`, lastError: null }
          : { failedCount: sql<string>`"failedCount" + 1`, lastFailedAt: sql<Date>`now()`, lastError: error.slice(0, 1000) }
      )
      .where('id', '=', id)
      .execute();
  }

  private async enabledIn(namespaceId: string, tx: Queryable): Promise<StatusListener[]> {
    const hit = this.cache.get(namespaceId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.listeners;
    const rows = await tx.selectFrom('StatusListeners').selectAll().where('namespaceId', '=', namespaceId).where('enabled', '=', true).execute();
    const listeners = rows.map(toListener);
    this.cache.set(namespaceId, { at: Date.now(), listeners });
    return listeners;
  }
}

/** Sends one event to one listener's sink; throws when the sink did not accept it. */
export type StatusSinkSender = (listener: StatusListener, event: Record<string, JsonValue>) => Promise<void>;

export interface StatusSinkDependencies {
  secrets?: Pick<SecretRepository, 'resolve'>;
  /** Kafka producers by configured cluster name. */
  kafka?: Map<string, KafkaProducer>;
  /** NATS, AMQP and SQS publishers by sink prefix, `nats:<connection>:`. */
  brokers?: Map<string, Pick<BrokerSink, 'send'>>;
  /** Delivers a signed webhook; given the url, body and secret. Throws on failure. */
  webhook: (request: { url: string; event: Record<string, JsonValue>; secret?: string; headers?: Record<string, string>; deliveryId: string }) => Promise<void>;
}

export function statusSinkSender(deps: StatusSinkDependencies): StatusSinkSender {
  return async (listener, event) => {
    if (listener.sink === 'KAFKA') {
      const config = listener.config as KafkaSinkConfig;
      const producer = deps.kafka?.get(config.cluster);
      if (!producer) throw new Error(`no Kafka cluster "${config.cluster}" is configured on this server`);
      await producer.send({
        topic: config.topic,
        // Keyed by execution, so one execution's changes stay in order on one partition.
        key: String(event['workflowId'] ?? ''),
        value: event,
        headers: { 'x-nodeflow-event-id': String(event['id'] ?? '') },
      });
      return;
    }

    if (listener.sink !== 'WEBHOOK') {
      const kind = listener.sink.toLowerCase();
      const config = listener.config as BrokerSinkConfig;
      const broker = deps.brokers?.get(`${kind}:${config.connection}:`);
      if (!broker) throw new Error(`no ${listener.sink} connection "${config.connection}" is configured on this server`);
      const id = String(event['id'] ?? randomUUID());
      await broker.send(config.destination, JSON.stringify(event), id, String(event['workflowId'] ?? ''));
      return;
    }

    const config = listener.config as WebhookSinkConfig;
    let secret: string | undefined;
    if (config.secretName) {
      if (!deps.secrets) throw new Error('a signing secret is configured but secrets are unavailable');
      const value = (await deps.secrets.resolve(listener.namespaceId, [config.secretName]))[config.secretName];
      if (value === undefined) throw new Error(`secret "${config.secretName}" does not exist`);
      secret = typeof value === 'string' ? value : JSON.stringify(value);
    }
    await deps.webhook({ url: config.url, event, secret, headers: config.headers, deliveryId: String(event['id'] ?? randomUUID()) });
  };
}

/**
 * The relay handler for `status-listener` rows.
 *
 * A listener deleted or disabled since the change was recorded is skipped
 * rather than failed: its owner turned it off, and retrying ten times before
 * dead-lettering would only fill the dead letter with events nobody wants.
 */
export function statusListenerHandler(
  listeners: StatusListenerRepository,
  send: StatusSinkSender,
  maskedFieldsFor?: (namespaceId: string, name: string, version: number) => Promise<string[] | undefined>
): OutboxHandler {
  return async (outboxEvent: OutboxEvent) => {
    const listenerId = outboxEvent.payload['listenerId'];
    let event = outboxEvent.payload['event'] as Record<string, JsonValue> | undefined;
    if (typeof listenerId !== 'string' || !event) throw new Error(`outbox event ${outboxEvent.id} is not a status change`);

    const listener = await listeners.findById(listenerId);
    if (!listener || !listener.enabled) return;

    if (event['output'] && typeof event['output'] === 'object' && maskedFieldsFor) {
      const masked = await maskedFieldsFor(listener.namespaceId, String(event['workflowName']), Number(event['workflowVersion']));
      if (masked?.length) event = { ...event, output: maskFields(event['output'], new Set(masked)) };
    }

    try {
      await send(listener, event);
    } catch (error) {
      await listeners.recordDelivery(listener.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
    await listeners.recordDelivery(listener.id);
  };
}

/** A made-up change, for checking a sink before relying on it. */
export function sampleStatusEvent(listener: StatusListener): StatusChangeEvent {
  return {
    id: randomUUID(),
    type: 'workflow.status',
    event: 'COMPLETED',
    status: WorkflowStatus.COMPLETED,
    workflowId: '00000000-0000-0000-0000-000000000000',
    workflowName: listener.workflowNames.find((name) => !name.endsWith('*')) ?? 'example_workflow',
    workflowVersion: 1,
    correlationId: null,
    parentWorkflowId: null,
    reason: null,
    at: new Date().toISOString(),
    test: true,
  };
}

function matchesName(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

function validate(definition: StatusListenerDefinition): StatusListenerDefinition {
  if (!NAME.test(definition.name)) {
    throw new InvalidArgumentError('a listener name is lowercase letters, digits, ".", "_" or "-", up to 100 characters');
  }
  if (!STATUS_SINKS.includes(definition.sink)) throw new InvalidArgumentError(`sink must be one of ${STATUS_SINKS.join(', ')}`);
  for (const event of definition.events ?? []) {
    if (!STATUS_EVENTS.includes(event)) throw new InvalidArgumentError(`"${event}" is not a status event; use ${STATUS_EVENTS.join(', ')}`);
  }
  const workflowNames = [...new Set((definition.workflowNames ?? []).map((name) => name.trim()).filter(Boolean))];

  if (definition.sink === 'WEBHOOK') {
    const config = definition.config as Partial<WebhookSinkConfig>;
    let url: URL;
    try {
      url = new URL(String(config.url ?? ''));
    } catch {
      throw new InvalidArgumentError('a webhook sink needs a valid "url"');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new InvalidArgumentError('a webhook url must be http or https');
    const headers = Object.fromEntries(Object.entries(config.headers ?? {}).filter(([, value]) => typeof value === 'string'));
    return {
      ...definition,
      workflowNames,
      config: { url: url.toString(), ...(config.secretName ? { secretName: config.secretName } : {}), ...(Object.keys(headers).length ? { headers } : {}) },
    };
  }

  if (definition.sink !== 'KAFKA') {
    const config = definition.config as Partial<BrokerSinkConfig>;
    const connection = String(config.connection ?? '').trim();
    const destination = String(config.destination ?? '').trim();
    if (!connection || !destination) {
      throw new InvalidArgumentError(`a ${definition.sink} sink needs a "connection" and a "destination"`);
    }
    return { ...definition, workflowNames, config: { connection, destination } };
  }

  const config = definition.config as Partial<KafkaSinkConfig>;
  if (!config.cluster || !config.topic) throw new InvalidArgumentError('a Kafka sink needs a "cluster" and a "topic"');
  return { ...definition, workflowNames, config: { cluster: config.cluster, topic: config.topic } };
}

function toColumns(definition: StatusListenerDefinition) {
  return {
    name: definition.name,
    description: definition.description ?? null,
    enabled: definition.enabled ?? true,
    workflowNames: definition.workflowNames ?? [],
    events: definition.events ?? [],
    sink: definition.sink,
    config: json(definition.config as unknown as Record<string, JsonValue>),
    includeOutput: definition.includeOutput ?? false,
  };
}

function toListener(row: Record<string, unknown>): StatusListener {
  return {
    id: row['id'] as string,
    namespaceId: row['namespaceId'] as string,
    name: row['name'] as string,
    description: (row['description'] as string | null) ?? null,
    enabled: row['enabled'] as boolean,
    workflowNames: (row['workflowNames'] as string[]) ?? [],
    events: (row['events'] as StatusEvent[]) ?? [],
    sink: row['sink'] as StatusSink,
    config: (row['config'] as WebhookSinkConfig | KafkaSinkConfig) ?? {},
    includeOutput: row['includeOutput'] as boolean,
    deliveredCount: Number(row['deliveredCount'] ?? 0),
    failedCount: Number(row['failedCount'] ?? 0),
    lastDeliveredAt: (row['lastDeliveredAt'] as Date | null) ?? null,
    lastFailedAt: (row['lastFailedAt'] as Date | null) ?? null,
    lastError: (row['lastError'] as string | null) ?? null,
    createdAt: row['createdAt'] as Date,
    updatedAt: row['updatedAt'] as Date,
  };
}
