import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ErrorCode, Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import { IncomingWebhookRepository, WEBHOOK_VERIFIERS, type IncomingWebhook } from '@node-flow-dev/store';
import { z } from 'zod';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { CurrentPrincipal, Public, RequireScopes } from '../auth/auth.decorators.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Inbound webhooks: named, verified endpoints for GitHub, Stripe, Slack,
 * Shopify or anything that signs with an HMAC or a shared header.
 *
 * A webhook only verifies and forwards. What a request *does* — start a
 * workflow, complete a waiting task — is an event handler on source `webhook`
 * with the webhook's name as topic, so conditions, input templates,
 * deduplication and the event monitor are the ones every other event gets.
 */

const definitionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  verifier: z.enum(WEBHOOK_VERIFIERS),
  config: z
    .object({
      header: z.string().min(1).max(200).optional(),
      algorithm: z.enum(['sha256', 'sha1', 'sha512']).optional(),
      encoding: z.enum(['hex', 'base64']).optional(),
      prefix: z.string().max(50).optional(),
    })
    .optional(),
  secretName: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
});

@Controller('ns/:ns/incoming-webhooks')
export class IncomingWebhookController {
  constructor(private readonly webhooks: IncomingWebhookRepository) {}

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List inbound webhooks', tags: ['webhooks'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { webhooks: (await this.webhooks.list(principal.namespaceId)).map(present) };
  }

  @Get(':name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Fetch an inbound webhook', tags: ['webhooks'] })
  async get(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const webhook = await this.webhooks.get(principal.namespaceId, name);
    if (!webhook) throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no webhook "${name}"` });
    return present(webhook);
  }

  @Audited('incoming-webhook', 'create')
  @Post()
  @HttpCode(201)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Create an inbound webhook', tags: ['webhooks'], body: definitionSchema })
  async create(@CurrentPrincipal() principal: Principal, @Body(zodBody(definitionSchema)) body: z.infer<typeof definitionSchema>) {
    return present(await this.webhooks.create(principal.namespaceId, body));
  }

  @Audited('incoming-webhook', 'update')
  @Put(':name')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Update an inbound webhook', tags: ['webhooks'], body: definitionSchema.omit({ name: true }) })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(definitionSchema.omit({ name: true }))) body: Omit<z.infer<typeof definitionSchema>, 'name'>
  ) {
    return present(await this.webhooks.update(principal.namespaceId, name, body));
  }

  @Audited('incoming-webhook', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete an inbound webhook', tags: ['webhooks'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    if (!(await this.webhooks.delete(principal.namespaceId, name))) {
      throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no webhook "${name}"` });
    }
  }
}

@Controller('hooks')
export class HookReceiverController {
  constructor(private readonly webhooks: IncomingWebhookRepository) {}

  /**
   * The public URL a platform posts to.
   *
   * Public because the platform holds no credential for this install; the
   * signature is the authentication. Status codes follow how senders behave:
   * they retry on 5xx and give up on 4xx, so a forgery is a 401 that is not
   * retried, and an accepted delivery is a 202 whether or not a handler acted
   * — what handlers did is in the event monitor, not something to tell the
   * sender.
   */
  @Public()
  @Post(':id')
  @HttpCode(202)
  @ApiRoute({ summary: 'Receive a webhook delivery', tags: ['webhooks'] })
  async receive(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: { rawBody?: string },
    @Res({ passthrough: true }) reply: { status(code: number): unknown }
  ) {
    const outcome = await this.webhooks.receive({
      id,
      rawBody: request.rawBody ?? '',
      body:
        typeof body === 'object' && body !== null && !Array.isArray(body)
          ? (body as Record<string, JsonValue>)
          : { body: (body ?? null) as JsonValue },
      headers: Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value])
      ),
    });

    switch (outcome.status) {
      case 'accepted':
        return { accepted: true, deliveryId: outcome.deliveryId };
      case 'challenge':
        // A 200 with the challenge echoed is what Slack's verification expects.
        reply.status(200);
        return { challenge: outcome.challenge };
      case 'rejected':
        throw new HttpException({ error: 'invalid_signature', message: outcome.reason }, 401);
      default:
        throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: 'no such webhook' });
    }
  }
}

function present(webhook: IncomingWebhook) {
  return {
    id: webhook.id,
    name: webhook.name,
    description: webhook.description,
    verifier: webhook.verifier,
    config: webhook.config,
    secretName: webhook.secretName,
    enabled: webhook.enabled,
    /** Relative to the API origin; the UI prefixes the public base URL. */
    path: `/v1/hooks/${webhook.id}`,
    receivedCount: webhook.receivedCount,
    rejectedCount: webhook.rejectedCount,
    lastReceivedAt: webhook.lastReceivedAt,
    lastError: webhook.lastError,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt,
  };
}

@Module({ controllers: [IncomingWebhookController, HookReceiverController] })
export class HooksModule {}
