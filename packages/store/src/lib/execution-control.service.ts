import {
  NodeFlowError,
  ErrorCode,
  TaskStatus,
  WorkflowStatus,
  isWorkflowTerminal,
  queueNameFor,
  type JsonValue,
} from '@node-flow-dev/core';
import { dependentsOf, type Blueprint } from '@node-flow-dev/engine';
import { sql } from 'kysely';
import { ConcurrencyRepository } from './concurrency.repository.js';
import type { Db, DbTransaction } from './database.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import { TimerRepository } from './timer.repository.js';
import {
  WorkflowEventType,
  WorkflowEventsRepository,
  type NewWorkflowEvent,
} from './workflow-events.repository.js';
import type { HumanTaskRepository } from './human-task.repository.js';
import type { WebhookRepository } from './webhook.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Operator control over a live execution: pause, resume, terminate, retry,
 * rerun, skip.
 *
 * These are the endpoints someone reaches for during an incident, which sets
 * the bar: each one takes the workflow row lock, so it cannot interleave with a
 * decider evaluation and leave the execution in a state neither of them
 * intended. Doing this without the lock is how a "terminate" races a schedule
 * and leaves an orphaned task running against a workflow that is already
 * TERMINATED.
 *
 * Every operation is also recorded in `WorkflowEvents`, in the same
 * transaction. After an incident, "who terminated this and when" is a question
 * that gets asked, and the task rows alone cannot answer it.
 */

/**
 * Just enough of the metadata repository to compile a blueprint.
 *
 * Narrowed to one method deliberately. The control service needs the task graph
 * to answer "what depended on this" and nothing else about metadata; taking the
 * whole repository would make a cycle, since metadata already reaches for
 * control when a definition changes. Taking a plain function instead would lose
 * the per-version cache that makes the lookup free.
 */
export interface BlueprintSource {
  load(namespaceId: string, defName: string, defVersion: number): Promise<Blueprint>;
}

export class ExecutionControlService {
  constructor(
    private readonly db: Db,
    private readonly workflows: WorkflowRepository,
    private readonly decideQueue: DecideQueueRepository,
    private readonly taskQueue: TaskQueueRepository,
    private readonly timers: TimerRepository,
    private readonly concurrency: ConcurrencyRepository,
    private readonly events?: WorkflowEventsRepository,
    private readonly webhooks?: WebhookRepository,
    private readonly humanTasks?: HumanTaskRepository
  ) {}

  /**
   * Stops the decider scheduling anything further.
   *
   * Tasks already queued or leased are *not* recalled — a worker mid-payment
   * must not have the ground pulled from under it. Their completions
   * accumulate and are consumed by the single evaluation that `resume` triggers.
   */
  async pause(workflowId: string, by: string): Promise<void> {
    await this.withLock(workflowId, async (tx, status) => {
      if (status === WorkflowStatus.PAUSED) return; // Idempotent.
      this.assertNotTerminal(workflowId, status, 'pause');

      await this.workflows.setStatus(workflowId, WorkflowStatus.PAUSED, undefined, undefined, tx);
      await this.record(workflowId, tx, {
        type: WorkflowEventType.WORKFLOW_PAUSED,
        payload: { by },
      });
    });
  }

  /**
   * Returns the workflow to RUNNING and re-arms its evaluation.
   *
   * The enqueue is not optional and is not a convenience. While paused, the
   * decider claims incoming wakeups and discards them — so by the time we get
   * here there may be completed tasks with no pending request to react to them.
   * Without this enqueue the workflow resumes and then sits idle forever, which
   * is precisely the stranded-workflow failure the whole engine is built to
   * avoid. It is in the same transaction as the status flip so the two cannot
   * come apart.
   */
  async resume(workflowId: string, by: string): Promise<void> {
    await this.withLock(workflowId, async (tx, status, namespaceId) => {
      if (status === WorkflowStatus.RUNNING) return; // Idempotent.
      this.assertNotTerminal(workflowId, status, 'resume');

      await this.workflows.setStatus(workflowId, WorkflowStatus.RUNNING, undefined, undefined, tx);
      await this.decideQueue.enqueue(namespaceId, workflowId, 'resumed', tx);
      await this.record(workflowId, tx, {
        type: WorkflowEventType.WORKFLOW_RESUMED,
        payload: { by },
      });
    });
  }

