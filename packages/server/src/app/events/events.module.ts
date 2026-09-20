import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ErrorCode, Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import {
  EventDispatcher,
  EventExecutionRepository,
  EventHandlerRepository,
  IncomingWebhookRepository,
  AmqpEventSource,
  KafkaEventSource,
  NatsEventSource,
  RedisEventSource,
  SqsEventSource,
  WEBHOOK_SOURCE,
  type EventHandler,
  type EventSource,
  type KafkaClusterConfig,
} from '@node-flow-dev/store';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { Audited } from '../common/audit.interceptor.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Inbound event handlers — the mirror of the outbox.
 *
 * Scoped under `workflows:*`, like schedules: a handler is a statement about
 * what starts a definition, so whoever may change the definition may change
 * what triggers it.
 */

const handlerSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  source: z.string().min(1),
  topic: z.string().min(1),
  condition: z.string().max(10_000).optional(),
  action: z.enum(['START_WORKFLOW', 'COMPLETE_TASK', 'FAIL_TASK']),
  workflow: z
    .object({ name: z.string().min(1), version: z.number().int().positive().optional() })
    .optional(),
  inputTemplate: z.record(z.string(), z.unknown()).optional(),
  correlationId: z.string().optional(),
  workflowIdExpr: z.string().optional(),
  taskRefExpr: z.string().optional(),
  enabled: z.boolean().optional(),
});

const executionsQuery = z.object({
  handler: z.string().min(1).optional(),
  outcome: z.enum(['ACTED', 'SKIPPED', 'FAILED']).optional(),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const testEventSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  key: z.string().max(500).optional(),
});

@Controller('ns/:ns/event-handlers')
export class EventHandlerController {
  constructor(
    private readonly handlers: EventHandlerRepository,
    private readonly monitor: EventExecutionRepository,
    private readonly dispatcher: EventDispatcher,
    private readonly incomingWebhooks: IncomingWebhookRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /**
   * The sources this install consumes from.
   *
   * A handler on a source that is not configured is accepted and never fires,
   * so a form should offer the configured ones rather than a free-text box.
   */
  @Get('sources')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List configured event sources', tags: ['events'] })
  async sources(@CurrentPrincipal() principal: Principal) {
    const webhooks = await this.incomingWebhooks.list(principal.namespaceId);
    return {
      sources: [
        ...configuredSources(this.config),
        // One source for every webhook; the webhook is chosen by topic.
        ...(webhooks.length ? [{ id: WEBHOOK_SOURCE, kind: 'webhook', name: 'Inbound webhooks', topics: webhooks.map((w) => w.name) }] : []),
      ],
    };
  }

  /** Per-handler outcome counts over a recent window — the event monitor's overview. */
  @Get('activity')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({
    summary: 'Event handler activity',
    tags: ['events'],
    query: z.object({ hours: z.coerce.number().int().min(1).max(24 * 7).optional() }),
  })
  async activity(@CurrentPrincipal() principal: Principal, @Query('hours') hours?: string) {
    const window = Math.min(Math.max(Number(hours) || 24, 1), 24 * 7);
    return { hours: window, handlers: await this.monitor.activity(principal.namespaceId, window) };
  }

  /** What handlers did with each message they saw, newest first. */
  @Get('executions')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({
    summary: 'Event executions — the event monitor',
    tags: ['events'],
    query: executionsQuery,
  })
  async executions(@CurrentPrincipal() principal: Principal, @Query(zodBody(executionsQuery)) query: z.infer<typeof executionsQuery>) {
    const page = await this.monitor.list(principal.namespaceId, {
      handlerName: query.handler,
      outcome: query.outcome,
      before: query.before,
      limit: query.limit,
    });
    return { executions: page.executions, nextCursor: page.nextCursor };
  }

  /**
   * Delivers a test message to one handler, exactly as a real one would be.
   *
   * It really acts — a START_WORKFLOW handler starts a workflow — because a test
   * that stops short of acting cannot show the template resolving into the input
   * the workflow actually receives.
   */
  @Audited('event-handler', 'test')
  @Post(':name/test')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Send a test message to an event handler', tags: ['events'], body: testEventSchema })
  async test(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(testEventSchema)) body: z.infer<typeof testEventSchema>
  ) {
    const handler = await this.handlers.findByName(principal.namespaceId, name);
    if (!handler) throw notFound(name);
    return this.dispatcher.dispatchTo(handler, {
      source: handler.source,
      topic: handler.topic,
      payload: body.payload as Record<string, JsonValue>,
      key: body.key ?? null,
      deliveryId: `test:${randomUUID()}`,
    });
  }

