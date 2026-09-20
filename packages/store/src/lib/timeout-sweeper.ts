import { TaskStatus, WorkflowStatus, isTaskTerminal, type JsonValue } from '@node-flow-dev/core';
import { failureWorkflowStart } from '@node-flow-dev/engine';
import type { Db } from './database.js';
import type { BlueprintLoader } from './evaluator.js';
import type { OutboxRepository } from './outbox.repository.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { TimerRepository, type DueTimer } from './timer.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Fires due timers.
 *
 * Every deadline in the system ends up here: a task nobody picked up, a worker
 * that went silent, a workflow that overran its budget. Without this the
 * policies are stored, the timers are written, and nothing ever happens — a
 * hung task waits forever with no error to explain it.
 *
 * Each timer is handled in its own transaction so one poisonous row cannot
 * block the rest, and every effect commits with the removal of the timer that
 * caused it.
 */
export class TimeoutSweeper {
  constructor(
    private readonly db: Db,
    private readonly timers: TimerRepository,
    private readonly workflows: WorkflowRepository,
    private readonly decideQueue: DecideQueueRepository,
    /**
     * For starting a definition's failure workflow when the *workflow* times
     * out. That transition happens here rather than in the decider, so without
     * this a run that failed by overrunning its budget never started the
     * compensation its definition declared.
     */
    private readonly failures?: { blueprints: BlueprintLoader; outbox: OutboxRepository }
  ) {}

  /** Processes one batch of due timers. Returns how many fired. */
  async sweep(limit = 100): Promise<number> {
    return this.db.transaction().execute(async (tx) => {
      const due = await this.timers.claimDue(limit, tx);
      if (due.length === 0) return 0;

      let fired = 0;
      const handled: string[] = [];

      for (const timer of due) {
        const acted = await this.fire(timer, tx);
        if (acted) fired++;
        handled.push(timer.id);
      }

      await this.timers.remove(handled, tx);
      return fired;
    });
  }

  /**
   * Applies one timer.
   *
   * Returns false when the deadline no longer applies — the task finished, or
   * the workflow ended. That is the common case rather than an error: a timer
   * armed at schedule time usually outlives its usefulness, and cancellation on
   * completion races with the sweeper. Checking here is what stops a completed
   * task being marked TIMED_OUT after the fact.
   */
  private async fire(timer: DueTimer, tx: Parameters<TimerRepository['remove']>[1]): Promise<boolean> {
    const workflow = await this.workflows.lockForEvaluation(
      timer.workflowId,
      tx as never
    );
    if (!workflow || workflow.status !== WorkflowStatus.RUNNING) return false;

    if (timer.kind === 'workflowTimeout') {
      const reason = 'workflow exceeded its timeout';
      await this.workflows.setStatus(timer.workflowId, WorkflowStatus.TIMED_OUT, undefined, reason, tx);

      if (this.failures) {
        const blueprint = await this.failures.blueprints.load(workflow.namespaceId, workflow.defName, workflow.defVersion);
        const start = failureWorkflowStart(blueprint, workflow, WorkflowStatus.TIMED_OUT, reason);
        if (start) {
          await this.failures.outbox.publish(
            workflow.namespaceId,
            'workflow.start',
            {
              defName: start.defName,
              defVersion: start.defVersion ?? null,
              input: start.input as JsonValue,
              idempotencyKey: start.idempotencyKey ?? null,
              correlationId: start.correlationId ?? null,
            },
            tx
          );
        }
      }
      await this.decideQueue.enqueue(
        timer.namespaceId,
        timer.workflowId,
        'workflow timed out',
        tx
      );
      return true;
    }

    if (!timer.taskId) return false;

    // The task may have finished between the timer being armed and it firing.
    const task = await this.findTask(timer.workflowId, timer.taskId, tx);
    if (!task || isTaskTerminal(task.status)) return false;

    // A fired `wait` is a *success*, not a timeout: the task did exactly what
    // it was asked to. Every other kind here records a deadline being missed,
    // which is why this returns before the shared TIMED_OUT path below.
    if (timer.kind === 'wait') {
      await this.workflows.completeTask(
        timer.workflowId,
        timer.taskId,
        TaskStatus.COMPLETED,
        { waited: true },
        undefined,
        undefined,
        tx
      );
      await this.decideQueue.enqueue(timer.namespaceId, timer.workflowId, 'wait elapsed', tx);
      return true;
    }

    // A scheduleToStart deadline only applies while the task is still waiting;
    // once a worker has it, startToClose is the relevant budget.
    if (timer.kind === 'scheduleToStart' && task.status !== TaskStatus.SCHEDULED) return false;
    if (timer.kind === 'startToClose' && task.status !== TaskStatus.IN_PROGRESS) return false;

    await this.workflows.completeTask(
      timer.workflowId,
      timer.taskId,
      TaskStatus.TIMED_OUT,
      undefined,
      reasonFor(timer.kind),
      undefined,
      tx
    );

    // The decider decides what a timeout means — retry, or fail the workflow.
    // The sweeper only records that the deadline passed.
    await this.decideQueue.enqueue(timer.namespaceId, timer.workflowId, `timer:${timer.kind}`, tx);
    return true;
  }

  private async findTask(
    workflowId: string,
    taskId: string,
    tx: Parameters<TimerRepository['remove']>[1]
  ) {
    return tx
      .selectFrom('TaskExecutions')
      .select(['id', 'status'])
      .where('workflowId', '=', workflowId)
      .where('id', '=', taskId)
      .executeTakeFirst();
  }
}

function reasonFor(kind: DueTimer['kind']): string {
  switch (kind) {
    case 'scheduleToStart':
      return 'no worker picked the task up within scheduleToStartTimeout';
    case 'startToClose':
      return 'worker did not finish within startToCloseTimeout';
    case 'heartbeat':
      return 'worker stopped heartbeating';
    default:
      return 'task exceeded its timeout';
  }
}
