import { TaskStatus, parseQueueName, type JsonValue } from '@node-flow-dev/core';
import { ConcurrencyRepository, type DispatchPolicy } from './concurrency.repository.js';
import type { Db } from './database.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { TaskQueueRepository, type QueuedTask } from './task-queue.repository.js';
import { TimerRepository } from './timer.repository.js';
import type { SchemaValidator } from './schema-validator.js';
import type { TaskDefLoader } from './evaluator.js';
import type { PayloadStore } from './payload-store.js';
import type { OutputSealer } from './output-sealer.js';
import type { SecretResolver } from './secret-resolver.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * The worker-facing protocol: lease, heartbeat, report.
 *
 * Leasing and recording a task's state were previously separate concerns that
 * nothing joined up — the queue row got a lease and a fencing token, while the
 * `TaskExecutions` row stayed `SCHEDULED` with no `leaseToken` at all. Two
 * consequences: nothing could tell a queued task from a running one, and the
 * fencing check on `completeTask` could never match, so it silently never
 * fenced anything.
 *
 * This service is the single place a worker interacts with, so the queue row
 * and the task row can never disagree about who holds the task.
 */
export class TaskDispatchService {
  constructor(
    private readonly db: Db,
    private readonly workflows: WorkflowRepository,
    private readonly taskQueue: TaskQueueRepository,
    private readonly decideQueue: DecideQueueRepository,
    private readonly timers?: TimerRepository,
    private readonly concurrency?: ConcurrencyRepository,
    /**
     * Enforces `outputSchema`, when one is declared.
     *
     * Checked here rather than left to the decider, because this is the
     * boundary the untrusted value crosses: a worker's output is the one piece
     * of data in the system that comes from outside it.
     */
    private readonly schemas?: SchemaValidator,
    private readonly taskDefs?: TaskDefLoader,
    /** Inlines offloaded payloads for delivery to a worker. */
    private readonly payloads?: PayloadStore,
    /** Substitutes `${secrets.x}` into the copy a worker receives. */
    private readonly secrets?: SecretResolver,
    /** Seals declared credential fields on the way into storage. */
    private readonly sealer?: OutputSealer
  ) {}

  /**
   * The inputs to hand a worker, resolved for delivery and not for storage.
   *
   * Leasing returned no input at all until this existed, which meant a `SIMPLE`
   * task's `inputParameters` never reached the worker that was supposed to act
   * on them — the whole point of declaring them. A worker could see a task id
   * and nothing else.
   *
   * Two resolutions happen here and only here:
   *
   *  - **offloaded payloads** are inlined, because a worker cannot dereference
   *    a blob ref and would otherwise silently receive an empty object;
   *  - **secrets** are substituted, into this copy alone. What the database
   *    holds keeps the `${secrets.x}` reference — see `SecretResolver`.
   */
  async inputsFor(
    tasks: { taskId: string; workflowId: string; namespaceId: string }[]
  ): Promise<Map<string, Record<string, JsonValue>>> {
    const inputs = new Map<string, Record<string, JsonValue>>();

    for (const task of tasks) {
      const row = await this.workflows.findTaskById(task.workflowId, task.taskId);
      if (!row) continue;

      const stored = this.payloads
        ? ((await this.payloads.resolve(row.input)) ?? {})
        : row.input.kind === 'inline'
          ? row.input.value
          : {};

      inputs.set(
        task.taskId,
        this.secrets ? await this.secrets.resolve(task.namespaceId, stored, task.workflowId) : stored
      );
    }

    return inputs;
  }

  /**
   * Leases tasks and marks them running.
   *
   * Both happen in one transaction: a lease granted without the task row being
   * updated leaves a task that a worker is executing but the system believes is
   * merely queued.
   */
  async lease(options: {
    namespaceId: string;
    queueName: string;
    workerId: string;
    leaseSeconds?: number;
    limit?: number;
    /** Concurrency, rate-limit and semaphore policy for this queue. */
    policy?: DispatchPolicy;
  }): Promise<QueuedTask[]> {
    const leaseSeconds = options.leaseSeconds ?? 60;
    const requested = options.limit ?? 1;

    return this.db.transaction().execute(async (tx) => {
      // Admission control runs before anything is leased. Enforcing it here
      // rather than in the worker SDK is the whole point: a limit checked
      // client-side is advisory, and will be bypassed by a worker that is
      // older, misconfigured, or not ours.
      let allowed = requested;
      if (this.concurrency && options.policy) {
        allowed = await this.concurrency.allowance(
          options.namespaceId,
          options.queueName,
          requested,
          options.policy,
          tx
        );
        if (allowed === 0) return [];
      }

      const leased = await this.taskQueue.lease(
        options.queueName,
        options.workerId,
        leaseSeconds,
        allowed,
        options.namespaceId
      );

      const granted: QueuedTask[] = [];

      for (const task of leased) {
        // Semaphores are taken per task and all-or-nothing. A task that cannot
        // get its permits goes straight back on the queue rather than running
        // without them.
        if (this.concurrency && options.policy?.semaphores.length) {
          const acquired = await this.concurrency.acquireAll(
            options.namespaceId,
            options.policy.semaphores,
            task.taskId,
            task.workflowId,
            leaseSeconds,
            tx
          );
          if (!acquired) {
            await this.taskQueue.releaseLease(
              options.queueName,
              task.taskId,
              task.leaseToken,
              tx
            );
            continue;
          }
        }

        await this.workflows.markTaskStarted(
          task.workflowId,
          task.taskId,
          options.workerId,
          task.leaseToken,
          tx
        );
        granted.push(task);
      }

      return granted;
    });
  }