  @Audited('event-handler', 'update')
  @Put(':name')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Update an event handler', tags: ['events'], body: handlerSchema.omit({ name: true }) })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(handlerSchema.omit({ name: true }))) body: Omit<z.infer<typeof handlerSchema>, 'name'>
  ) {
    const handler = await this.handlers.update(principal.namespaceId, name, {
      description: body.description,
      source: body.source,
      topic: body.topic,
      condition: body.condition,
      action: body.action,
      defName: body.workflow?.name,
      defVersion: body.workflow?.version,
      inputTemplate: (body.inputTemplate ?? {}) as Record<string, JsonValue>,
      correlationId: body.correlationId,
      workflowIdExpr: body.workflowIdExpr,
      taskRefExpr: body.taskRefExpr,
      enabled: body.enabled,
    });
    return present(handler);
  }

  @Audited('event-handler', 'create')
  @Post()
  @HttpCode(201)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Create an inbound event handler',
    description:
      'Maps a message on a configured source and topic to starting a workflow ' +
      'or finishing a task that is waiting for one.',
    tags: ['events'],
    body: handlerSchema,
  })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(handlerSchema)) body: z.infer<typeof handlerSchema>
  ) {
    const handler = await this.handlers.create({
      namespaceId: principal.namespaceId,
      name: body.name,
      description: body.description,
      source: body.source,
      topic: body.topic,
      condition: body.condition,
      action: body.action,
      defName: body.workflow?.name,
      defVersion: body.workflow?.version,
      inputTemplate: (body.inputTemplate ?? {}) as Record<string, JsonValue>,
      correlationId: body.correlationId,
      workflowIdExpr: body.workflowIdExpr,
      taskRefExpr: body.taskRefExpr,
      enabled: body.enabled,
    });

    return present(handler);
  }

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List event handlers', tags: ['events'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { handlers: (await this.handlers.list(principal.namespaceId)).map(present) };
  }

  @Get(':name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Fetch one event handler', tags: ['events'] })
  async get(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const handler = await this.handlers.findByName(principal.namespaceId, name);
    if (!handler) throw notFound(name);
    return present(handler);
  }

  @Audited('event-handler', 'disable')
  @Post(':name/disable')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Disable an event handler', tags: ['events'] })
  async disable(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    return present(await this.handlers.setEnabled(principal.namespaceId, name, false));
  }

  @Audited('event-handler', 'enable')
  @Post(':name/enable')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Enable an event handler',
    description:
      'Takes effect on the consumer’s next start, since a newly-handled topic ' +
      'may need subscribing to.',
    tags: ['events'],
  })
  async enable(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    return present(await this.handlers.setEnabled(principal.namespaceId, name, true));
  }

  @Audited('event-handler', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete an event handler', tags: ['events'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    if (!(await this.handlers.delete(principal.namespaceId, name))) throw notFound(name);
  }
}

/**
 * Runs the consumers.
 *
 * Only in the `poller` role, and only for sources the operator configured. An
 * install with no sources starts nothing, so consuming costs an install that
 * does not use it exactly nothing.
 *
 * Topics come from the handler rows rather than from configuration: a consumer
 * subscribes to what is actually handled, instead of to a list somebody has to
 * keep in step with the handlers.
 */
/** The configured broker connections, as the source ids handlers name. */
export function configuredSources(config: AppConfig): { id: string; kind: BrokerKind; name: string }[] {
  const of = (kind: BrokerKind, connections: Record<string, unknown>) =>
    Object.keys(connections).map((name) => ({ id: `${kind}:${name}`, kind, name }));
  return [
    ...of('kafka', config.NODE_FLOW_KAFKA_CLUSTERS),
    ...of('nats', config.NODE_FLOW_NATS_CONNECTIONS),
    ...of('amqp', config.NODE_FLOW_AMQP_CONNECTIONS),
    ...of('sqs', config.NODE_FLOW_SQS_CONNECTIONS),
    ...of('redis', config.NODE_FLOW_REDIS_CONNECTIONS),
  ];
}

