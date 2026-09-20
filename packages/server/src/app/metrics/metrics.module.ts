import { Controller, Get, Header, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { Scope } from '@node-flow-dev/core';
import { EngineMetrics, type Db } from '@node-flow-dev/store';
import { Registry, collectDefaultMetrics, Gauge } from 'prom-client';
import { RequireScopes } from '../auth/auth.decorators.js';
import { DB } from '../database/database.module.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';
import { RunnerModule, RunnerService } from '../runner/runner.module.js';

/**
 * Prometheus metrics.
 *
 * Two families, gathered differently on purpose:
 *
 *  - **Engine gauges** are collected at scrape time from the database, because
 *    they describe cluster-wide state that no single replica knows. Queue depth
 *    is not this process's queue depth.
 *  - **Runner counters** come from the in-process loops, because they describe
 *    what *this* replica did.
 *
 * Default Node metrics — event loop lag, heap, GC pauses — are included.
 * Event loop lag matters more here than in most services: the decider is
 * single-threaded, so lag is the difference between a workflow advancing and it
 * waiting, and it is the first thing to move when CPU-bound work leaks onto the
 * main thread.
 */

/** Namespaced so a shared Prometheus can distinguish these from anything else. */
const PREFIX = 'node_flow_';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  constructor(
    private readonly engine: EngineMetrics,
    private readonly runners: RunnerService
  ) {}

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry, prefix: PREFIX });
    this.registerEngineGauges();
    this.registerRunnerGauges();
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Gauges sourced from the database on scrape.
   *
   * `collect()` rather than a background timer: a gauge updated on a timer is
   * stale by an unknown amount and keeps querying even when nobody is looking.
   * `EngineMetrics` caches for a few seconds, so several replicas scraped at
   * once do not each hammer the same counts.
   */
  private registerEngineGauges(): void {
    const gauges: Array<[string, string, (g: Awaited<ReturnType<EngineMetrics['gauges']>>) => number]> = [
      [
        'decide_queue_depth',
        'Workflows waiting to be evaluated. The clearest measure of decider lag.',
        (g) => g.decideQueueDepth,
      ],
      [
        'decide_queue_oldest_seconds',
        'Age of the oldest pending evaluation. Depth alone cannot tell a drained burst from a stall.',
        (g) => g.decideQueueOldestSeconds,
      ],
      ['tasks_ready', 'Tasks queued and visible to workers.', (g) => g.tasksReady],
      ['tasks_leased', 'Tasks currently held by a worker.', (g) => g.tasksLeased],
      [
        'tasks_delayed',
        'Tasks waiting out a retry backoff. Counted nowhere else, and the signal during a retry storm.',
        (g) => g.tasksDelayed,
      ],
      [
        'timers_overdue',
        'Timers past their fire time but not yet swept. Rising means the sweeper is behind.',
        (g) => g.timersOverdue,
      ],
      ['outbox_pending', 'Outbox events awaiting delivery.', (g) => g.outboxPending],
      [
        'outbox_dead_lettered',
        'Outbox events that exhausted their attempts. Never expected to be non-zero.',
        (g) => g.outboxDeadLettered,
      ],
      ['workflows_running', 'Executions in RUNNING or PAUSED.', (g) => g.workflowsRunning],
    ];

    const engine = this.engine;

    for (const [name, help, read] of gauges) {
      new Gauge({
        name: `${PREFIX}${name}`,
        help,
        registers: [this.registry],
        // `collect` runs per scrape. All nine share one cached reading, so a
        // scrape is one query rather than nine.
        collect: async function (this: Gauge) {
          this.set(read(await engine.gauges()));
        },
      });
    }
  }

  /**
   * What this replica's background loops have done.
   *
   * Per-runner labels are safe here — the set is fixed and small, unlike queue
   * names. `errors` is the one to alert on: a loop that throws every pass keeps
   * running by design, so nothing else would reveal it.
   */
  private registerRunnerGauges(): void {
    const spec: Array<[string, string, 'passes' | 'items' | 'errors']> = [
      ['runner_passes_total', 'Batches this runner has executed.', 'passes'],
      ['runner_items_total', 'Items this runner has processed.', 'items'],
      [
        'runner_errors_total',
        'Passes that threw. A loop survives its own errors, so this is the only sign.',
        'errors',
      ],
    ];

    const runners = this.runners;

    for (const [name, help, field] of spec) {
      new Gauge({
        name: `${PREFIX}${name}`,
        help,
        labelNames: ['runner'],
        registers: [this.registry],
        // Counters would be more idiomatic, but the runners already own these
        // totals; mirroring them into a Counter means two sources that can
        // disagree. A gauge read from the authoritative number cannot.
        collect: function (this: Gauge<'runner'>) {
          for (const stats of runners.stats()) {
            this.set({ runner: stats.name }, stats[field]);
          }
        },
      });
    }
  }
}

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /**
   * The scrape endpoint.
   *
   * Authenticated, unlike the usual unprotected `/metrics`. These gauges expose
   * install-wide backlog and execution counts, which is exactly the shape of
   * information a tenant should not be able to read about the cluster — and a
   * Prometheus scraper can hold a key as easily as anything else.
   */
  @Get()
  @RequireScopes(Scope.METRICS_READ)
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiRoute({
    summary: 'Prometheus exposition',
    description:
      'Requires the `metrics:read` scope. Alert on decide_queue_oldest_seconds, ' +
      'timers_overdue and outbox_dead_lettered — each moves before users notice.',
    tags: ['operations'],
  })
  scrape(): Promise<string> {
    return this.metrics.render();
  }
}

@Module({
  // RunnerModule exports RunnerService, whose counters this module reads.
  imports: [RunnerModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    {
      provide: EngineMetrics,
      inject: [DB],
      useFactory: (db: Db) => new EngineMetrics(db),
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