  /**
   * Ends the execution now and releases everything it holds.
   *
   * The cleanup is the substance of this operation, and skipping any of it
   * leaks something that outlives the workflow: an armed timer fires against a
   * dead execution, a queued task gets leased by a worker and runs work nobody
   * wants, and an unreleased semaphore permit throttles unrelated workflows
   * until its lease expires.
   */
  async terminate(workflowId: string, reason: string, by: string): Promise<void> {
    await this.withLock(workflowId, async (tx, status) => {
      this.assertNotTerminal(workflowId, status, 'terminate');

      const live = await this.liveTasks(workflowId, tx);

      for (const task of live) {
        await this.workflows.completeTask(
          workflowId,
          task.id,
          TaskStatus.CANCELED,
          undefined,
          `workflow terminated: ${reason}`,
          undefined,
          tx
        );
        await this.concurrency.releaseAll(task.id, tx);
      }

      await this.purgeQueueEntries(workflowId, tx);
      await this.timers.cancelForWorkflow(workflowId, tx);
      // Close any open webhook callback slots. Leaving them means a third party
      // calling back hours later finds a live token for a workflow that ended.
      await this.webhooks?.closeForWorkflow(workflowId, tx);
      // And clear its approvals out of people's inboxes. Leaving them means
      // someone opens a task hours later and is told off for doing exactly what
      // they were asked to do.
      await this.humanTasks?.closeForWorkflow(workflowId, tx);
      // Drop any pending wakeup too, or a decider will pick up a workflow that
      // is already finished and do a pointless pass.
      await tx.deleteFrom('DecideQueues').where('workflowId', '=', workflowId).execute();

      await this.workflows.setStatus(
        workflowId,
        WorkflowStatus.TERMINATED,
        undefined,
        reason,
        tx
      );
      await this.record(workflowId, tx, {
        type: WorkflowEventType.WORKFLOW_TERMINATED,
        payload: { reason, by, canceledTasks: live.length },
      });
    });
  }

  /**
   * Re-runs the failed tasks of a failed workflow, keeping everything that
   * succeeded.
   *
   * The alternative — start over — is what an operator does when they have no
   * better option, and it re-charges the credit card. Resuming from the failure
   * point is the whole reason execution state is durable.
   */
  async retry(workflowId: string, by: string): Promise<number> {
    return this.withLock(workflowId, async (tx, status, namespaceId) => {
      if (!isWorkflowTerminal(status)) {
        throw new NodeFlowError(
          ErrorCode.CONFLICT,
          `workflow ${workflowId} is ${status}; only a terminal workflow can be retried`
        );
      }

      // Reopen the failures in place, keeping their identity and history.
      //
      // CANCELED is included: terminating a workflow cancels whatever was in
      // flight, and retrying a terminated workflow means running that again.
      // Without it a retry reopened nothing, the decider saw the cancelled task,
      // and the workflow flipped from TERMINATED to FAILED with the old reason.
      //
      // Only the *latest* attempt of each task. A task that exhausted its
      // retries has a failed row per attempt; reopening all of them ran the same
      // task that many times at once.
      const reopened = await tx
        .updateTable('TaskExecutions as t')
        .set({
          status: TaskStatus.SCHEDULED,
          endedAt: null,
          startedAt: null,
          workerId: null,
          leaseToken: null,
          reasonForIncompletion: null,
          deciderSeenAt: null,
        })
        .where('t.workflowId', '=', workflowId)
        .where('t.status', 'in', [
          TaskStatus.FAILED,
          TaskStatus.FAILED_WITH_TERMINAL_ERROR,
          TaskStatus.TIMED_OUT,
          TaskStatus.CANCELED,
        ])
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('TaskExecutions as later')
                .select('later.id')
                .whereRef('later.workflowId', '=', 't.workflowId')
                .whereRef('later.refName', '=', 't.refName')
                .whereRef('later.iteration', '=', 't.iteration')
                .whereRef('later.attempt', '>', 't.attempt')
            )
          )
        )
        .returning(['t.id', 't.taskDefName', 't.domain'])
        .execute();

      // Nothing failed means nothing to retry. Reopening the workflow anyway
      // let the decider re-derive its end state — and rewrite TERMINATED as
      // FAILED, or re-complete a finished run, under a "retried" entry.
      if (reopened.length === 0) {
        throw new NodeFlowError(
          ErrorCode.CONFLICT,
          `workflow ${workflowId} has no failed or cancelled task to retry; start it again instead`
        );
      }

