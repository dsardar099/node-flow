import { BackgroundRunner, RunnerHost } from './background-runner.js';
import type { ConcurrencyRepository } from './concurrency.repository.js';
import type { DecideQueueRepository } from './decide-queue.repository.js';
import type { Evaluator } from './evaluator.js';
import type { OutboxRelay } from './outbox-relay.js';
import type { PartitionManager } from './partition-manager.js';
import type { PayloadGarbageCollector } from './payload-gc.js';
import type { SchedulerRunner } from './scheduler.runner.js';
import type { StuckWorkflowSweeper } from './stuck-workflow-sweeper.js';
import type { SystemTaskRunner } from './system-task.runner.js';
import type { TaskDispatchService } from './task-dispatch.service.js';
import type { TimeoutSweeper } from './timeout-sweeper.js';

/**
 * Assembles the engine's background loops and selects them by role.
 *
 * One deployable process, role-flagged, so the parts scale independently:
 *
 *  - **`api`** serves HTTP and holds no loops. Request latency should never
 *    compete with a partition roll.
 *  - **`decider`** drains the evaluation queue. This is the part that scales
 *    with workflow volume, and the part that must never be starved by a
 *    long-running maintenance pass.
 *  - **`poller`** runs everything time-driven: deadlines, the outbox, abandoned
 *    leases, expired permits, partitions and garbage — and the system-task
 *    executor, which is not time-driven but is the same shape: lease a batch,
 *    do the work, report. Several of these are
 *    cluster-wide singletons in spirit — they are safe to run on every replica
 *    only because each claims its work with `SKIP LOCKED` rather than assuming
 *    it is alone.
 *
 * `NODE_FLOW_ROLES=api,decider,poller` in one process is the development
 * default; production splits them.
 */

export type EngineRole = 'api' | 'decider' | 'poller';

export const ALL_ROLES: EngineRole[] = ['api', 'decider', 'poller'];

/**
 * Parses `NODE_FLOW_ROLES`.
 *
 * An unset value means all roles — a single process that just works. An
 * *invalid* value throws rather than falling back: silently running with no
 * decider produces a cluster where every workflow starts and none progresses,
 * and the cause is a typo nobody would think to look for.
 */
export function parseRoles(value: string | undefined): EngineRole[] {
  if (!value || value.trim() === '') return [...ALL_ROLES];

  const roles = value
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role.length > 0);

  const invalid = roles.filter((role) => !ALL_ROLES.includes(role as EngineRole));
  if (invalid.length > 0) {
    throw new Error(
      `unknown NODE_FLOW_ROLES value(s): ${invalid.join(', ')} (expected ${ALL_ROLES.join(', ')})`
    );
  }

  return [...new Set(roles as EngineRole[])];
}

export interface EngineRunnerComponents {
  evaluator: Evaluator;
  decideQueue: DecideQueueRepository;
  timeoutSweeper: TimeoutSweeper;
  outboxRelay: OutboxRelay;
  dispatch: TaskDispatchService;
  concurrency: ConcurrencyRepository;
  partitions?: PartitionManager;
  stuckWorkflows?: StuckWorkflowSweeper;
  payloadGc?: PayloadGarbageCollector;
  scheduler?: SchedulerRunner;
  /** Executes the task types the server implements itself. */
  systemTasks?: SystemTaskRunner;
  /** Moves unclaimed human tasks along their assignment chains. */
  humanTasks?: { escalate(limit?: number): Promise<number> };
  /** Removes expired task output cache entries. */
  taskCache?: { pruneTaskOutputCache(limit?: number): Promise<number> };
  /** Lets rate-limited executions in as their keys free up. */
  admission?: { admitWaiting(limit?: number): Promise<{ id: string; namespaceId: string }[]> };
  /** Removes event monitor rows past their retention window. */
  eventMonitor?: { prune(retentionDays?: number, limit?: number): Promise<number> };
  /** Removes schedule firing history past its retention window. */
  scheduleRuns?: { pruneRuns(retentionDays?: number, limit?: number): Promise<number> };
}

