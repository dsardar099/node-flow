import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ErrorCode,
  InvalidArgumentError,
  NodeFlowError,
  PrincipalType,
  Scope,
  type JsonValue,
  type Principal,
} from '@node-flow-dev/core';
import {
  GroupRepository,
  HumanTaskRepository,
  MetadataRepository,
  resolveAssignments,
  type Db,
  type HumanTaskView,
} from '@node-flow-dev/store';
import { DB } from '../database/database.module.js';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';
import { zodBody } from '../common/zod.pipe.js';
import { Audited } from '../common/audit.interceptor.js';

/**
 * The inbox behind `HUMAN`.
 *
 * Every route here answers for a **person**, not a service: claiming and
 * completing are statements about who did the work, and an API key belongs to a
 * fleet rather than to anyone. So these routes require a user principal and say
 * so, rather than recording a service account as the approver of a refund.
 */

const completeSchema = z.object({
  output: z.record(z.string(), z.unknown()).optional(),
});

const reassignSchema = z.object({
  assignments: z.array(z.record(z.string(), z.unknown())).min(1),
});

const skipSchema = z.object({
  reason: z.string().min(1).max(1000),
});

const searchSchema = z.object({
  state: z.enum(['open', 'unclaimed', 'claimed', 'completed', 'all']).optional(),
  assignee: z.string().min(1).max(320).optional(),
  group: z.string().min(1).max(200).optional(),
  workflowId: z.string().optional(),
  q: z.string().max(200).optional(),
  olderThanMinutes: z.coerce.number().int().min(0).max(525_600).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('ns/:ns/human-tasks')
export class HumanTaskController {
  constructor(
    private readonly tasks: HumanTaskRepository,
    private readonly groups: GroupRepository,
    @Inject(DB) private readonly db: Db,
    private readonly metadata: MetadataRepository
  ) {}

  @Get()
  @RequireScopes(Scope.HUMAN_TASKS_READ)
  @ApiRoute({
    summary: 'List the human tasks this user can act on',
    description:
      'Assigned to them, held by them, or unassigned and free to claim. Never ' +
      "another person's assignment, and never something someone else holds.",
    tags: ['human-tasks'],
  })
  async inbox(
    @CurrentPrincipal() principal: Principal,
    @Query('includeCompleted') includeCompleted?: string,
    @Query('limit') limit?: string
  ) {
    const userId = requireUser(principal);

    const tasks = await this.tasks.inbox(principal.namespaceId, userId, {
      includeCompleted: includeCompleted === 'true',
      limit: limit ? Number(limit) : undefined,
      // Work routed to a team this person is on. Without it, a task assigned to
      // "the payments team" is invisible to every member of that team.
      groupIds: await this.groups.groupIdsFor(userId),
    });

    return { tasks: tasks.map(present) };
  }

  @Get('search')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({
    summary: 'Search every human task in the namespace',
    description:
      'The operator view: what is waiting, with whom, and for how long — across assignees, unlike the inbox. ' +
      '`state` is open (default), unclaimed, claimed, completed or all; `assignee` is an email, `group` a group name. ' +
      'Tasks of workflows the caller’s tags cannot reach are left out.',
    tags: ['human-tasks'],
  })
  async search(
    @CurrentPrincipal() principal: Principal,
    @Query(zodBody(searchSchema)) query: z.infer<typeof searchSchema>
  ) {
    const namespaceId = principal.namespaceId;
    const empty = { tasks: [], hasMore: false, people: {} };

    // A person or group that does not exist matches nothing — not everything.
    let userId: string | undefined;
    if (query.assignee) {
      const user = await this.db
        .selectFrom('Users')
        .select('id')
        .where('namespaceId', '=', namespaceId)
        .where('email', '=', query.assignee.trim().toLowerCase())
        .executeTakeFirst();
      if (!user) return empty;
      userId = user.id;
    }
    let groupId: string | undefined;
    if (query.group) {
      const group = await this.db
        .selectFrom('Groups')
        .select('id')
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', query.group)
        .executeTakeFirst();
      if (!group) return empty;
      groupId = group.id;
    }
    if (query.workflowId && !UUID.test(query.workflowId)) return empty;

    const result = await this.tasks.search(namespaceId, {
      state: query.state,
      userId,
      groupId,
      workflowId: query.workflowId,
      text: query.q,
      olderThanMinutes: query.olderThanMinutes,
      limit: query.limit,
      offset: query.offset,
      excludeDefNames: await this.metadata.unreachableWorkflowNames(namespaceId, {
        tagGrants: [...(principal.tagGrants ?? []), ...principal.scopes],
      }),
    });

    return { tasks: result.tasks.map(present), hasMore: result.hasMore, people: await this.labels(namespaceId, result.tasks) };
  }

  /** Emails and group names for the ids a page of tasks mentions, so a list reads as people. */
  private async labels(namespaceId: string, tasks: HumanTaskView[]): Promise<Record<string, string>> {
    const userIds = new Set<string>();
    const groupIds = new Set<string>();
    for (const task of tasks) {
      for (const id of [task.assigneeId, task.claimedBy, task.completedBy]) if (id && UUID.test(id)) userIds.add(id);
      if (task.assigneeGroupId) groupIds.add(task.assigneeGroupId);
    }
    const [users, groups] = await Promise.all([
      userIds.size
        ? this.db.selectFrom('Users').select(['id', 'email']).where('namespaceId', '=', namespaceId).where('id', 'in', [...userIds]).execute()
        : [],
      groupIds.size
        ? this.db.selectFrom('Groups').select(['id', 'name']).where('namespaceId', '=', namespaceId).where('id', 'in', [...groupIds]).execute()
        : [],
    ]);
    return Object.fromEntries([...users.map((u) => [u.id, u.email]), ...groups.map((g) => [g.id, `@${g.name}`])]);
  }

  @Get(':id')
  @RequireScopes(Scope.HUMAN_TASKS_READ)
  @ApiRoute({ summary: 'Fetch one human task', tags: ['human-tasks'] })
  async get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    requireUser(principal);

    const task = await this.tasks.findById(principal.namespaceId, id);
    if (!task) throw notFound(id);

    return present(task);
  }

  @Post(':id/claim')
  @HttpCode(200)
  @RequireScopes(Scope.HUMAN_TASKS_WRITE)
  @ApiRoute({
    summary: 'Take possession of a human task',
    description:
      'Single-winner: two people claiming the same task at the same moment ' +
      'resolve to one, and the loser is told rather than both starting work.',
    tags: ['human-tasks'],
  })
  async claim(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const userId = requireUser(principal);
    const result = await this.tasks.claim(
      principal.namespaceId,
      id,
      userId,
      await this.groups.groupIdsFor(userId)
    );

    if (result.ok) return present(result.task);

    switch (result.reason) {
      case 'held_by_other':
        // 409 rather than 403: nothing is wrong with the caller, they were
        // simply second. A UI should refresh the list, not ask for credentials.
        throw new NodeFlowError(ErrorCode.CONFLICT, 'someone else is already working on this');
      case 'not_yours':
        throw new ForbiddenException({
          error: ErrorCode.NOT_FOUND,
          message: 'this task is assigned to someone else',
        });
      case 'completed':
        throw new NodeFlowError(ErrorCode.CONFLICT, 'this task is already done');
      default:
        throw notFound(id);
    }
  }

  @Post(':id/release')
  @HttpCode(200)
  @RequireScopes(Scope.HUMAN_TASKS_WRITE)
  @ApiRoute({
    summary: 'Give a claimed task back to the pool',
    description: 'The assignment is left intact — releasing is not reassigning.',
    tags: ['human-tasks'],
  })
  async release(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    const userId = requireUser(principal);
    const result = await this.tasks.release(principal.namespaceId, id, userId);

    if (result.ok) return present(result.task);

    switch (result.reason) {
      case 'not_holder':
        throw new NodeFlowError(ErrorCode.CONFLICT, 'you are not holding this task');
      case 'completed':
        throw new NodeFlowError(ErrorCode.CONFLICT, 'this task is already done');
      default:
        throw notFound(id);
    }
  }

  @Audited('human-task', 'reassign')
  @Post(':id/reassign')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @ApiRoute({
    summary: 'Replace who a human task is assigned to',
    description:
      'An operator action. Takes an assignment chain — `[{ "user": "email", "slaMinutes": 30 }, { "group": "name" }]` — ' +
      'and releases any claim, so nobody keeps working a task that was moved away from them.',
    tags: ['human-tasks'],
    body: reassignSchema,
  })
  async reassign(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(reassignSchema)) body: z.infer<typeof reassignSchema>
  ) {
    const resolved = await resolveAssignments(this.db, principal.namespaceId, body.assignments);
    if ('violation' in resolved) throw new InvalidArgumentError(resolved.violation);
    const task = await this.tasks.reassign(principal.namespaceId, id, resolved.assignments ?? []);
    if (!task) throw notFound(id);
    return present(task);
  }

  @Audited('human-task', 'skip')
  @Post(':id/skip')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_WRITE)
  @ApiRoute({
    summary: 'Skip a human task',
    description: 'The workflow continues as if the task completed; the reason is recorded in its output.',
    tags: ['human-tasks'],
    body: skipSchema,
  })
  async skip(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(skipSchema)) body: z.infer<typeof skipSchema>
  ) {
    const result = await this.tasks.skip(principal.namespaceId, id, principal.id, body.reason);
    if (result.ok) return { skipped: true, workflowId: result.workflowId, taskRef: result.refName };
    if (result.reason === 'completed') throw new NodeFlowError(ErrorCode.CONFLICT, 'this task is already done');
    throw new NodeFlowError(ErrorCode.CONFLICT, 'the workflow this task belongs to is no longer waiting for it');
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequireScopes(Scope.HUMAN_TASKS_WRITE)
  @ApiRoute({
    summary: 'Complete a human task and let the workflow continue',
    description:
      'Requires holding the claim. Without that, one person’s answer could ' +
      'silently replace another’s on a task they were actively working.',
    tags: ['human-tasks'],
    body: completeSchema,
  })
  async complete(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(zodBody(completeSchema)) body: z.infer<typeof completeSchema>
  ) {
    const userId = requireUser(principal);

    const result = await this.tasks.complete(
      principal.namespaceId,
      id,
      userId,
      (body.output ?? {}) as Record<string, JsonValue>
    );

    if (result.ok) {
      return { completed: true, workflowId: result.workflowId, taskRef: result.refName };
    }

    switch (result.reason) {
      case 'not_holder':
        throw new NodeFlowError(
          ErrorCode.CONFLICT,
          'claim this task before completing it'
        );
      case 'completed':
        throw new NodeFlowError(ErrorCode.CONFLICT, 'this task is already done');
      case 'invalid':
        throw new InvalidArgumentError(
          'the response does not match this task’s form: ' +
            result.violations.map((v) => `${v.path || '(root)'} ${v.message}`).join('; '),
          { violations: result.violations }
        );
      case 'not_waiting':
        // The workflow was terminated, or the task timed out, while the form
        // was open. Telling the person beats accepting an answer that goes
        // nowhere.
        throw new NodeFlowError(
          ErrorCode.CONFLICT,
          'the workflow this task belongs to is no longer waiting for it'
        );
      default:
        throw notFound(id);
    }
  }
}