      // Put them back on the worker queue *here*, not via the decider.
      //
      // The decider cannot do it: the task row already exists, so its
      // `ScheduleTask` is absorbed by the unique index on
      // (workflowId, refName, iteration, attempt) and no queue entry is
      // written. The workflow would return to RUNNING with a SCHEDULED task
      // that no worker can ever see, and stall — silently, and looking healthy.
      for (const task of reopened) {
        await this.taskQueue.enqueue(
          {
            namespaceId,
            // The pool it originally belonged to. Re-deriving this from the
            // task name alone would quietly move a retry onto the shared queue.
            queueName: queueNameFor(task.taskDefName, task.domain ?? undefined),
            taskId: task.id,
            workflowId,
          },
          tx
        );
      }

      await this.reopenWorkflow(workflowId, namespaceId, tx);
      await this.record(workflowId, tx, {
        type: WorkflowEventType.WORKFLOW_RETRIED,
        payload: { by, reopenedTasks: reopened.length },
      });

      return reopened.length;
    });
  }

  /**
   * Discards everything from `refName` onward and runs again from there.
   *
   * Used when a task succeeded but produced the wrong answer — a retry would
   * not touch it, because nothing failed.
   */
  async rerunFromTask(workflowId: string, refName: string, by: string): Promise<number> {
    return this.withLock(workflowId, async (tx, status, namespaceId) => {
      const target = await tx
        .selectFrom('TaskExecutions')
        .select(['id', 'scheduledAt'])
        .where('workflowId', '=', workflowId)
        .where('refName', '=', refName)
        .orderBy('scheduledAt')
        .executeTakeFirst();

      if (!target) {
        throw new NodeFlowError(
          ErrorCode.NOT_FOUND,
          `no task "${refName}" in workflow ${workflowId}`
        );
      }

      // Delete rather than reset. Scheduling is idempotent on
      // (workflowId, refName, iteration, attempt), so leaving the old rows in
      // place would make the decider's re-schedule a no-op absorbed by the
      // unique index — the rerun would silently do nothing.
      const removed = await tx
        .deleteFrom('TaskExecutions')
        .where('workflowId', '=', workflowId)
        .where('scheduledAt', '>=', target.scheduledAt)
        .returning('id')
        .execute();

      for (const task of removed) await this.concurrency.releaseAll(task.id, tx);
      await this.purgeQueueEntries(workflowId, tx);
      await this.timers.cancelForWorkflow(workflowId, tx);

      await this.reopenWorkflow(workflowId, namespaceId, tx);
      await this.record(workflowId, tx, {
        type: WorkflowEventType.WORKFLOW_RERUN,
        payload: { by, fromRefName: refName, discardedTasks: removed.length },
      });

      return removed.length;
    });
  }

  /**
   * Stops one running task and holds the workflow where it is.
   *
   * For the case an operator actually has: a task is misbehaving — wrong input,
   * a worker deploying badly, a downstream service on fire — and they want it
   * stopped *now*, then to decide what to do about it.
   *
   * The workflow is paused in the same transaction, and that is the point
   * rather than a convenience. Cancelling alone would leave the decider free to
   * carry on with whatever else was runnable, so the operator would be racing
   * their own workflow while they worked out what went wrong.
   *
   * ## What this does not do
   *
   * **It does not stop the worker.** The process holding the lease keeps
   * running, because nothing here can reach into it. Correctness is preserved
   * by the fencing token — when it eventually reports, the lease is gone and
   * the result is refused — but the work continues to completion and whatever
   * it touches on the way is still touched. Stopping that needs the worker to
   * cooperate, which is an SDK change and not this.
   *
   * **The task is CANCELED, not FAILED.** A failure is something the workflow
   * is designed to handle: it consumes a retry, may start the failure workflow,
   * may unwind compensation. An operator stepping in is not that, and dressing
   * it up as a failure would put a run in the failure reports that only ever
   * failed because someone pressed a button.
   */
  async cancelTask(
    workflowId: string,
    refName: string,
    by: string
  ): Promise<{ taskId: string; status: WorkflowStatus }> {
    return this.withLock(workflowId, async (tx, status) => {
      this.assertNotTerminal(workflowId, status, 'cancel a task in');

      const task = await tx
        .selectFrom('TaskExecutions')
        .select(['id', 'status'])
        .where('workflowId', '=', workflowId)
        .where('refName', '=', refName)
        .where('status', 'in', [TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS, TaskStatus.WAITING])
        .orderBy('scheduledAt', 'desc')
        .executeTakeFirst();

      if (!task) {
        throw new NodeFlowError(
          ErrorCode.NOT_FOUND,
          `no running task "${refName}" in workflow ${workflowId}`
        );
      }

      await this.workflows.completeTask(
        workflowId,
        task.id,
        TaskStatus.CANCELED,
        undefined,
        `cancelled by ${by}`,
        undefined,
        tx
      );
      await this.concurrency.releaseAll(task.id, tx);
      await tx.deleteFrom('TaskQueues').where('taskId', '=', task.id).execute();
      await this.timers.cancelForTask(workflowId, task.id, tx);

      // Paused rather than left running — see above. Idempotent if the operator
      // paused first, which is the careful order and should not be punished.
      if (status !== WorkflowStatus.PAUSED) {
        await this.workflows.setStatus(workflowId, WorkflowStatus.PAUSED, undefined, undefined, tx);
      }

      await this.record(workflowId, tx, {
        type: WorkflowEventType.TASK_CANCELED,
        payload: { by, refName, taskId: task.id, previousStatus: task.status },
      });

      return { taskId: task.id, status: WorkflowStatus.PAUSED };
    });
  }

  /**
   * Runs named tasks again, and optionally everything that depended on them.
   *
   * Distinct from `rerunFromTask`, which discards every task scheduled at or
   * after a point in time. That rule is a straight line's idea of "downstream":
   * across a fork it also discards an unrelated parallel branch that happened to
   * be scheduled a moment later, throwing away work that had nothing to do with
   * the problem.
   *
   * This asks the blueprint instead. `cascade` decides what that answer is used
   * for:
   *
   * - **`cascade: true`** — the named tasks and everything that depends on them,
   *   transitively, by data *and* by control flow. The run stays consistent.
   * - **`cascade: false`** (the default) — only the named tasks. Downstream
   *   results are left in place, which means they were computed from outputs
   *   that no longer exist. That is sometimes exactly right — regenerating one
   *   artifact after fixing its worker — and sometimes a quiet corruption, so
   *   the tasks it leaves stale are *returned* rather than left to be noticed.
   *
   * Only on a paused or finished workflow. Doing this to a live one would race
   * the decider for the frontier and a worker for a row about to be deleted,
   * and "re-run this" has no agreed meaning while its downstream is still
   * executing. Pause it, then change it.
   */
  async rerunTasks(
    workflowId: string,
    refNames: readonly string[],
    options: { cascade?: boolean; by: string; blueprints: BlueprintSource }
  ): Promise<{ rerun: string[]; staleDownstream: string[] }> {
    if (refNames.length === 0) {
      throw new NodeFlowError(ErrorCode.INVALID_ARGUMENT, 'name at least one task to re-run');
    }

    return this.withLock(workflowId, async (tx, status, namespaceId) => {
      if (status === WorkflowStatus.RUNNING) {
        throw new NodeFlowError(
          ErrorCode.CONFLICT,
          `workflow ${workflowId} is running; pause it before re-running tasks`
        );
      }

      const execution = await tx
        .selectFrom('WorkflowExecutions')
        .select(['defName', 'defVersion'])
        .where('id', '=', workflowId)
        .executeTakeFirstOrThrow();

      const blueprint = await options.blueprints.load(
        namespaceId,
        execution.defName,
        execution.defVersion
      );

      const unknown = refNames.filter((ref) => !blueprint.nodes.has(ref));
      if (unknown.length > 0) {
        throw new NodeFlowError(
          ErrorCode.NOT_FOUND,
          `no task ${unknown.map((ref) => `"${ref}"`).join(', ')} in ${execution.defName} v${execution.defVersion}`
        );
      }

      const dependents = dependentsOf(blueprint, refNames);

      /**
       * Two different mechanisms, because the two cases genuinely differ.
       *
       * **Cascading** deletes the named tasks and their dependents and lets the
       * decider re-derive the lot. It has to: upstream outputs have changed, so
       * every downstream input must be recomputed rather than reused.
       *
       * **Not cascading** cannot work that way, and the reason is worth
       * recording because the first attempt at this silently did nothing. The
       * decider derives what to schedule from the pending frontier. Delete a
       * task in the middle of a finished run and the frontier is still empty —
       * every downstream task is COMPLETED — so the decider concludes the
       * workflow is done and completes it again, having never rescheduled the
       * task the operator asked for. So the named tasks are re-armed in place
       * and queued here instead, exactly as `retry` does, with the input they
       * ran with before. That input is still correct: nothing upstream moved.
       */
      const removed = options.cascade
        ? await tx
            .deleteFrom('TaskExecutions')
            .where('workflowId', '=', workflowId)
            .where('refName', 'in', [...refNames, ...dependents])
            .returning(['id', 'refName'])
            .execute()
        : [];

      for (const task of removed) {
        await this.concurrency.releaseAll(task.id, tx);
        await tx.deleteFrom('TaskQueues').where('taskId', '=', task.id).execute();
        await this.timers.cancelForTask(workflowId, task.id, tx);
      }

      // Re-arm the named tasks. Under cascade their rows are gone and the
      // decider will schedule them; otherwise the latest attempt of each is put
      // back to SCHEDULED and re-queued.
      const rearmed = options.cascade
        ? []
        : await tx
            .updateTable('TaskExecutions as t')
            .set({
              status: TaskStatus.SCHEDULED,
              endedAt: null,
              startedAt: null,
              workerId: null,
              leaseToken: null,
              reasonForIncompletion: null,
              deciderSeenAt: null,
            })
            .where('t.workflowId', '=', workflowId)
            .where('t.refName', 'in', [...refNames])
            // Only the latest attempt of each, or a task that exhausted its
            // retries would be re-armed once per historical attempt and run
            // that many times at once.
            .where(({ not, exists, selectFrom }) =>
              not(
                exists(
                  selectFrom('TaskExecutions as later')
                    .select('later.id')
                    .whereRef('later.workflowId', '=', 't.workflowId')
                    .whereRef('later.refName', '=', 't.refName')
                    .whereRef('later.iteration', '=', 't.iteration')
                    .whereRef('later.attempt', '>', 't.attempt')
                )
              )
            )
            .returning(['t.id', 't.refName', 't.taskDefName', 't.domain'])
            .execute();

      if (removed.length === 0 && rearmed.length === 0) {
        throw new NodeFlowError(
          ErrorCode.NOT_FOUND,
          `workflow ${workflowId} has run none of ${refNames.map((ref) => `"${ref}"`).join(', ')}`
        );
      }

      // Queued here rather than left to the decider: the row still exists, so
      // its `ScheduleTask` would be absorbed by the unique index on
      // (workflowId, refName, iteration, attempt) and no queue entry written —
      // leaving a SCHEDULED task no worker can ever see. Silent, and healthy
      // looking.
      for (const task of rearmed) {
        await this.concurrency.releaseAll(task.id, tx);
        await tx.deleteFrom('TaskQueues').where('taskId', '=', task.id).execute();
        await this.taskQueue.enqueue(
          {
            namespaceId,
            queueName: queueNameFor(task.taskDefName, task.domain ?? undefined),
            taskId: task.id,
            workflowId,
          },
          tx
        );
      }

      await this.reopenWorkflow(workflowId, namespaceId, tx);

      // Without cascade, whatever consumed these outputs is still holding a
      // result derived from a run that no longer exists. Reported, not hidden.
      const stale = options.cascade ? [] : [...dependents].sort();

      await this.record(workflowId, tx, {
        type: WorkflowEventType.WORKFLOW_RERUN,
        payload: {
          by: options.by,
          refNames: [...refNames],
          cascade: Boolean(options.cascade),
          discardedTasks: removed.length,
          rearmedTasks: rearmed.length,
          staleDownstream: stale,
        },
      });

      const rerun = [...new Set([...removed, ...rearmed].map((task) => task.refName))].sort();
      return { rerun, staleDownstream: stale };
    });
  }

  /**
   * Marks a scheduled task as skipped without running it.
   *
   * `SKIPPED` counts as successful, so a downstream JOIN still fires — skipping
   * a branch must not deadlock the fork that is waiting on it.
   */
  async skipTask(workflowId: string, refName: string, by: string): Promise<void> {
    await this.withLock(workflowId, async (tx, status, namespaceId) => {
      this.assertNotTerminal(workflowId, status, 'skip a task in');

      const task = await tx
        .selectFrom('TaskExecutions')
        .select(['id', 'status'])
        .where('workflowId', '=', workflowId)
        .where('refName', '=', refName)
        .where('status', 'in', [TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS])
        .orderBy('scheduledAt', 'desc')
        .executeTakeFirst();

      if (!task) {
        throw new NodeFlowError(
          ErrorCode.NOT_FOUND,
          `no runnable task "${refName}" in workflow ${workflowId}`
        );
      }

      await this.workflows.completeTask(
        workflowId,
        task.id,
        TaskStatus.SKIPPED,
        { skipped: true as JsonValue },
        `skipped by ${by}`,
        undefined,
        tx
      );

      await this.concurrency.releaseAll(task.id, tx);
      await tx
        .deleteFrom('TaskQueues')
        .where('taskId', '=', task.id)
        .execute();
      await this.timers.cancelForTask(workflowId, task.id, tx);

      await this.decideQueue.enqueue(namespaceId, workflowId, 'task skipped', tx);
      await this.record(workflowId, tx, {
        type: WorkflowEventType.TASK_SKIPPED,
        payload: { refName, by, reason: 'operator skip' },
      });
    });
  }

  // -------------------------------------------------------------------- helpers

  /**
   * Runs `body` under the workflow's row lock.
   *
   * The same lock the decider takes, so an operator action and an evaluation
   * are strictly ordered rather than interleaved.
   */
  private async withLock<T>(
    workflowId: string,
    body: (tx: DbTransaction, status: WorkflowStatus, namespaceId: string) => Promise<T>
  ): Promise<T> {
    return this.db.transaction().execute(async (tx) => {
      const workflow = await this.workflows.lockForEvaluation(workflowId, tx);
      if (!workflow) {
        throw new NodeFlowError(ErrorCode.NOT_FOUND, `no workflow ${workflowId}`);
      }
      return body(tx, workflow.status, workflow.namespaceId);
    });
  }

  private assertNotTerminal(workflowId: string, status: WorkflowStatus, action: string): void {
    if (isWorkflowTerminal(status)) {
      throw new NodeFlowError(
        ErrorCode.TERMINAL_STATE,
        `cannot ${action} workflow ${workflowId}: it is already ${status}`
      );
    }
  }

  /** Non-terminal tasks — the ones a terminate has to clean up after. */
  private async liveTasks(workflowId: string, tx: DbTransaction) {
    return tx
      .selectFrom('TaskExecutions')
      .select(['id'])
      .where('workflowId', '=', workflowId)
      .where('status', 'in', [TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS])
      .execute();
  }

  /**
   * Removes this workflow's queue entries.
   *
   * `TaskQueues` is hash-partitioned on `queueName`, so a delete keyed only on
   * `workflowId` touches every partition. Acceptable here — these are rare
   * operator actions, not a hot path — and the alternative, carrying queue
   * names through every call, would complicate the common case to optimise the
   * uncommon one.
   */
  private async purgeQueueEntries(workflowId: string, tx: DbTransaction): Promise<void> {
    await tx.deleteFrom('TaskQueues').where('workflowId', '=', workflowId).execute();
  }

  /** Puts a finished workflow back into RUNNING and schedules an evaluation. */
  private async reopenWorkflow(
    workflowId: string,
    namespaceId: string,
    tx: DbTransaction
  ): Promise<void> {
    await tx
      .updateTable('WorkflowExecutions')
      .set({
        status: WorkflowStatus.RUNNING,
        endedAt: null,
        reasonForIncompletion: null,
        updatedAt: sql<Date>`now()`,
        version: sql<string>`"version" + 1`,
      })
      .where('id', '=', workflowId)
      .execute();

    await this.workflows.recordStatusChange({ workflowId, event: 'RESTARTED' }, tx);
    await this.decideQueue.enqueue(namespaceId, workflowId, 'reopened by operator', tx);
  }

  private async record(
    workflowId: string,
    tx: DbTransaction,
    event: NewWorkflowEvent
  ): Promise<void> {
    if (this.events) await this.events.append(workflowId, [event], tx);
  }
}