  /**
   * Extends a lease for a worker still working.
   *
   * Fenced on the token, so a worker whose lease already expired and was
   * reclaimed cannot extend it back into existence.
   *
   * Also re-arms the heartbeat deadline when one is configured. Renewing the
   * lease without it means `heartbeatTimeout` never fires and a worker that
   * stops beating but holds its lease is never detected.
   */
  async heartbeat(
    queueName: string,
    taskId: string,
    leaseToken: string,
    leaseSeconds = 60,
    heartbeatTimeoutSeconds?: number
  ): Promise<boolean> {
    const renewed = await this.taskQueue.renewLease(
      queueName,
      taskId,
      leaseToken,
      leaseSeconds
    );
    if (!renewed || !this.timers || !heartbeatTimeoutSeconds) return renewed;

    await this.db.transaction().execute(async (tx) => {
      const task = await tx
        .selectFrom('TaskExecutions')
        .select(['workflowId', 'namespaceId'])
        .where('id', '=', taskId)
        .executeTakeFirst();
      if (!task) return;

      // Replace the previous deadline rather than adding one, or a
      // long-running task accumulates a timer per beat.
      await this.timers!.cancelForTask(task.workflowId, taskId, tx);
      await this.timers!.schedule(
        {
          kind: 'heartbeat',
          namespaceId: task.namespaceId,
          workflowId: task.workflowId,
          taskId,
          fireAfterSeconds: heartbeatTimeoutSeconds,
        },
        tx
      );
    });

    return renewed;
  }

  /**
   * Rejects an output that does not match the declared `outputSchema`.
   *
   * Done *before* the transaction, and it throws rather than recording a
   * failure. The distinction matters: a schema violation is the worker sending
   * something wrong, so it should reach the worker as an error it can log and
   * act on — recording it as a task failure would bury the cause in the
   * execution record while the worker went on believing it succeeded.
   *
   * Only successful outputs are checked. A failed task's output is diagnostic,
   * and holding an error report to the success contract would reject exactly
   * the information someone needs to debug it.
   */
  private async assertOutputMatchesSchema(options: {
    namespaceId: string;
    queueName: string;
    status: TaskStatus;
    output?: Record<string, JsonValue>;
  }): Promise<void> {
    if (!this.schemas || !this.taskDefs) return;
    if (options.status !== TaskStatus.COMPLETED) return;

    // The queue may be domained (`charge:eu-west`); the definition is `charge`.
    const { taskDefName } = parseQueueName(options.queueName);
    const defs = await this.taskDefs.load(options.namespaceId, [taskDefName]);

    this.schemas.assertValid(defs.get(taskDefName), 'output', options.output);
  }

  /**
   * Leases system tasks — the ones the server runs itself.
   *
   * Deliberately routed through this service rather than called on the queue
   * repository directly, because leasing is **two** writes that must not come
   * apart: the queue row takes the lease, and the `TaskExecutions` row takes
   * the matching fencing token and goes `IN_PROGRESS`.
   *
   * Skipping the second is not a cosmetic omission. `completeTask` is fenced on
   * that token, so a task leased without it can never report a result — it runs
   * to completion, the write is silently refused, and the task sits
   * `SCHEDULED` until the reclaimer takes it back and runs it again. Forever.
   * Every lease path has to go through here for exactly that reason.
   */
  async leaseSystemTasks(options: {
    types: string[];
    workerId: string;
    leaseSeconds: number;
    limit: number;
  }): Promise<QueuedTask[]> {
    return this.db.transaction().execute(async (tx) => {
      const leased = await this.taskQueue.leaseSystemTasks(options);

      for (const task of leased) {
        await this.workflows.markTaskStarted(
          task.workflowId,
          task.taskId,
          options.workerId,
          task.leaseToken,
          tx
        );
      }

      return leased;
    });
  }

