import { Body, Controller, Delete, Get, HttpCode, Inject, Module, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ErrorCode, Scope, type Principal } from '@node-flow-dev/core';
import {
  STATUS_EVENTS,
  STATUS_SINKS,
  StatusListenerRepository,
  sampleStatusEvent,
  type StatusListener,
  type StatusSinkSender,
} from '@node-flow-dev/store';
import { z } from 'zod';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { STATUS_SINK_SENDER } from '../database/database.module.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Status listeners — change data capture for executions.
 *
 * Each listener picks workflows (exact names, or a prefix ending in `*`) and
 * lifecycle events, and a sink: a signed webhook, or a Kafka topic, NATS
 * subject, AMQP queue or SQS queue on a connection configured on the server.
 * Changes are delivered at least once, each with a stable `id` to deduplicate on.
 */

const definitionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().optional(),
  workflowNames: z.array(z.string().min(1).max(200)).max(100).optional(),
  events: z.array(z.enum(STATUS_EVENTS)).max(STATUS_EVENTS.length).optional(),
  sink: z.enum(STATUS_SINKS),
  config: z.union([
    z.object({
      url: z.string().min(1).max(2000),
      secretName: z.string().min(1).max(200).optional(),
      headers: z.record(z.string().max(100), z.string().max(1000)).optional(),
    }),
    z.object({ cluster: z.string().min(1).max(100), topic: z.string().min(1).max(249) }),
    z.object({ connection: z.string().min(1).max(100), destination: z.string().min(1).max(500) }),
  ]),
  includeOutput: z.boolean().optional(),
});

const notFound = (name: string) => new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no status listener "${name}"` });

@Controller('ns/:ns/status-listeners')
export class StatusListenerController {
  constructor(
    private readonly listeners: StatusListenerRepository,
    @Inject(STATUS_SINK_SENDER) private readonly send: StatusSinkSender
  ) {}

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List status listeners', tags: ['status-listeners'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { listeners: (await this.listeners.list(principal.namespaceId)).map(present) };
  }

  @Get(':name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Fetch a status listener', tags: ['status-listeners'] })
  async get(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const listener = await this.listeners.get(principal.namespaceId, name);
    if (!listener) throw notFound(name);
    return present(listener);
  }

  @Audited('status-listener', 'create')
  @Post()
  @HttpCode(201)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Create a status listener', tags: ['status-listeners'], body: definitionSchema })
  async create(@CurrentPrincipal() principal: Principal, @Body(zodBody(definitionSchema)) body: z.infer<typeof definitionSchema>) {
    return present(await this.listeners.create(principal.namespaceId, body));
  }

  @Audited('status-listener', 'update')
  @Put(':name')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Update a status listener', tags: ['status-listeners'], body: definitionSchema.omit({ name: true }) })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(definitionSchema.omit({ name: true }))) body: Omit<z.infer<typeof definitionSchema>, 'name'>
  ) {
    return present(await this.listeners.update(principal.namespaceId, name, body));
  }

  @Audited('status-listener', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete a status listener', tags: ['status-listeners'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    if (!(await this.listeners.delete(principal.namespaceId, name))) throw notFound(name);
  }

  @Post(':name/test')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Send a sample event to a listener’s sink now',
    description:
      'Delivers a made-up COMPLETED event (marked `"test": true`) straight to the sink and reports what happened, ' +
      'so a URL, signing secret or Kafka topic can be checked before real changes depend on it.',
    tags: ['status-listeners'],
  })
  async test(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const listener = await this.listeners.get(principal.namespaceId, name);
    if (!listener) throw notFound(name);
    const event = sampleStatusEvent(listener);
    const started = Date.now();
    try {
      await this.send(listener, event);
      return { delivered: true, event, durationMs: Date.now() - started };
    } catch (error) {
      return { delivered: false, event, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

function present(listener: StatusListener) {
  const { namespaceId: _namespaceId, ...rest } = listener;
  return rest;
}

@Module({ controllers: [StatusListenerController] })
export class StatusListenersModule {}
