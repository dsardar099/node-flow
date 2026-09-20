import { isWorkflowTerminal, type JsonValue } from '@node-flow-dev/core';
import type { Db } from './database.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { MetadataRepository } from './metadata.repository.js';
import { ScheduleRepository, type DueFiring, type Schedule } from './schedule.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Turns due schedules into executions.
 *
 * The whole pass is one transaction per batch: claim with `SKIP LOCKED`, start
 * what is due, advance `nextRunAt`, commit. A second poller running at the same
 * instant claims nothing and does nothing, which is the property that makes
 * running several replicas safe — and the reason this is not
 * `@nestjs/schedule`, where N replicas fire N times.
 *
 * A failure to start one schedule must not lose the others, so each is handled
 * on its own and its error recorded on its row. The alternative — one throw
 * aborting the batch — would let a single schedule pointing at a deleted
 * definition stop every other schedule in the install.
 */

export interface SchedulerOptions {
  /** Schedules claimed per pass. */
  batchSize?: number;
  onError?: (error: unknown, context: { scheduleId?: string; name?: string }) => void;
}

export interface SchedulerResult {
  claimed: number;
  started: number;
  skipped: number;
  failed: number;
}

export class SchedulerRunner {
  private readonly batchSize: number;

  constructor(
    private readonly db: Db,
    private readonly schedules: ScheduleRepository,
    private readonly workflows: WorkflowRepository,
    private readonly metadata: MetadataRepository,
    private readonly decideQueue: DecideQueueRepository,
    private readonly options: SchedulerOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 50;
  }

  async tick(now = new Date()): Promise<SchedulerResult> {
    return this.db.transaction().execute(async (tx) => {
      const due = await this.schedules.claimDue(this.batchSize, tx, now);
      const result: SchedulerResult = { claimed: due.length, started: 0, skipped: 0, failed: 0 };

      for (const schedule of due) {
        const { firings, nextRunAt } = this.schedules.plan(schedule, now);

        try {
          const started = await this.fire(schedule, firings, tx);

          result.started += started.length;
          result.skipped += firings.length - started.length;

          await this.schedules.recordRun(
            schedule.id,
            {
              nextRunAt,
              ...(started.length
                ? { ranAt: now, workflowId: started[started.length - 1] }
                : {}),
              fired: started.length,
            },
            tx
          );
        } catch (error) {
          result.failed += 1;
          this.options.onError?.(error, { scheduleId: schedule.id, name: schedule.name });
          await this.schedules.recordFirings(
            schedule,
            firings.map((firing) => ({
              scheduledFor: firing.scheduledFor,
              outcome: 'FAILED',
              reason: error instanceof Error ? error.message : String(error),
            })),
            tx
          );

          // The schedule still advances. Leaving `nextRunAt` in the past would
          // make the poller re-claim it every pass forever, and a definition
          // that was deleted is not going to come back before the next tick.
          await this.schedules.recordRun(
            schedule.id,
            {
              nextRunAt,
              error: error instanceof Error ? error.message : String(error),
              fired: 0,
            },
            tx
          );
        }
      }

      return result;
    });
  }

  /** Starts the chosen firings, honouring the overlap policy. */
  private async fire(
    schedule: Schedule,
    firings: DueFiring[],
    tx: Db | Parameters<typeof this.workflows.start>[1]
  ): Promise<string[]> {
    if (firings.length === 0) return [];

    if (schedule.overlapPolicy === 'SKIP' && (await this.isPreviousRunLive(schedule))) {
      await this.schedules.recordFirings(
        schedule,
        firings.map((firing) => ({
          scheduledFor: firing.scheduledFor,
          outcome: 'SKIPPED',
          reason: `the previous run ${schedule.lastWorkflowId} was still running`,
        })),
        tx as never
      );
      return [];
    }

    // Resolved once per pass, not once per firing: a catch-up burst must not
    // straddle a version change halfway through.
    const version = await this.resolveVersion(schedule);
    const started: string[] = [];

    for (const firing of firings) {
      const execution = await this.workflows.start(
        {
          namespaceId: schedule.namespaceId,
          defName: schedule.defName,
          defVersion: version,
          input: {
            ...schedule.input,
            // What the schedule thought the time was, which is not always now —
            // a catch-up run needs to know which window it is producing.
            _schedule: {
              name: schedule.name,
              scheduledFor: firing.scheduledFor.toISOString(),
            } as JsonValue,
          },
          correlationId: schedule.correlationId ?? undefined,
          priority: schedule.priority,
          idempotencyKey: firing.idempotencyKey,
        },
        tx as never
      );

      await this.decideQueue.enqueue(
        schedule.namespaceId,
        execution.id,
        `schedule ${schedule.name}`,
        tx as never
      );

      started.push(execution.id);
    }

    await this.schedules.recordFirings(
      schedule,
      firings.map((firing, index) => ({ scheduledFor: firing.scheduledFor, outcome: 'STARTED', workflowId: started[index] })),
      tx as never
    );
    return started;
  }

  /**
   * Whether the previous run is still going.
   *
   * Read outside the poller's transaction on purpose: it is a question about
   * another workflow's state, and taking a lock on it would let a long-running
   * scheduled execution block the poller for every *other* schedule.
   */
  private async isPreviousRunLive(schedule: Schedule): Promise<boolean> {
    if (!schedule.lastWorkflowId) return false;

    const previous = await this.workflows.findById(schedule.lastWorkflowId);
    return previous !== undefined && !isWorkflowTerminal(previous.status);
  }

  /**
   * The version to run, checked to exist.
   *
   * Checked even when the schedule pins a version. The first version of this
   * only looked up unpinned schedules, so a schedule naming a deleted
   * definition behaved differently depending on whether it had pinned one: an
   * unpinned schedule recorded a clear error on its row, while a pinned one
   * happily started an execution that failed later for an unrelated-looking
   * reason. "Why isn't my schedule running?" deserves the same answer either
   * way, and the lookup is served from the blueprint cache.
   */
  private async resolveVersion(schedule: Schedule): Promise<number> {
    if (schedule.defVersion === null) {
      const latest = await this.metadata.latestVersion(schedule.namespaceId, schedule.defName);
      if (latest === undefined) {
        throw new Error(`no workflow definition "${schedule.defName}"`);
      }
      return latest;
    }

    const pinned = await this.metadata.definitionExists(
      schedule.namespaceId,
      schedule.defName,
      schedule.defVersion
    );

    if (!pinned) {
      throw new Error(
        `no workflow definition "${schedule.defName}" version ${schedule.defVersion}`
      );
    }

    return schedule.defVersion;
  }
}
