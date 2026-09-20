import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import {
  ErrorCode,
  NodeFlowError,
  Scope,
  TaskStatus,
  hasScope,
  parseQueueName,
  queueScope,
  type JsonValue,
  type Principal,
} from '@node-flow-dev/core';
import {
  LongPollService,
  MetadataRepository,
  TaskDispatchService,
  TaskLogRepository,
  WorkerPollRepository,
  TaskQueueRepository,
  WorkflowRepository,
} from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { zodBody } from '../common/zod.pipe.js';

/**
 * The worker protocol: lease, heartbeat, report.
 *
 * Three properties this endpoint set has to preserve, none of them enforced in
 * the controller itself:
 *
 *  - **Per-queue authorization.** A fleet processing `charge` must not be able
 *    to drain `send_email`, so the scope carries the queue name.
 *  - **Fencing.** Every write is guarded by the lease token, so a worker whose
 *    lease expired cannot report over the top of whoever holds the task now.
 *  - **Namespace scoping.** Queue names come from user-chosen task names, so
 *    two tenants routinely both have a `charge` queue.
 *
 * Every mutating call carries `queueName`. That is not redundancy: `TaskQueues`
 * is hash-partitioned on it, and its unique index must include the partition
 * key, so acknowledging a task without the queue name would scan all eight
 * partitions instead of one.
 */

const leaseSchema = z.object({
  workerId: z.string().min(1).max(255),
  count: z.number().int().min(1).max(100).default(1),
  leaseSeconds: z.number().int().min(1).max(3600).optional(),
  /**
   * How long to hold the request open when the queue is empty.
   *
   * Zero returns immediately. The server clamps this to
   * `NODE_FLOW_MAX_POLL_SECONDS`, because a held connection is a real resource
   * and an unbounded one lets a client pin them indefinitely.
   */
  waitSeconds: z.number().int().min(0).max(3600).optional(),
});

const heartbeatSchema = z.object({
  queueName: z.string().min(1).max(255),
  leaseToken: z.string().uuid(),
  leaseSeconds: z.number().int().min(1).max(3600).optional(),
});

const reportSchema = z.object({
  queueName: z.string().min(1).max(255),
  workflowId: z.string().uuid(),
  leaseToken: z.string().uuid(),
  /**
   * Only terminal outcomes a worker can legitimately report. `IN_PROGRESS` is
   * a heartbeat, and the statuses the engine assigns itself — `TIMED_OUT`,
   * `CANCELED`, `SKIPPED` — are deliberately not settable by a worker.
   */
  status: z.enum([
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.FAILED_WITH_TERMINAL_ERROR,
  ]),
  output: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().max(4000).optional(),
});

const logsSchema = z.object({
  workflowId: z.string().uuid(),
  leaseToken: z.string().uuid(),
  logs: z
    .array(
      z.object({
        message: z.string().min(1).max(64_000),
        level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
      })
    )
    .min(1)
    .max(500),
});