  /**
   * Returns tasks abandoned by crashed workers to the queue.
   *
   * Resets **both** rows. The queue repository clears the lease, but the
   * `TaskExecutions` row still says IN_PROGRESS and names the dead worker —
   * leaving it makes an abandoned task look like one that is actively running,
   * which is exactly the state an operator would be trying to diagnose.
   */
  async reclaimAbandoned(limit = 100): Promise<number> {
    const reclaimed = await this.taskQueue.reclaimExpiredLeases(limit);
    if (reclaimed.length === 0) return 0;

    await this.db
      .updateTable('TaskExecutions')
      .set({
        status: TaskStatus.SCHEDULED,
        workerId: null,
        leaseToken: null,
        startedAt: null,
      })
      .where(
        'id',
        'in',
        reclaimed.map((r) => r.taskId)
      )
      .execute();

    // A crashed worker's permits must come back with its task, or the semaphore
    // drains one permit per crash until nothing can run.
    if (this.concurrency) {
      for (const task of reclaimed) {
        await this.concurrency.releaseAll(task.taskId, this.db);
      }
    }

    return reclaimed.length;
  }

  /**
   * Records a task result and wakes the decider.
   *
   * Everything commits together: the outcome, the queue removal, the cancelled
   * deadlines, and the evaluation request. A result recorded without the
   * evaluation request would leave the workflow stalled holding a finished task.
   *
   * Returns false when the lease is no longer valid — a stale worker reporting
   * after its task was reclaimed. Rejecting that is the point of the fencing
   * token: another worker now owns the task, and accepting the old result would
   * discard real work.
   */
  /**
   * Records progress and asks for the task again later.
   *
   * The task stays `IN_PROGRESS` and keeps its attempt — this is not a retry,
   * and must not consume the retry budget, because nothing failed. What changes
   * is that the execution slot is given back until the row becomes visible
   * again.
   *
   * All three steps share one transaction so a crash between them is
   * impossible. The dangerous ordering would be to write the output first and
   * defer after: a crash in between leaves a task holding a lease that will
   * expire and be *reclaimed as abandoned*, losing the progress just recorded.
   *
   * Deadlines are deliberately left armed. A polling task's total budget is
   * still its task timeout, and re-arming per poll would let a task poll
   * forever as long as each individual poll was quick.
   */
  async reschedule(options: {
    queueName: string;
    workflowId: string;
    taskId: string;
    leaseToken: string;
    delaySeconds: number;
    output?: Record<string, JsonValue>;
  }): Promise<boolean> {
    return this.db.transaction().execute(async (tx) => {
      // Fencing first. If the lease is gone, another runner owns this task and
      // writing its state would corrupt that runner's progress.
      const deferred = await this.taskQueue.defer(
        options.queueName,
        options.taskId,
        options.leaseToken,
        options.delaySeconds,
        tx
      );

      if (!deferred) return false;

      if (options.output) {
        await this.workflows.setTaskOutput(
          options.workflowId,
          options.taskId,
          options.output,
          tx
        );
      }

      return true;
    });
  }

  /**
   * Seals the output fields a task declares as credentials.
   *
   * Here, at the boundary the value crosses on its way into storage — the last
   * point at which the plaintext exists and the first at which it would
   * otherwise be written down.
   */
  private async sealOutput(options: {
    namespaceId: string;
    workflowId: string;
    taskId: string;
    output?: Record<string, JsonValue>;
  }): Promise<Record<string, JsonValue> | undefined> {
    if (!this.sealer?.enabled || !options.output || !this.taskDefs) return options.output;

    const task = await this.workflows.findTaskById(options.workflowId, options.taskId);
    if (!task) return options.output;

    const defs = await this.taskDefs.load(options.namespaceId, [task.taskDefName]);

    return this.sealer.seal(options.output, defs.get(task.taskDefName), {
      namespaceId: options.namespaceId,
      taskDefName: task.taskDefName,
    });
  }

  async report(options: {
    namespaceId: string;
    queueName: string;
    workflowId: string;
    taskId: string;
    leaseToken: string;
    status: TaskStatus;
    output?: Record<string, JsonValue>;
    reason?: string;
  }): Promise<boolean> {
    await this.assertOutputMatchesSchema(options);

    // Validated first, then sealed: a schema describes the shape a task
    // produced, and checking it against an envelope would fail every time.
    const output = await this.sealOutput(options);

    return this.db.transaction().execute(async (tx) => {
      const recorded = await this.workflows.completeTask(
        options.workflowId,
        options.taskId,
        options.status,
        output,
        options.reason,
        options.leaseToken,
        tx
      );

      if (!recorded) return false;

      await this.taskQueue.acknowledge(options.queueName, options.taskId, options.leaseToken, tx);

      // The task is terminal, so its deadlines no longer mean anything.
      if (this.timers) {
        await this.timers.cancelForTask(options.workflowId, options.taskId, tx);
      }

      // Release permits in the same transaction as the result. Releasing after
      // would leave a window where the permit is held by a finished task, and
      // releasing before would let a second task in while this one still runs.
      if (this.concurrency) {
        await this.concurrency.releaseAll(options.taskId, tx);
      }

      await this.decideQueue.enqueue(
        options.namespaceId,
        options.workflowId,
        `task ${options.status}`,
        tx
      );

      return true;
    });
  }
}
