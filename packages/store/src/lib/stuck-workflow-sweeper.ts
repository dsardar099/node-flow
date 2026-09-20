import { NON_TERMINAL_TASK_STATUSES, type TaskStatus } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import { DecideQueueRepository } from './decide-queue.repository.js';

/**
 * Finds workflows that have quietly stopped making progress.
 *
 * A stuck workflow is `RUNNING` with **nothing that could ever wake it**: no
 * unfinished task, no armed timer, and no pending evaluation. Every path that
 * normally drives it forward has ended without reaching a terminal state.
 *
 * This is defence in depth, not a mechanism the engine relies on. The claim
 * ordering, the outbox and the timer sweeper are each designed so a wakeup
 * cannot be lost — **this sweeper should never find anything.** A hit means one
 * of those invariants was violated, so it is worth alerting on rather than
 * quietly fixing: re-enqueueing recovers the workflow, but the underlying bug
 * stays until someone looks.
 */
export interface StuckWorkflow {
  workflowId: string;
  namespaceId: string;
  startedAt: Date;
}

export class StuckWorkflowSweeper {
  constructor(
    private readonly db: Db,
    private readonly decideQueue: DecideQueueRepository
  ) {}

  /**
   * Lists stuck workflows without changing anything.
   *
   * `minimumAgeSeconds` avoids false positives: a workflow mid-evaluation
   * legitimately has no queued wakeup for the moment its transaction is open.
   * Only something idle for a while is genuinely stuck.
   */
  async find(limit = 100, minimumAgeSeconds = 300): Promise<StuckWorkflow[]> {
    const rows = await this.db
      .selectFrom('WorkflowExecutions as w')
      .select(['w.id as workflowId', 'w.namespaceId as namespaceId', 'w.startedAt as startedAt'])
      .where('w.status', '=', 'RUNNING')
      // Waiting for a rate-limit slot is not stuck; waking it would do nothing.
      .where((eb) => eb.or([eb('w.rateLimitKey', 'is', null), eb('w.admittedAt', 'is not', null)]))
      .where('w.updatedAt', '<', sql<Date>`now() - make_interval(secs => ${minimumAgeSeconds})`)
      // Nothing unfinished.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('TaskExecutions as t')
              .select('t.id')
              .whereRef('t.workflowId', '=', 'w.id')
              .where('t.status', 'in', NON_TERMINAL_TASK_STATUSES as unknown as TaskStatus[])
          )
        )
      )
      // Nothing armed to fire.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('Timers as tm')
              .select('tm.id')
              .whereRef('tm.workflowId', '=', 'w.id')
          )
        )
      )
      // Nothing queued to evaluate it.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('DecideQueues as d')
              .select('d.workflowId')
              .whereRef('d.workflowId', '=', 'w.id')
          )
        )
      )
      .limit(limit)
      .execute();

    return rows;
  }

  /**
   * Recovers stuck workflows by requesting an evaluation.
   *
   * Returns how many were found, which is the number that matters
   * operationally: it should be zero, and anything else is a bug report.
   */
  async sweep(limit = 100, minimumAgeSeconds = 300): Promise<number> {
    const stuck = await this.find(limit, minimumAgeSeconds);

    for (const workflow of stuck) {
      await this.decideQueue.enqueue(
        workflow.namespaceId,
        workflow.workflowId,
        'recovered by stuck-workflow sweeper'
      );
    }

    return stuck.length;
  }
}
