import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ErrorCode, Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import {
  QuotaService,
  ScheduleRepository,
  nextOccurrence,
  previewOccurrences,
  type Schedule,
} from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { Audited } from '../common/audit.interceptor.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Cron triggers.
 *
 * Scoped under `workflows:*` rather than a scope of its own: a schedule is a
 * statement about when a definition runs, so anyone who may change the
 * definition may change its schedule, and separating them would mean a caller
 * who could rewrite the workflow but not say when it runs.
 */

const runsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().regex(/^\d+$/).optional(),
  outcome: z.enum(['STARTED', 'SKIPPED', 'FAILED']).optional(),
});

const scheduleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  cron: z.string().min(1),
  timezone: z.string().min(1).default('UTC'),
  workflow: z.object({ name: z.string().min(1), version: z.number().int().positive().optional() }),
  input: z.record(z.string(), z.unknown()).optional(),
  correlationId: z.string().optional(),
  priority: z.number().int().min(0).max(99).optional(),
  paused: z.boolean().optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  overlapPolicy: z.enum(['ALLOW', 'SKIP']).optional(),
  catchupPolicy: z.enum(['SKIP', 'FIRE_ONE', 'FIRE_ALL']).optional(),
});

const previewSchema = z.object({
  cron: z.string().min(1),
  timezone: z.string().min(1).default('UTC'),
  count: z.number().int().min(1).max(20).default(5),
});

@Controller('ns/:ns/schedules')
export class ScheduleController {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly quotas: QuotaService
  ) {}

  @Audited('schedule', 'create')
  @Post()
  @HttpCode(201)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Create a cron schedule',
    description:
      'Leased and database-backed, so running several replicas produces one ' +
      'firing rather than one per replica.',
    tags: ['schedules'],
    body: scheduleSchema,
  })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(scheduleSchema)) body: z.infer<typeof scheduleSchema>
  ) {
    await this.quotas.assertMayCreate(principal.namespaceId, 'maxSchedules');

    const schedule = await this.schedules.create({
      namespaceId: principal.namespaceId,
      name: body.name,
      description: body.description,
      cron: body.cron,
      timezone: body.timezone,
      defName: body.workflow.name,
      defVersion: body.workflow.version,
      input: (body.input ?? {}) as Record<string, JsonValue>,
      correlationId: body.correlationId,
      priority: body.priority,
      paused: body.paused,
      startAt: body.startAt,
      endAt: body.endAt,
      overlapPolicy: body.overlapPolicy,
      catchupPolicy: body.catchupPolicy,
    });

    return present(schedule);
  }

  @Post('preview')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({
    summary: 'Preview when a cron expression fires',
    description:
      'Validates the expression exactly as saving would and returns its next firings, so a ' +
      'form can show "is that what I meant?" before anything is saved.',
    tags: ['schedules'],
    body: previewSchema,
  })
  preview(@Body(zodBody(previewSchema)) body: z.infer<typeof previewSchema>) {
    return {
      upcoming: previewOccurrences(body.cron, body.timezone, body.count).map((at) => at.toISOString()),
    };
  }

  @Audited('schedule', 'update')
  @Put(':name')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Update a schedule',
    description:
      'Replaces its settings and keeps its run history. The next run is recomputed from now, ' +
      'so a changed expression never fires on the old timetable.',
    tags: ['schedules'],
    body: scheduleSchema.omit({ name: true }),
  })
  async update(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(scheduleSchema.omit({ name: true }))) body: Omit<z.infer<typeof scheduleSchema>, 'name'>
  ) {
    const schedule = await this.schedules.update(principal.namespaceId, name, {
      description: body.description,
      cron: body.cron,
      timezone: body.timezone,
      defName: body.workflow.name,
      defVersion: body.workflow.version,
      input: (body.input ?? {}) as Record<string, JsonValue>,
      correlationId: body.correlationId,
      priority: body.priority,
      paused: body.paused,
      startAt: body.startAt,
      endAt: body.endAt,
      overlapPolicy: body.overlapPolicy,
      catchupPolicy: body.catchupPolicy,
    });
    return present(schedule);
  }

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List cron schedules', tags: ['schedules'] })
  async list(@CurrentPrincipal() principal: Principal) {
    const schedules = await this.schedules.list(principal.namespaceId);
    return { schedules: schedules.map(present) };
  }

  @Get(':name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({
    summary: 'Fetch one schedule, with its upcoming runs',
    description:
      'The next few firings are computed rather than stored, which is the ' +
      'cheapest way to answer "did I get the cron expression right?".',
    tags: ['schedules'],
  })
  async get(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const schedule = await this.schedules.findByName(principal.namespaceId, name);
    if (!schedule) throw notFound(name);

    return { ...present(schedule), upcoming: upcomingRuns(schedule) };
  }

  @Get(':name/runs')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({
    summary: 'A schedule’s firing history',
    description:
      'Newest first: each firing’s occurrence, when it fired, and whether it started a run (with that run’s status now), ' +
      'was skipped because the previous run was still going, or failed to start. Kept for 30 days. ' +
      'Page with `before` set to the previous page’s `nextCursor`; filter with `outcome`.',
    tags: ['schedules'],
  })
  async runs(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Query(zodBody(runsQuery)) query: z.infer<typeof runsQuery>
  ) {
    const page = await this.schedules.runs(principal.namespaceId, name, query);
    if (!page) throw notFound(name);
    return page;
  }

  @Audited('schedule', 'pause')
  @Post(':name/pause')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Pause a schedule', tags: ['schedules'] })
  async pause(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    return present(await this.schedules.setPaused(principal.namespaceId, name, true));
  }

  @Audited('schedule', 'resume')
  @Post(':name/resume')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Resume a schedule',
    description:
      'Resumes from now, not from the backlog: pausing is an instruction not ' +
      'to run, not a request to defer.',
    tags: ['schedules'],
  })
  async resume(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    return present(await this.schedules.setPaused(principal.namespaceId, name, false));
  }

  @Audited('schedule', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete a schedule', tags: ['schedules'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    if (!(await this.schedules.delete(principal.namespaceId, name))) throw notFound(name);
  }
}

/**
 * The next few firings.
 *
 * Computed on read rather than stored, because the only question anyone asks of
 * a cron expression is "is that what I meant?" and a list of instants answers
 * it better than the expression does.
 */
function upcomingRuns(schedule: Schedule, count = 5): string[] {
  const runs: string[] = [];
  let cursor = new Date();

  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(schedule.cron, schedule.timezone, cursor);
    if (!next || (schedule.endAt && next > schedule.endAt)) break;
    runs.push(next.toISOString());
    cursor = next;
  }

  return runs;
}

function notFound(name: string): NotFoundException {
  return new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no schedule "${name}"` });
}

function present(schedule: Schedule) {
  return {
    name: schedule.name,
    description: schedule.description,
    cron: schedule.cron,
    timezone: schedule.timezone,
    workflow: { name: schedule.defName, version: schedule.defVersion },
    input: schedule.input,
    priority: schedule.priority,
    paused: schedule.paused,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    overlapPolicy: schedule.overlapPolicy,
    catchupPolicy: schedule.catchupPolicy,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    lastWorkflowId: schedule.lastWorkflowId,
    runCount: schedule.runCount,
    // Surfaced deliberately: "my schedule stopped working" is answered by this
    // field, and hiding it means the answer lives only in server logs.
    lastError: schedule.lastError,
  };
}

@Module({ controllers: [ScheduleController] })
export class ScheduleModule {}
