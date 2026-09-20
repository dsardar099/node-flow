import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Db } from './database.js';
import type { DispatchResult, EventDispatcher } from './event-dispatcher.js';
import { json } from './schema.js';
import { isUniqueViolation } from './pg-errors.js';
import type { SecretRepository } from './secret.repository.js';
import {
  WEBHOOK_VERIFIERS,
  deliveryIdOf,
  verifyWebhook,
  type WebhookVerifier,
  type WebhookVerifierConfig,
} from './webhook-verifiers.js';

/**
 * Named inbound webhooks: verify, then hand the request to event handlers.
 *
 * The source every webhook dispatches as. Handlers subscribe with
 * `source: "webhook"` and the webhook's name as `topic`, and only handlers in
 * the webhook's own namespace ever see its requests.
 */
export const WEBHOOK_SOURCE = 'webhook';

export interface IncomingWebhook {
  id: string;
  namespaceId: string;
  name: string;
  description: string | null;
  verifier: WebhookVerifier;
  config: WebhookVerifierConfig;
  secretName: string | null;
  enabled: boolean;
  receivedCount: number;
  rejectedCount: number;
  lastReceivedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDefinition {
  name: string;
  description?: string;
  verifier: WebhookVerifier;
  config?: WebhookVerifierConfig;
  secretName?: string;
  enabled?: boolean;
}

export type ReceiveOutcome =
  | { status: 'accepted'; deliveryId: string; result: DispatchResult }
  | { status: 'challenge'; challenge: string }
  | { status: 'rejected'; reason: string }
  | { status: 'not_found' };

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export class IncomingWebhookRepository {
  constructor(
    private readonly db: Db,
    private readonly secrets: Pick<SecretRepository, 'resolve'>,
    private readonly dispatcher: Pick<EventDispatcher, 'dispatch'>
  ) {}

  async create(namespaceId: string, definition: WebhookDefinition): Promise<IncomingWebhook> {
    assertCoherent(definition);
    const row = await this.db
      .insertInto('IncomingWebhooks')
      .values({
        namespaceId,
        name: definition.name,
        description: definition.description ?? null,
        verifier: definition.verifier,
        config: json(definition.config ?? {}),
        secretName: definition.secretName ?? null,
        enabled: definition.enabled ?? true,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new NodeFlowError(ErrorCode.CONFLICT, `a webhook named "${definition.name}" already exists`);
        }
        throw error;
      });
    return toWebhook(row);
  }