export interface EngineRunnerIntervals {
  decide?: number;
  timeouts?: number;
  outbox?: number;
  abandonedLeases?: number;
  semaphores?: number;
  rateLimits?: number;
  partitions?: number;
  stuckWorkflows?: number;
  payloadGc?: number;
  scheduler?: number;
  systemTasks?: number;
  humanTaskEscalation?: number;
  taskCachePrune?: number;
  admission?: number;
  eventMonitorPrune?: number;
  scheduleRunsPrune?: number;
  /** How many workflows one decider pass evaluates at once. */
  deciderConcurrency?: number;
}

/**
 * Defaults chosen by how quickly each failure hurts.
 *
 * Evaluation and timeouts are on the critical path of every workflow, so they
 * are sub-second and one second. Partition maintenance only has to happen
 * before the next period begins, and the stuck-workflow sweeper is looking for
 * something that should never happen at all — running either often would burn
 * database work to find nothing.
 */
const DEFAULT_INTERVALS: Required<EngineRunnerIntervals> = {
  decide: 200,
  timeouts: 1_000,
  outbox: 500,
  abandonedLeases: 5_000,
  semaphores: 15_000,
  rateLimits: 300_000,
  partitions: 900_000,
  stuckWorkflows: 300_000,
  payloadGc: 3_600_000,
  // Every ten seconds. Cron resolution is one minute, so this is frequent
  // enough that a firing is never noticeably late and rare enough that an idle
  // install is not querying constantly.
  scheduler: 10_000,
  /**
   * As responsive as the decider. A system task is on the critical path of the
   * workflow that scheduled it, exactly like a worker task — the only
   * difference is who runs it.
   */
  systemTasks: 200,
  /** SLAs are in minutes; checking twice a minute keeps escalation within one of its deadline. */
  humanTaskEscalation: 30_000,
  taskCachePrune: 3_600_000,
  /** A queued start should not wait noticeably longer than its slot takes to free. */
  admission: 1_000,
  eventMonitorPrune: 3_600_000,
  scheduleRunsPrune: 3_600_000,
  /**
   * Four at a time.
   *
   * Evaluation is mostly database round trips rather than CPU, so serialising
   * it leaves both the pool and the database idle while each workflow waits its
   * turn. Four keeps a decider well inside a default ten-connection pool while
   * removing most of the queueing a batch otherwise imposes on itself.
   */
  deciderConcurrency: 4,
};

/** Batch sizes. `drainThreshold` is set to these, so a full batch runs again at once. */
const BATCH = { decide: 50, timeouts: 100, outbox: 100, leases: 100, systemTasks: 20 } as const;