type BrokerKind = 'kafka' | 'nats' | 'amqp' | 'sqs' | 'redis';

/** How often handler topics are re-read, so a new handler is consumed without a restart. */
const REFRESH_MS = 15_000;

@Injectable()
export class EventSourceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventSourceService.name);
  /** Running consumers by source id, with the topic set each was started on. */
  private readonly running = new Map<string, { source: EventSource; topics: string }>();
  private timer?: NodeJS.Timeout;
  private refreshing?: Promise<void>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly handlers: EventHandlerRepository,
    private readonly dispatcher: EventDispatcher
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.NODE_FLOW_ROLES.includes('poller')) return;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  /**
   * Brings each source's subscription in line with its enabled handlers.
   *
   * A source whose topic set changed is restarted rather than patched: every
   * client here subscribes at start, and a restart is the one path all four
   * share. At-least-once brokers redeliver whatever was unacknowledged.
   */
  refresh(): Promise<void> {
    this.refreshing ??= this.reconcile().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async reconcile(): Promise<void> {
    for (const { id, kind, name } of configuredSources(this.config)) {
      let topics: string[];
      try {
        topics = (await this.handlers.topicsFor(id)).sort();
      } catch (error) {
        this.logger.error(`Could not read topics for ${id}`, error);
        continue;
      }
      const key = topics.join('\n');
      const current = this.running.get(id);
      if (current?.topics === key) continue;

      if (current) {
        await current.source.stop().catch((error) => this.logger.error(`Event source ${id} did not stop cleanly`, error));
        this.running.delete(id);
      }
      if (topics.length === 0) {
        if (current) this.logger.log(`Event source ${id} has no handlers left; stopped`);
        continue;
      }

      const source = this.create(kind, name, id);
      try {
        await source.start(topics);
        this.running.set(id, { source, topics: key });
        this.logger.log(`Event source ${id} consuming [${topics.join(', ')}]`);
      } catch (error) {
        // A broker that is down must not stop the server booting. Every other
        // role still works; the next refresh tries again.
        await source.stop().catch(() => undefined);
        this.logger.error(`Event source ${id} could not start`, error);
      }
    }
  }

  private create(kind: BrokerKind, name: string, id: string): EventSource {
    const onError = (error: unknown) => this.logger.error(`event source "${id}" failed`, error);
    switch (kind) {
      case 'kafka':
        return new KafkaEventSource(id, this.config.NODE_FLOW_KAFKA_CLUSTERS[name] as KafkaClusterConfig, this.dispatcher, onError);
      case 'nats':
        return new NatsEventSource(id, this.config.NODE_FLOW_NATS_CONNECTIONS[name], this.dispatcher, onError);
      case 'amqp':
        return new AmqpEventSource(id, this.config.NODE_FLOW_AMQP_CONNECTIONS[name], this.dispatcher, onError);
      case 'sqs':
        return new SqsEventSource(id, this.config.NODE_FLOW_SQS_CONNECTIONS[name], this.dispatcher, onError);
      case 'redis':
        return new RedisEventSource(id, this.config.NODE_FLOW_REDIS_CONNECTIONS[name], this.dispatcher, onError);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.refreshing?.catch(() => undefined);
    await Promise.allSettled([...this.running.values()].map(({ source }) => source.stop()));
    this.running.clear();
  }
}

function notFound(name: string): NotFoundException {
  return new NotFoundException({
    error: ErrorCode.NOT_FOUND,
    message: `no event handler "${name}"`,
  });
}

function present(handler: EventHandler) {
  return {
    name: handler.name,
    description: handler.description,
    source: handler.source,
    topic: handler.topic,
    condition: handler.condition,
    action: handler.action,
    workflow: handler.defName ? { name: handler.defName, version: handler.defVersion } : null,
    inputTemplate: handler.inputTemplate,
    correlationId: handler.correlationId,
    workflowIdExpr: handler.workflowIdExpr,
    taskRefExpr: handler.taskRefExpr,
    enabled: handler.enabled,
    eventCount: handler.eventCount,
    lastEventAt: handler.lastEventAt,
    // "Is it receiving anything?" is the first question asked of a handler, and
    // an answer that lives only in server logs is not an answer.
    lastError: handler.lastError,
  };
}

@Module({ controllers: [EventHandlerController], providers: [EventSourceService] })
export class EventsModule {}