@Controller('ns/:ns/queues')
export class QueueController {
  constructor(
    private readonly longPoll: LongPollService,
    private readonly queues: TaskQueueRepository,
    private readonly metadata: MetadataRepository,
    private readonly dispatch: TaskDispatchService,
    private readonly polls: WorkerPollRepository,
    private readonly workflows: WorkflowRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /**
   * Leases a batch of tasks.
   *
   * Batch rather than one at a time because the round trip dominates at any
   * real throughput — poll-per-task is most of why Conductor's workers are
   * chatty. Admission control lives in `TaskDispatchService`, so a worker
   * cannot obtain more than its share by asking differently.
   */
  @Post(':queue/lease')
  @HttpCode(200)
  @ApiRoute({
    summary: 'Lease a batch of tasks, optionally waiting for work to appear',
    description:
      'Requires the queue-specific scope `queues:lease:<queue>`. Admission control ' +
      '— concurrency caps, rate limits, semaphores — is applied here, so a worker ' +
      'cannot obtain more than its share by asking differently. Set `waitSeconds` ' +
      'to hold the request open until a task arrives, which removes the trade-off ' +
      'between poll frequency and task-start latency.',
    tags: ['workers'],
    body: leaseSchema,
  })
  async lease(
    @CurrentPrincipal() principal: Principal,
    @Param('queue') queue: string,
    @Body(zodBody(leaseSchema)) body: z.infer<typeof leaseSchema>
  ) {
    this.assertMayLease(principal, queue);

    // Recorded before waiting, so a worker parked on an empty queue still
    // counts as listening. Not awaited into the response path: losing a
    // sighting is harmless, failing a lease because of one is not.
    void this.polls.record(principal.namespaceId, queue, body.workerId).catch(() => undefined);

    const result = await this.longPoll.lease({
      namespaceId: principal.namespaceId,
      queueName: queue,
      workerId: body.workerId,
      limit: body.count,
      // Clamped, not trusted. An unbounded lease from a worker that then dies
      // makes its task unrecoverable for as long as it asked for.
      leaseSeconds: Math.min(
        body.leaseSeconds ?? this.config.NODE_FLOW_DEFAULT_LEASE_SECONDS,
        this.config.NODE_FLOW_MAX_POLL_SECONDS * 60
      ),
      // Also clamped: a held connection is a real resource, and letting a
      // client name its own duration lets one pin them indefinitely.
      waitMs:
        Math.min(
          body.waitSeconds ?? 0,
          this.config.NODE_FLOW_MAX_POLL_SECONDS
        ) * 1000,
      policy: await this.dispatchPolicyFor(principal.namespaceId, queue),
    });

    // Inputs are fetched after leasing, not inside it: resolving payloads and
    // secrets does I/O, and doing it while the lease transaction is open would
    // hold row locks on the queue for the duration.
    const inputs = await this.dispatch.inputsFor(
      result.tasks.map((task) => ({
        taskId: task.taskId,
        workflowId: task.workflowId,
        namespaceId: principal.namespaceId,
      }))
    );

    // The trace each run belongs to, so a worker's own spans hang off the
    // request that started the workflow rather than beginning a new trace that
    // nothing connects to. One batched lookup, because this is the
    // highest-volume endpoint in the system.
    const traces = await this.workflows.traceparentsFor(result.tasks.map((task) => task.workflowId));

    return {
      tasks: result.tasks.map((task) => ({
        taskId: task.taskId,
        workflowId: task.workflowId,
        leaseToken: task.leaseToken,
        leaseExpiresAt: task.leaseExpiresAt,
        ...(traces.get(task.workflowId) ? { traceparent: traces.get(task.workflowId) } : {}),
        // Without this a worker receives a task id and nothing else, so a
        // SIMPLE task's declared `inputParameters` never reach the code that
        // is supposed to act on them.
        input: inputs.get(task.taskId) ?? {},
      })),
      // Reported so a worker can tell "nothing to do" from "I waited and
      // nothing came", which are different signals when tuning a fleet.
      waitedMs: result.waitedMs,
    };
  }

  /**
   * Every queue holding outstanding work.
   *
   * Declared before `:queue/depth` only incidentally — it is a distinct path —
   * but it exists for a different reader: `depth` answers "how deep is the
   * queue I already know about", which is what an autoscaler asks, and this
   * answers "what is backed up", which is what a person asks.
   */
  @Get()
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({
    summary: 'All queues currently holding work, with depth and lease holders',
    tags: ['workers'],
  })
  async overview(@CurrentPrincipal() principal: Principal) {
    return { queues: await this.queues.overview(principal.namespaceId) };
  }

  /**
   * Which workers have polled which queues recently.
   *
   * Depth says work is waiting; this says whether anyone is listening — the
   * difference between "the fleet is slow" and "the fleet is on the wrong
   * domain", which look identical from depth alone.
   */
  @Get('workers')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({ summary: 'Workers seen polling in the last 24 hours, by queue', tags: ['workers'] })
  async workers(@CurrentPrincipal() principal: Principal) {
    return { workers: await this.polls.recent(principal.namespaceId) };
  }

  /** Queue depth — the real signal for autoscaling a worker fleet. */
  @Get(':queue/depth')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @ApiRoute({
    summary: 'Queue depth — the real signal for autoscaling a worker fleet',
    tags: ['workers'],
  })
  depth(@CurrentPrincipal() principal: Principal, @Param('queue') queue: string) {
    return this.queues.depth(queue, principal.namespaceId);
  }

  /**
   * Reads dispatch limits from the queue's task definition.
   *
   * A queue with no definition is unconstrained rather than blocked. Task
   * definitions are optional, and requiring one merely to run a task would make
   * the simplest possible workflow need two registrations.
   */
  private async dispatchPolicyFor(namespaceId: string, queue: string) {
    // `charge:eu-west` is the *queue*; the task definition is `charge`. Looking
    // the definition up by queue name finds nothing for any domained queue, so
    // its concurrency caps, rate limits and semaphores would all silently stop
    // applying — the same class of bug as dropping the domain in the first
    // place, one layer along.
    const { taskDefName } = parseQueueName(queue);
    const def = (await this.metadata.loadTaskDefs(namespaceId, [taskDefName])).get(taskDefName);
    if (!def) return undefined;

    return {
      concurrentExecLimit: def.concurrentExecLimit,
      rateLimitPerFrequency: def.rateLimitPerFrequency,
      rateLimitFrequencySeconds: def.rateLimitFrequencySeconds,
      semaphores: def.semaphores,
    };
  }

  /**
   * Per-queue scope check.
   *
   * Not `@RequireScopes`, because the scope required depends on a path
   * parameter the decorator cannot see. Same rule, evaluated a moment later.
   */
  private assertMayLease(principal: Principal, queue: string): void {
    if (!hasScope(principal, queueScope(queue))) {
      throw new ForbiddenException({
        error: 'insufficient_scope',
        message: `missing scope: ${queueScope(queue)}`,
        required: [queueScope(queue)],
      });
    }
  }
}

/**
 * Task-level operations, addressed by task id rather than by queue.
 *
 * Separate from the queue routes because these are keyed on the task the worker
 * already holds; nesting them under a queue path would put the same identifier
 * in two places and invite them to disagree.
 */
@Controller('ns/:ns/tasks')
export class TaskController {
  constructor(
    private readonly dispatch: TaskDispatchService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logs: TaskLogRepository
  ) {}