/**
 * Human tasks are done by humans.
 *
 * An API key identifies a fleet, not a person, so recording one as the approver
 * of a refund would make the audit trail worse than useless — it would look
 * complete while naming nobody.
 */
function requireUser(principal: Principal): string {
  if (principal.type !== PrincipalType.USER) {
    throw new ForbiddenException({
      error: ErrorCode.NOT_FOUND,
      message: 'human tasks can only be acted on by a signed-in user',
    });
  }

  return principal.id;
}

/** Identical for "not yours" and "does not exist", so ids cannot be probed. */
function notFound(id: string): NotFoundException {
  return new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no human task ${id}` });
}

function present(task: HumanTaskView) {
  return {
    id: task.id,
    workflowId: task.workflowId,
    taskRef: task.refName,
    title: task.title,
    description: task.description,
    form: task.form,
    assigneeId: task.assigneeId,
    claimedBy: task.claimedBy,
    claimedAt: task.claimedAt,
    completedBy: task.completedBy,
    completedAt: task.completedAt,
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    formTemplate: task.formTemplate ? { name: task.formTemplate, version: task.formVersion } : null,
    assignments: task.assignments,
    assignmentIndex: task.assignmentIndex,
    assignedAt: task.assignedAt,
    completionStrategy: task.completionStrategy,
    skippedReason: task.skippedReason,
    assigneeGroupId: task.assigneeGroupId,
    autoClaim: task.autoClaim,
    triggers: task.triggers,
  };
}

@Module({ controllers: [HumanTaskController] })
export class HumanModule {}
