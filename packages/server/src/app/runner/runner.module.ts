import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  ConcurrencyRepository,
  DecideNotifier,
  Evaluator,
  DecideQueueRepository,
  EventExecutionRepository,
  HumanTaskRepository,
  OutboxRelay,
  PartitionManager,
  PayloadGarbageCollector,
  StuckWorkflowSweeper,
  SystemTaskRunner,
  TaskDispatchService,
  SchedulerRunner,
  ScheduleRepository,
  TimeoutSweeper,
  WorkflowRepository,
  runnersForRoles,
  type RunnerHost,
} from '@node-flow-dev/store';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/**
 * Starts and stops the background loops with the application.
 *
 * The loops themselves live in `store` and know nothing about Nest — they are
 * plain classes driven by `setTimeout`. This module is the only thing that ties
 * them to a process lifecycle, which is what lets the same runners be driven by
 * a test, a CLI or a future worker binary.
 *
 * `NODE_FLOW_ROLES` decides which loops this process holds. An `api`-only
 * process starts none, so request latency never competes with a partition roll.
 */
@Injectable()
export class RunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RunnerService.name);
  private host?: RunnerHost;
  private deciderWakeups?: DecideNotifier;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly evaluator: Evaluator,
    private readonly decideQueue: DecideQueueRepository,
    private readonly timeoutSweeper: TimeoutSweeper,
    private readonly outboxRelay: OutboxRelay,
    private readonly dispatch: TaskDispatchService,
    private readonly concurrency: ConcurrencyRepository,
    private readonly partitions: PartitionManager,
    private readonly stuckWorkflows: StuckWorkflowSweeper,
    private readonly payloadGc: PayloadGarbageCollector,
    private readonly systemTasks: SystemTaskRunner,
    private readonly scheduler: SchedulerRunner,
    private readonly humanTasks: HumanTaskRepository,
    private readonly workflows: WorkflowRepository,
    private readonly eventMonitor: EventExecutionRepository,
    private readonly schedules: ScheduleRepository
  ) {}

  /**
   * `onApplicationBootstrap`, not `onModuleInit`.
   *
   * Bootstrap runs after every module has initialised, so the decider cannot
   * start evaluating against a half-wired container — or, worse, against a
   * database whose migrations are still running.
   */
  onApplicationBootstrap(): void {
    const roles = this.config.NODE_FLOW_ROLES;

    this.host = runnersForRoles(
      roles,
      {
        evaluator: this.evaluator,
        decideQueue: this.decideQueue,
        timeoutSweeper: this.timeoutSweeper,
        outboxRelay: this.outboxRelay,
        dispatch: this.dispatch,
        concurrency: this.concurrency,
        partitions: this.partitions,
        stuckWorkflows: this.stuckWorkflows,
        payloadGc: this.payloadGc,
        systemTasks: this.systemTasks,
        scheduler: this.scheduler,
        humanTasks: this.humanTasks,
        taskCache: this.workflows,
        admission: this.workflows,
        eventMonitor: this.eventMonitor,
        scheduleRuns: this.schedules,
      },
      {},
      // Routed through Nest's logger rather than the runner's default `console`,
      // so a failing sweeper appears in the same stream as everything else — a
      // background loop failing where nobody looks is how a silent outage starts.
      (error, name) => this.logger.error(`runner "${name}" failed`, error)
    );

    this.host.start();

    // Turns the decider from polled into triggered. Started after the runners
    // so a notification arriving immediately has something to wake, and only
    // where this process actually holds a decider — an `api` replica listening
    // would keep a connection open to wake a loop it does not have.
    if (roles.includes('decider')) {
      const host = this.host;
      this.deciderWakeups = new DecideNotifier({
        url: this.config.DATABASE_URL,
        onWake: () => host.wake('decider'),
        onError: (error) =>
          this.logger.warn(`decider wake-up listener: ${(error as Error).message}`),
      });
      // Not awaited: the loop is already correct without it, and a database
      // that is slow to accept a second connection must not delay boot.
      void this.deciderWakeups.start().catch((error: Error) => {
        this.logger.warn(`decider wake-up listener could not start: ${error.message}`);
      });
    }

    const names = this.host.stats().map((s) => s.name);
    this.logger.log(
      names.length > 0
        ? `Roles [${roles.join(', ')}] running: ${names.join(', ')}`
        : `Roles [${roles.join(', ')}] hold no background runners`
    );
  }

  /**
   * Stops the loops and waits for any pass in flight.
   *
   * Registered before `DatabaseModule` closes the pool — Nest runs shutdown
   * hooks in reverse module order — so no runner is mid-transaction when the
   * connections go away. Killed mid-batch, a relay leaves events claimed but
   * unpublished and a dispatcher leaves leases to expire on a timeout.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    if (!this.host) return;
    this.logger.log(`Stopping background runners${signal ? ` (${signal})` : ''}`);
    await this.deciderWakeups?.stop();
    await this.host.stop();
    // After the loops stop leasing, wait for the system tasks already running.
    // Abandoning them mid-HTTP-call leaves the lease to expire and the task to
    // be run a second time.
    await this.systemTasks.drain();
  }

  /** Exposed for the health endpoint and for tests. */
  stats() {
    return this.host?.stats() ?? [];
  }
}

@Module({
  providers: [RunnerService],
  exports: [RunnerService],
})
export class RunnerModule {}