  /**
   * Appends log lines for a task the caller is running.
   *
   * Fenced on the lease token, like a result: only the worker holding the task
   * can write its log. Batched, because a worker that makes one request per
   * line spends more time logging than working.
   */
  @Post(':taskId/logs')
  @RequireScopes(Scope.TASKS_REPORT)
  @HttpCode(202)
  @ApiRoute({
    summary: 'Append log lines to a running task',
    description:
      'Only the worker holding the lease may write. Lines are capped in length and per ' +
      'task; beyond the cap they are dropped with a marker line saying so.',
    tags: ['workers'],
    body: logsSchema,
  })
  async appendLogs(
    @CurrentPrincipal() principal: Principal,
    @Param('taskId') taskId: string,
    @Body(zodBody(logsSchema)) body: z.infer<typeof logsSchema>
  ) {
    const outcome = await this.logs.append({
      namespaceId: principal.namespaceId,
      workflowId: body.workflowId,
      taskId,
      leaseToken: body.leaseToken,
      entries: body.logs,
    });

    if (outcome === 'not_found') {
      throw new NodeFlowError(
        ErrorCode.LEASE_EXPIRED,
        `logs for task ${taskId} were refused: the task does not exist here or its lease is not held`
      );
    }
    return { taskId, accepted: body.logs.length };
  }

  /**
   * Extends a lease on a long-running task.
   *
   * Without this, a task that legitimately outlives its lease is reclaimed and
   * run twice. It is also what makes `heartbeatTimeout` meaningful: a worker
   * that dies mid-task stops sending them, and the task is reclaimed promptly
   * rather than at the end of a long lease.
   */
  @Post(':taskId/heartbeat')
  @RequireScopes(Scope.TASKS_REPORT)
  @HttpCode(200)
  @ApiRoute({
    summary: 'Extend the lease on a long-running task',
    description: '409 if the lease is gone, so a worker can abandon work that would be refused.',
    tags: ['workers'],
    body: heartbeatSchema,
  })
  async heartbeat(
    @CurrentPrincipal() principal: Principal,
    @Param('taskId') taskId: string,
    @Body(zodBody(heartbeatSchema)) body: z.infer<typeof heartbeatSchema>
  ) {
    const renewed = await this.dispatch.heartbeat(
      body.queueName,
      taskId,
      body.leaseToken,
      body.leaseSeconds ?? this.config.NODE_FLOW_DEFAULT_LEASE_SECONDS
    );

    // The lease is gone, so this worker's result would be refused too. Saying
    // so now lets it abandon the work rather than finish and be rejected.
    if (!renewed) {
      throw new NodeFlowError(
        ErrorCode.LEASE_EXPIRED,
        `lease on task ${taskId} has expired or was reclaimed`
      );
    }

    return { taskId, renewed: true };
  }

  /**
   * Reports a terminal result.
   *
   * Fenced on the lease token in the repository. A worker whose lease expired
   * mid-task cannot overwrite the result of whoever picked the task up next,
   * which is the one thing that makes lease expiry safe at all.
   */
  @Post(':taskId/report')
  @RequireScopes(Scope.TASKS_REPORT)
  @HttpCode(200)
  @ApiRoute({
    summary: 'Report a terminal result',
    description:
      'Fenced on the lease token: a worker whose lease expired cannot overwrite the ' +
      'result of whoever holds the task now.',
    tags: ['workers'],
    body: reportSchema,
  })
  async report(
    @CurrentPrincipal() principal: Principal,
    @Param('taskId') taskId: string,
    @Body(zodBody(reportSchema)) body: z.infer<typeof reportSchema>
  ) {
    const accepted = await this.dispatch.report({
      namespaceId: principal.namespaceId,
      queueName: body.queueName,
      workflowId: body.workflowId,
      taskId,
      leaseToken: body.leaseToken,
      status: body.status,
      output: body.output as Record<string, JsonValue> | undefined,
      reason: body.reason,
    });

    // 409, not 200-with-a-flag. A worker that silently has its result discarded
    // reports success upstream and the discrepancy surfaces much later.
    if (!accepted) {
      throw new NodeFlowError(
        ErrorCode.LEASE_EXPIRED,
        `result for task ${taskId} was refused: the lease is no longer held`
      );
    }

    return { taskId, accepted: true };
  }
}

@Module({ controllers: [QueueController, TaskController] })
export class QueueModule {}