export function runnersForRoles(
  roles: EngineRole[],
  components: EngineRunnerComponents,
  intervals: EngineRunnerIntervals = {},
  onError?: (error: unknown, name: string) => void
): RunnerHost {
  const every = { ...DEFAULT_INTERVALS, ...intervals };
  const runners: BackgroundRunner[] = [];
  const add = (
    name: string,
    intervalMs: number,
    run: () => Promise<number>,
    drainThreshold = 0
  ) => runners.push(new BackgroundRunner({ name, intervalMs, run, drainThreshold, onError }));

  if (roles.includes('decider')) {
    add(
      'decider',
      every.decide,
      async () => {
        // Peek is advisory — two deciders may well be handed the same workflow.
        // The claim inside `evaluate` is what actually arbitrates, so a
        // duplicate here costs one wasted transaction and nothing else.
        const batch = await components.decideQueue.peekBatch(BATCH.decide);
        let evaluated = 0;

        // Evaluations of *different* workflows are independent — each takes its
        // own row lock and is arbitrated by its own claim — so running them one
        // at a time makes every workflow in a batch wait behind the ones ahead
        // of it. With ten workflows in flight that is nine evaluations of
        // latency added to each step, which the load harness shows directly.
        //
        // Bounded rather than unbounded: a batch of fifty evaluations launched
        // at once would take fifty connections from a pool sized for the whole
        // process, and starving the API to speed up the decider is a poor
        // trade. The bound is deliberately below a default pool.
        await mapWithConcurrency(batch, every.deciderConcurrency, async (entry) => {
          const outcome = await components.evaluator.evaluate(entry.workflowId);
          if (outcome.evaluated) evaluated++;
        });

        return evaluated;
      },
      BATCH.decide
    );
  }

  if (roles.includes('poller')) {
    add('timeouts', every.timeouts, () => components.timeoutSweeper.sweep(BATCH.timeouts), BATCH.timeouts);

    add(
      'outbox',
      every.outbox,
      async () => {
        const result = await components.outboxRelay.relay(BATCH.outbox);
        // Draining counts everything the batch consumed, not just successes: a
        // backlog of permanently failing events still has to be worked through.
        return result.delivered + result.failed + result.deadLettered;
      },
      BATCH.outbox
    );

    add(
      'abandoned-leases',
      every.abandonedLeases,
      () => components.dispatch.reclaimAbandoned(BATCH.leases),
      BATCH.leases
    );

    add('expired-permits', every.semaphores, () => components.concurrency.expireStaleHolders());
    add('rate-limit-windows', every.rateLimits, () => components.concurrency.pruneRateLimitWindows());

    if (components.partitions) {
      const partitions = components.partitions;
      add('partitions', every.partitions, async () => {
        const result = await partitions.maintain();
        return result.created.length + result.dropped.length;
      });
    }

    if (components.stuckWorkflows) {
      const stuck = components.stuckWorkflows;
      add('stuck-workflows', every.stuckWorkflows, () => stuck.sweep());
    }

    if (components.systemTasks) {
      const system = components.systemTasks;
      add('system-tasks', every.systemTasks, () => system.runBatch(), BATCH.systemTasks);
    }

    if (components.payloadGc) {
      const gc = components.payloadGc;
      add('payload-gc', every.payloadGc, () => gc.collect());
    }

    if (components.humanTasks) {
      const humanTasks = components.humanTasks;
      add('human-task-escalation', every.humanTaskEscalation, () => humanTasks.escalate(100), 100);
    }

    if (components.admission) {
      const admission = components.admission;
      add(
        'workflow-admission',
        every.admission,
        async () => {
          const admitted = await admission.admitWaiting(200);
          // After commit, deliberately: a crash in between leaves an admitted
          // execution with nothing to wake it, which the stuck sweeper recovers.
          for (const entry of admitted) {
            await components.decideQueue.enqueue(entry.namespaceId, entry.id, 'admitted');
          }
          return admitted.length;
        },
        200
      );
    }

    if (components.eventMonitor) {
      const monitor = components.eventMonitor;
      add('event-monitor-prune', every.eventMonitorPrune, () => monitor.prune(7, 5000), 5000);
    }

    if (components.scheduleRuns) {
      const history = components.scheduleRuns;
      add('schedule-runs-prune', every.scheduleRunsPrune, () => history.pruneRuns(30, 5000), 5000);
    }

    if (components.taskCache) {
      const cache = components.taskCache;
      add('task-cache-prune', every.taskCachePrune, () => cache.pruneTaskOutputCache(1000), 1000);
    }

    if (components.scheduler) {
      const scheduler = components.scheduler;
      // Safe on every replica: claiming is leased, so a second poller ticking
      // at the same instant finds nothing to claim rather than firing again.
      add('scheduler', every.scheduler, async () => (await scheduler.tick()).started);
    }
  }

  return new RunnerHost(runners);
}

/**
 * Runs `work` over `items`, at most `limit` at a time.
 *
 * Written out rather than pulled in: the whole job is a handful of workers
 * pulling from a shared cursor, and a dependency for it would be a dependency
 * inside the engine's hot loop.
 *
 * Failures are **not** swallowed. A rejected evaluation must reach the runner,
 * which logs it and keeps the loop alive; catching it here would turn a
 * database outage into a decider that quietly evaluates nothing.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  if (items.length <= 1 || limit <= 1) {
    for (const item of items) await work(item);
    return;
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      await work(items[cursor++]);
    }
  });

  await Promise.all(workers);
}