  async update(namespaceId: string, name: string, definition: Omit<WebhookDefinition, 'name'>): Promise<IncomingWebhook> {
    assertCoherent({ ...definition, name });
    const row = await this.db
      .updateTable('IncomingWebhooks')
      .set({
        description: definition.description ?? null,
        verifier: definition.verifier,
        config: json(definition.config ?? {}),
        secretName: definition.secretName ?? null,
        enabled: definition.enabled ?? true,
        lastError: null,
        updatedAt: sql<Date>`now()`,
      })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no webhook "${name}"`);
    return toWebhook(row);
  }

  async list(namespaceId: string): Promise<IncomingWebhook[]> {
    const rows = await this.db
      .selectFrom('IncomingWebhooks')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .orderBy('name')
      .execute();
    return rows.map(toWebhook);
  }

  async get(namespaceId: string, name: string): Promise<IncomingWebhook | undefined> {
    const row = await this.db
      .selectFrom('IncomingWebhooks')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();
    return row ? toWebhook(row) : undefined;
  }

  async delete(namespaceId: string, name: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('IncomingWebhooks')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  /**
   * Handles one request to a webhook's public URL.
   *
   * Verification comes before anything is parsed into action, and a request
   * that fails it touches nothing but a counter — so a flood of forgeries
   * cannot start a workflow, fill the event monitor, or learn which handlers
   * exist. A disabled or unknown webhook is `not_found`, identically.
   */
  async receive(request: {
    id: string;
    rawBody: string;
    body: Record<string, JsonValue>;
    headers: Record<string, string | undefined>;
  }): Promise<ReceiveOutcome> {
    if (!UUID.test(request.id)) return { status: 'not_found' };
    const row = await this.db.selectFrom('IncomingWebhooks').selectAll().where('id', '=', request.id).executeTakeFirst();
    if (!row || !row.enabled) return { status: 'not_found' };
    const webhook = toWebhook(row);

    const secret = webhook.secretName
      ? (await this.secrets.resolve(webhook.namespaceId, [webhook.secretName]))[webhook.secretName]
      : undefined;
    const verdict = verifyWebhook(webhook.verifier, webhook.config, {
      rawBody: request.rawBody,
      headers: request.headers,
      secret: typeof secret === 'string' ? secret : secret === undefined ? undefined : JSON.stringify(secret),
    });

    if (!verdict.ok) {
      await this.record(webhook.id, verdict.reason, false);
      return { status: 'rejected', reason: verdict.reason };
    }

    // Slack proves an endpoint by sending a signed challenge it expects echoed.
    if (webhook.verifier === 'SLACK' && request.body['type'] === 'url_verification' && typeof request.body['challenge'] === 'string') {
      await this.record(webhook.id, undefined, true);
      return { status: 'challenge', challenge: request.body['challenge'] };
    }

    const senderId = deliveryIdOf(webhook.verifier, request.headers, request.body);
    const deliveryId = `webhook:${webhook.name}:${senderId ?? randomUUID()}`;
    const result = await this.dispatcher.dispatch(
      {
        source: WEBHOOK_SOURCE,
        topic: webhook.name,
        payload: request.body,
        headers: withoutSecrets(request.headers),
        key: senderId ?? null,
        deliveryId,
      },
      { namespaceId: webhook.namespaceId }
    );
    await this.record(webhook.id, result.matched === 0 ? 'no enabled event handler listens to this webhook' : undefined, true);
    return { status: 'accepted', deliveryId, result };
  }

  private async record(id: string, error: string | undefined, accepted: boolean): Promise<void> {
    await this.db
      .updateTable('IncomingWebhooks')
      .set(
        accepted
          ? { receivedCount: sql<string>`"receivedCount" + 1`, lastReceivedAt: sql<Date>`now()`, lastError: error ?? null }
          : { rejectedCount: sql<string>`"rejectedCount" + 1`, lastError: error ?? null }
      )
      .where('id', '=', id)
      .execute();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Signature and auth headers are proof, not data: they never travel on into a workflow. */
function withoutSecrets(headers: Record<string, string | undefined>): Record<string, string> {
  const hidden = /signature|authorization|token|hmac|cookie|secret/i;
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined && !hidden.test(entry[0]))
  );
}

function assertCoherent(definition: WebhookDefinition): void {
  if (!NAME.test(definition.name)) {
    throw new InvalidArgumentError('a webhook name is lower-case letters, digits, dots, dashes and underscores');
  }
  if (!WEBHOOK_VERIFIERS.includes(definition.verifier)) {
    throw new InvalidArgumentError(`unknown verifier "${definition.verifier}"`, { allowed: [...WEBHOOK_VERIFIERS] });
  }
  if (definition.verifier !== 'NONE' && !definition.secretName) {
    throw new InvalidArgumentError(`the ${definition.verifier} verifier needs a secret to check signatures with`);
  }
  if ((definition.verifier === 'HMAC' || definition.verifier === 'HEADER') && !definition.config?.header) {
    throw new InvalidArgumentError(`the ${definition.verifier} verifier needs the header it reads`);
  }
}

function toWebhook(row: Record<string, unknown>): IncomingWebhook {
  return {
    id: row['id'] as string,
    namespaceId: row['namespaceId'] as string,
    name: row['name'] as string,
    description: (row['description'] as string | null) ?? null,
    verifier: row['verifier'] as WebhookVerifier,
    config: (row['config'] as WebhookVerifierConfig) ?? {},
    secretName: (row['secretName'] as string | null) ?? null,
    enabled: row['enabled'] as boolean,
    receivedCount: Number(row['receivedCount'] ?? 0),
    rejectedCount: Number(row['rejectedCount'] ?? 0),
    lastReceivedAt: (row['lastReceivedAt'] as Date | null) ?? null,
    lastError: (row['lastError'] as string | null) ?? null,
    createdAt: row['createdAt'] as Date,
    updatedAt: row['updatedAt'] as Date,
  };
}
