import {
  ErrorCode,
  NodeFlowError,
  TaskStatus,
  TaskType,
  WorkflowStatus,
  isOperator,
  isExternallyCompleted,
  isTaskTerminal,
  isWaitingTask,
  queueNameFor,
  isWorkflowTerminal,
  type EvaluationState,
  type JsonValue,
  type TaskDefinition,
  type TaskExecution,
  type WorkflowExecution,
} from '@node-flow-dev/core';
import { decide, type Blueprint, type Command } from '@node-flow-dev/engine';
import type { Db, DbTransaction } from './database.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { OutboxRepository } from './outbox.repository.js';
import type { PayloadStore } from './payload-store.js';
import { isFormReference } from './form-template.repository.js';
import type { HumanTaskTrigger, ResolvedAssignment } from './schema.js';
import { resolveAssignments, resolveTriggers } from './human-task.repository.js';
import type { HumanTaskRepository } from './human-task.repository.js';
import { SchemaValidationError, type SchemaValidator } from './schema-validator.js';
import type { WebhookRepository } from './webhook.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import { TimerRepository } from './timer.repository.js';
import {
  WorkflowEventType,
  WorkflowEventsRepository,
  type NewWorkflowEvent,
} from './workflow-events.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * The evaluation transaction — where the pure decider meets the database.
 *
 * The ordering in `evaluate` is the correctness argument for the whole engine,
 * and each step is load-bearing:
 *
 *   1. **Claim** the decide-queue row, *before reading anything*. A completion
 *      landing after this point re-enqueues successfully rather than being
 *      swallowed, which is what prevents a permanently stranded workflow.
 *   2. **Lock** the workflow row. This is the per-workflow serialisation; no
 *      lock service is involved.
 *   3. **Read** only the pending frontier plus the specific terminal refs the
 *      blueprint says this evaluation needs.
 *   4. **Decide** — pure, no I/O.
 *   5. **Apply** commands and write the outbox in the same transaction.
 *   6. **Commit**, then let the relay publish.
 *
 * Nothing observable escapes before commit, so a crash at any point rolls back
 * to a consistent state with the claim intact and the wakeup preserved.
 */

export interface BlueprintLoader {
  load(namespaceId: string, defName: string, defVersion: number): Promise<Blueprint>;
}

export interface TaskDefLoader {
  load(namespaceId: string, names: string[]): Promise<Map<string, TaskDefinition>>;
}

export interface EvaluationOutcome {
  /** False when another decider held the claim, or the workflow was terminal. */
  evaluated: boolean;
  commandCount: number;
  /** True if this pass changed nothing — expected and harmless. */
  noop: boolean;
}

export class Evaluator {
  constructor(
    private readonly db: Db,
    private readonly workflows: WorkflowRepository,
    private readonly decideQueue: DecideQueueRepository,
    private readonly taskQueue: TaskQueueRepository,
    private readonly outbox: OutboxRepository,
    private readonly blueprints: BlueprintLoader,
    private readonly taskDefs?: TaskDefLoader,
    private readonly timers?: TimerRepository,
    private readonly events?: WorkflowEventsRepository,
    private readonly payloads?: PayloadStore,
    /** Enforces `inputSchema` on each task as it is scheduled. */
    private readonly schemas?: SchemaValidator,
    /** Opens callback slots for `WAIT_FOR_WEBHOOK` tasks. */
    private readonly webhooks?: WebhookRepository,
    /** Opens inbox entries for `HUMAN` tasks. */
    private readonly humanTasks?: HumanTaskRepository,
    /** Environment variables for `${workflow.env.name}`. */
    private readonly environment?: { load(namespaceId: string): Promise<Record<string, JsonValue>> },
    /** Hands queued messages to `PULL_WORKFLOW_MESSAGES` tasks. */
    private readonly messages?: { deliver(namespaceId: string, workflowId: string, tx: DbTransaction): Promise<boolean> }
  ) {}

  async evaluate(workflowId: string): Promise<EvaluationOutcome> {
    return this.db
      .transaction()
      .setIsolationLevel('read committed')
      .execute((tx) => this.evaluateInTransaction(workflowId, tx));
  }

  private async evaluateInTransaction(
    workflowId: string,
    tx: DbTransaction
  ): Promise<EvaluationOutcome> {
    // 1. Claim first. Never move this below the reads.
    const claimed = await this.decideQueue.claimForEvaluation(workflowId, tx);
    if (!claimed) return { evaluated: false, commandCount: 0, noop: true };

    // 2. Serialise on the workflow row.
    const workflow = await this.workflows.lockForEvaluation(workflowId, tx);
    if (!workflow || isWorkflowTerminal(workflow.status)) {
      return { evaluated: false, commandCount: 0, noop: true };
    }
    // Waiting for a rate-limit slot: it must not start, whatever woke it. The
    // admission runner wakes it again once it is let in.
    if (workflow.awaitingAdmission) {
      return { evaluated: false, commandCount: 0, noop: true };
    }

    // A paused workflow schedules nothing. PAUSED is not a terminal status, so
    // without this check the decider would keep advancing it and pause would be
    // decorative — the operator sets it, the API reports it, and tasks keep
    // being scheduled.
    //
    // The claim taken above is discarded here rather than left in place, which
    // would busy-loop every decider poll for as long as the pause lasts.
    // `ExecutionControlService.resume` re-enqueues in the same transaction as
    // the status flip, so the wakeup is restored exactly when it is needed.
    if (workflow.status === WorkflowStatus.PAUSED) {
      return { evaluated: false, commandCount: 0, noop: true };
    }

    const blueprint = await this.blueprints.load(
      workflow.namespaceId,
      workflow.defName,
      workflow.defVersion
    );

    // 3. Read only what this evaluation needs: the live frontier, and the
    //    terminal tasks not yet reacted to.
    const pending = (await this.workflows.loadPendingTasks(workflowId, tx)).filter(
      (t) => !isTaskTerminal(t.status)
    );
    const completed = await this.workflows.loadUnprocessedTerminalTasks(workflowId, tx);

    const resolvedRefs = await this.workflows.loadTasksByRef(
      workflowId,
      blueprint.allStaticRefs,
      tx
    );

    // Offloaded payloads are fetched here, before the decider runs. The decider
    // reads a `ref` payload as absent rather than failing, so an unresolved ref
    // does not raise an error — it makes `${bigTask.output.status}` evaluate to
    // undefined and the workflow silently takes the wrong branch. Resolution
    // has to be exhaustive for offloading to be safe at all.
    const state: EvaluationState = {
      workflow: await this.inlineWorkflow(workflow),
      pending: await this.inlineTasks(pending),
      completed: await this.inlineTasks(completed),
      resolvedRefs: await this.inlineRefs(resolvedRefs),
      hasAnyTask:
        pending.length > 0 ||
        completed.length > 0 ||
        (await this.workflows.hasAnyTask(workflowId, tx)),
      now: new Date(),
      env: this.environment ? await this.environment.load(workflow.namespaceId) : undefined,
    };

    // 4. Pure decision.
    // Policy is needed for tasks about to be *scheduled*, so the list comes
    // from the blueprint rather than from rows that already exist. Deriving it
    // from existing tasks arms no deadlines on a first evaluation, because at
    // that point there are none.
    const defs = this.taskDefs
      ? await this.taskDefs.load(
          workflow.namespaceId,
          [
            ...new Set([
              ...blueprint.allTaskDefNames,
              ...pending.map((t) => t.taskDefName),
              ...completed.map((t) => t.taskDefName),
            ]),
          ]
        )
      : undefined;

    // Which task definitions have burned their retry budget. Computed here
    // because it needs a query; the decider stays pure and honours the verdict.
    const exhaustedRetryBudgets = defs
      ? await this.workflows.findExhaustedRetryBudgets(
          workflow.namespaceId,
          [...defs.keys()],
          new Map([...defs].map(([name, def]) => [name, def.retryBudget])),
          300,
          tx
        )
      : new Set<string>();

    const decision = decide(blueprint, state, {
      taskDefs: defs,
      exhaustedRetryBudgets,
      maxConcurrentTasks: blueprint.maxConcurrentTasks,
    });

    // 5. Apply inside the same transaction.
    const { absorbedDuplicate } = await this.applyCommands(
      workflow.id,
      workflow.namespaceId,
      decision.commands,
      tx,
      defs,
      workflow
    );

    // The decider scheduled something that already existed, so its view was
    // stale and it may have declined to complete the workflow on that basis.
    // One more pass sees the true state.
    if (absorbedDuplicate) {
      await this.decideQueue.enqueue(workflow.namespaceId, workflowId, 'duplicate absorbed', tx);
    }

    // Cancel deadlines for tasks that have finished. Leaving them armed would
    // fire a timeout against work that already succeeded, and the resulting
    // TIMED_OUT would look like a real failure.
    if (this.timers) {
      for (const task of completed) {
        await this.timers.cancelForTask(workflowId, task.id, tx);
      }
    }

    // Mark exactly the completions this pass consumed. Inside the transaction,
    // so a rollback leaves them unprocessed for the next decider rather than
    // dropping them.
    await this.workflows.markTasksProcessed(
      workflowId,
      completed.map((t) => t.id),
      tx
    );

    return {
      evaluated: true,
      commandCount: decision.commands.length,
      noop: decision.noop,
    };
  }

  /**
   * Opens a callback slot and records where to send the caller.
   *
   * The token goes into the task's **output** while it is still `IN_PROGRESS`,
   * which is the only place it can usefully live: the input was resolved before
   * the task existed, and by the time the task completes the URL is no longer
   * needed. An orchestrating caller reads it from the execution view and hands
   * it to the third party.
   *
   * A known limitation, recorded rather than hidden: an *earlier task in the
   * same workflow* cannot reference it, because expressions resolve only
   * terminal tasks. Passing the URL to a third party from inside the same
   * workflow therefore needs expression support for pending-task output.
   */
  /**
   * Carries a finished child's outcome back to the parent waiting on it.
   *
   * A `SUB_WORKFLOW` task stays open until its child reaches a terminal state,
   * and **nothing was closing it**. The child started, ran and completed with
   * its parent links correctly set, and the parent sat on a `SCHEDULED`
   * sub-workflow task until its timeout — the whole operator was non-functional
   * end to end, invisible because the decider's own tests stop at the command
   * and the store's tests drove the child by hand.
   *
   * It has to happen here rather than in the decider: `decide` is pure and sees
   * one workflow's state, so a child's outcome is not something it can know.
   *
   * Both writes share the child's transaction, so a parent is never woken for a
   * child whose completion rolled back.
   */
  private async reportToParent(
    workflow: WorkflowExecution | undefined,
    status: TaskStatus,
    output: Record<string, JsonValue> | undefined,
    reason: string | undefined,
    tx: DbTransaction
  ): Promise<void> {
    if (!workflow?.parentWorkflowId || !workflow.parentTaskId) return;

    await this.workflows.completeTask(
      workflow.parentWorkflowId,
      workflow.parentTaskId,
      status,
      output,
      reason,
      // No fencing token: the child's own completion is the authority here, and
      // there is no lease on a sub-workflow task because no worker holds it.
      undefined,
      tx
    );

    await this.decideQueue.enqueue(
      workflow.namespaceId,
      workflow.parentWorkflowId,
      'sub-workflow finished',
      tx
    );
  }

  /**
   * Puts a `HUMAN` task in somebody's inbox.
   *
   * Opened in the same transaction that creates the task, for the same reason
   * as a webhook callback: a rolled-back evaluation must not leave an inbox
   * entry for a task that never existed.
   *
   * A task may name a person, a group, or neither. A group that does not exist
   * is an error rather than a silent fallback to the open pool: routing an
   * approval to "the payments team" and landing it in everyone's inbox is
   * exactly the mistake the naming was meant to prevent.
   */
  private async openHumanTask(
    namespaceId: string,
    workflowId: string,
    taskId: string,
    command: { refName: string; input: Record<string, JsonValue> },
    tx: DbTransaction,
    assigneeGroupId?: string,
    assignments?: ResolvedAssignment[],
    triggers?: HumanTaskTrigger[]
  ): Promise<void> {
    if (!this.humanTasks) {
      throw new NodeFlowError(
        ErrorCode.INTERNAL,
        `cannot schedule "${command.refName}": HUMAN requires a human-task repository`
      );
    }

    const input = command.input;
    const assigneeId = typeof input['assigneeId'] === 'string' ? input['assigneeId'] : undefined;

    // Named by name, because a definition is written by a person and a group id
    // is not something anyone types.

    const dueIn = typeof input['dueInSeconds'] === 'number' ? input['dueInSeconds'] : undefined;
    const form = input['form'];

    await this.humanTasks.open(
      {
        namespaceId,
        workflowId,
        taskId,
        refName: command.refName,
        // The title is what a person reads in a list of twenty. Falling back to
        // the ref name is better than an empty row, but only just.
        title: typeof input['title'] === 'string' ? input['title'] : command.refName,
        description: typeof input['description'] === 'string' ? input['description'] : undefined,
        form:
          typeof form === 'object' && form !== null && !Array.isArray(form)
            ? (form as Record<string, unknown>)
            : undefined,
        assigneeId,
        assigneeGroupId,
        dueInSeconds: dueIn,
        assignments,
        completionStrategy: input['assignmentCompletionStrategy'] === 'TERMINATE' ? 'TERMINATE' : 'LEAVE_OPEN',
        autoClaim: input['autoClaim'] === true,
        triggers,
      },
      tx
    );
  }

  private async openCallback(
    namespaceId: string,
    workflowId: string,
    taskId: string,
    command: { refName: string; input: Record<string, JsonValue> },
    tx: DbTransaction
  ): Promise<void> {
    // Not optional in practice, only in the constructor — unit tests build an
    // Evaluator without one. Returning quietly here is what the first wiring of
    // this cost us: the task was scheduled, went IN_PROGRESS, and waited forever
    // on a token that was never minted. A task that can only be completed by a
    // callback is unrunnable without this, so say so instead of hanging.
    if (!this.webhooks) {
      throw new NodeFlowError(
        ErrorCode.INTERNAL,
        `cannot schedule "${command.refName}": WAIT_FOR_WEBHOOK requires a webhook repository`
      );
    }

    const expiresIn = command.input['expiresInSeconds'];
    const signingKey = command.input['signingKey'];

    const minted = await this.webhooks.mint(
      {
        namespaceId,
        workflowId,
        taskId,
        refName: command.refName,
        expiresInSeconds: typeof expiresIn === 'number' ? expiresIn : undefined,
        signingKey: typeof signingKey === 'string' ? signingKey : undefined,
      },
      tx
    );

    await this.workflows.setTaskOutput(
      workflowId,
      taskId,
      {
        callbackToken: minted.token,
        callbackPath: `/v1/ns/${namespaceId}/webhooks/${minted.token}`,
        ...(minted.expiresAt ? { expiresAt: minted.expiresAt.toISOString() } : {}),
      },
      tx
    );
  }

  /**
   * The reason a task's input fails its declared schema, if it does.
   *
   * Returns a message rather than throwing, so the caller decides what to do
   * with it — which here means failing one task, not the pass.
   */
  /**
   * Resolves a `HUMAN` task's group routing, by name.
   *
   * Named by name because a definition is written by a person and a group id is
   * not something anyone types.
   *
   * A group that does not exist is reported as a **task** failure, never
   * thrown. Throwing aborts and rolls back the pass, so the decider re-derives
   * the same input on the next wakeup and the workflow spins forever — the same
   * reasoning as a schema violation, and the reason this shape was kept when
   * the routing itself stopped being a refusal.
   *
   * It is not a silent fallback to the open pool either: routing an approval to
   * "the payments team" and landing it in everyone's inbox is exactly the
   * mistake that naming a group was meant to prevent.
   */
  private async resolveRouting(
    namespaceId: string,
    command: { taskType: TaskType; refName: string; input: Record<string, JsonValue> },
    tx: DbTransaction
  ): Promise<{ groupId?: string; violation?: string; assignments?: ResolvedAssignment[]; triggers?: HumanTaskTrigger[] }> {
    if (command.taskType !== TaskType.HUMAN) return {};

    // An assignment chain names people by email and teams by name, because
    // that is what someone writing a definition knows. Each is resolved now:
    // an escalation to a team that does not exist would be discovered only
    // when the first link's window closed, by which point nobody is watching.
    const resolvedChain = await resolveAssignments(tx, namespaceId, command.input['assignments']);
    if ('violation' in resolvedChain) return { violation: resolvedChain.violation };
    const assignments = resolvedChain.assignments;

    const resolvedTriggers = await resolveTriggers(tx, namespaceId, command.input['triggers']);
    if ('violation' in resolvedTriggers) return { violation: resolvedTriggers.violation };
    const triggers = resolvedTriggers.triggers;

    // A form template that does not exist fails the task for the same reason a
    // missing group does: thrown, it would roll the pass back and retry forever.
    const form: unknown = command.input['form'];
    if (isFormReference(form)) {
      const template = await tx
        .selectFrom('FormTemplates')
        .select('version')
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', form.template)
        .$if(form.version !== undefined, (q) => q.where('version', '=', form.version as number))
        .executeTakeFirst();
      if (!template) {
        return {
          violation: `form "${form.template}"${form.version ? ` version ${form.version}` : ''} does not exist in this namespace`,
        };
      }
    }

    const name = command.input['candidateGroup'];
    if (typeof name !== 'string' || name === '') return { assignments, triggers };

    const group = await tx
      .selectFrom('Groups')
      .select('id')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();

    return group
      ? { groupId: group.id, assignments, triggers }
      : { violation: `routed to group "${name}", which does not exist in this namespace` };
  }

  private inputViolation(
    command: { taskDefName: string; input: Record<string, JsonValue> },
    defs?: Map<string, TaskDefinition>
  ): string | undefined {
    if (!this.schemas || !defs) return undefined;

    try {
      this.schemas.assertValid(defs.get(command.taskDefName), 'input', command.input);
      return undefined;
    } catch (error) {
      if (error instanceof SchemaValidationError) return error.message;
      throw error;
    }
  }

  /**
   * Fetches every offloaded payload an evaluation will read.
   *
   * These reads happen while the workflow row lock is held, which lengthens the
   * critical section — the cost of offloading, and the reason the threshold is
   * set where it is. Nothing is written, so a slow blob store delays an
   * evaluation but can never corrupt one.
   */
  private async inlineWorkflow(workflow: WorkflowExecution): Promise<WorkflowExecution> {
    if (!this.payloads) return workflow;
    if (workflow.input.kind === 'inline' && workflow.output?.kind !== 'ref') return workflow;

    return {
      ...workflow,
      input: (await this.payloads.inline(workflow.input)) ?? workflow.input,
      output: await this.payloads.inline(workflow.output),
    };
  }

  private async inlineTask(task: TaskExecution): Promise<TaskExecution> {
    if (!this.payloads) return task;
    if (task.input.kind === 'inline' && task.output?.kind !== 'ref') return task;

    return {
      ...task,
      input: (await this.payloads.inline(task.input)) ?? task.input,
      output: await this.payloads.inline(task.output),
    };
  }

  private async inlineTasks(tasks: TaskExecution[]): Promise<TaskExecution[]> {
    if (!this.payloads) return tasks;
    return Promise.all(tasks.map((task) => this.inlineTask(task)));
  }

  private async inlineRefs(
    refs: Map<string, TaskExecution>
  ): Promise<Map<string, TaskExecution>> {
    if (!this.payloads) return refs;
    return new Map(
      await Promise.all(
        [...refs].map(async ([key, task]) => [key, await this.inlineTask(task)] as const)
      )
    );
  }

  /**
   * Applies the decider's commands.
   *
   * Returns whether any schedule was **absorbed** as a duplicate. That signal
   * matters: the decider is pure and cannot see the database, so it may emit a
   * schedule for a task that already exists. It then treats itself as "still
   * working" and declines to complete the workflow — while the insert did
   * nothing, so no completion arrives to trigger another pass. The workflow
   * stalls at RUNNING with everything finished.
   *
   * The caller re-enqueues an evaluation when this is true. One extra pass sees
   * the real state and finishes, which is the usual trade: a redundant
   * evaluation is cheap, a stalled workflow is not.
   */
  private async applyCommands(
    workflowId: string,
    namespaceId: string,
    commands: Command[],
    tx: DbTransaction,
    defs?: Map<string, TaskDefinition>,
    workflow?: WorkflowExecution
  ): Promise<{ absorbedDuplicate: boolean }> {
    let absorbedDuplicate = false;
    // History is appended once at the end of the pass so the sequence reflects
    // the order the decider decided things, not the order they were applied.
    const history: NewWorkflowEvent[] = [];
    // SetTimer arrives after the ScheduleTask it guards, and needs that task's
    // generated id to attach to.
    const scheduledTaskIds = new Map<string, string>();
    const routing = workflow?.taskToDomain;

    for (const original of commands) {
      // The run's own routing, applied to worker tasks before anything is written,
      // so the task row and its queue always agree on the domain.
      const command = routeToDomain(original, routing);
      switch (command.type) {
        case 'ScheduleTask': {
          // An input that violates the declared contract fails *this task*
          // rather than the evaluation.
          //
          // Throwing here would abort the whole pass and roll it back, so the
          // decider would re-derive the same bad input on the next wakeup and
          // the workflow would spin forever. Recording the failure lets the
          // retry and timeout machinery treat it like any other bad task, and
          // puts the reason where someone debugging will find it.
          const routing = await this.resolveRouting(namespaceId, command, tx);
          const violation = this.inputViolation(command, defs) ?? routing.violation;
          if (violation) {
            await this.workflows.insertTask(
              {
                workflowId,
                namespaceId,
                refName: command.refName,
                taskDefName: command.taskDefName,
                taskType: command.taskType,
                status: TaskStatus.FAILED_WITH_TERMINAL_ERROR,
                attempt: command.attempt,
                iteration: command.iteration,
                parentRefName: command.parentRefName,
                domain: command.domain,
                input: command.input,
                reason: violation,
              },
              tx
            );

            history.push({
              type: WorkflowEventType.TASK_FAILED,
              payload: { refName: command.refName, reason: violation },
            });

            await this.decideQueue.enqueue(namespaceId, workflowId, 'schema violation', tx);
            break;
          }

          // A fresh cached output settles the task here, exactly like an
          // operator resolved in-pass: inserted COMPLETED, never queued.
          let resolved = command.resolved;
          if (!resolved && command.cache) {
            const cached = await this.workflows.cachedOutput(namespaceId, command.taskDefName, command.cache.key, tx);
            if (cached) resolved = { status: TaskStatus.COMPLETED, output: { ...cached } };
          }

          const inserted = await this.workflows.insertTask(
            {
              workflowId,
              namespaceId,
              refName: command.refName,
              taskDefName: command.taskDefName,
              taskType: command.taskType,
              cache: resolved ? undefined : command.cache,
              // A timer-backed task starts IN_PROGRESS: nothing will ever pick
              // it up, so SCHEDULED would misreport it as waiting for a worker
              // in every view an operator looks at.
              status:
                resolved?.status ??
                // A YIELD is waiting for a signal from the moment it exists; recording
                // it as SCHEDULED said something would pick it up, and nothing will.
                (isWaitingTask(command.taskType) || command.taskType === TaskType.YIELD
                  ? TaskStatus.IN_PROGRESS
                  : TaskStatus.SCHEDULED),
              attempt: command.attempt,
              iteration: command.iteration,
              parentRefName: command.parentRefName,
              domain: command.domain,
              input: command.input,
              output: resolved?.output,
              // Only what the decider walked past; a cache hit or a task at the depth limit was not.
              seenByDecider: command.continuedInPass === true,
            },
            tx
          );

          // Absent means the unique constraint absorbed a duplicate schedule —
          // a redundant evaluation, which must not enqueue work but must be
          // reported, or the workflow can stall believing it is still busy.
          if (!inserted) {
            absorbedDuplicate = true;
            break;
          }

          scheduledTaskIds.set(command.refName, inserted.id);

          // A task waiting on a third party needs somewhere for that party to
          // call back to. Minted here, in the same transaction that creates the
          // task — a rolled-back evaluation must not leave a live token for a
          // task that never existed.
          if (isExternallyCompleted(command.taskType)) {
            if (command.taskType === TaskType.HUMAN) {
              await this.openHumanTask(
                namespaceId,
                workflowId,
                inserted.id,
                command,
                tx,
                routing.groupId,
                routing.assignments,
                routing.triggers
              );
            } else if (command.taskType === TaskType.PULL_WORKFLOW_MESSAGES) {
              // Messages may already be waiting; if so the pull completes in
              // this same transaction. Loud when unwired, for the reason
              // `openCallback` gives: a pull nothing can deliver to hangs forever.
              if (!this.messages) {
                throw new NodeFlowError(
                  ErrorCode.INTERNAL,
                  `cannot schedule "${command.refName}": PULL_WORKFLOW_MESSAGES requires a message repository`
                );
              }
              await this.messages.deliver(namespaceId, workflowId, tx);
            } else {
              await this.openCallback(namespaceId, workflowId, inserted.id, command, tx);
            }
          }
          history.push({
            type: resolved
              ? WorkflowEventType.TASK_COMPLETED
              : WorkflowEventType.TASK_SCHEDULED,
            payload: {
              refName: command.refName,
              taskDefName: command.taskDefName,
              taskType: command.taskType,
              iteration: command.iteration,
              attempt: command.attempt,
              ...(resolved && !command.resolved ? { fromCache: true } : {}),
            },
          });

          if (!resolved) {
            // Operators are resolved by the decider, never by a worker. A
            // DO_WHILE or SUB_WORKFLOW stays IN_PROGRESS until its loop or child
            // finishes; putting either on a worker queue would strand it waiting
            // for a worker that has no idea what to do with it.
            //
            // A WAIT is excluded for a different reason: it is completed by a
            // timer, and queueing it would hold a lease for the whole duration —
            // so a seven-day wait would be reclaimed as abandoned within a
            // minute of being scheduled.
            if (!isOperator(command.taskType) && !isWaitingTask(command.taskType)) {
              await this.taskQueue.enqueue(
                {
                  namespaceId,
                  queueName: queueNameFor(command.taskDefName, command.domain),
                  taskId: inserted.id,
                  workflowId,
                  taskType: command.taskType,
                  delaySeconds: command.delaySeconds,
                },
                tx
              );
            }
          } else {
            // An operator settled in-pass changes the frontier, so the workflow
            // needs another evaluation to act on it.
            await this.decideQueue.enqueue(namespaceId, workflowId, 'operator resolved', tx);
          }
          break;
        }

        case 'RetryTask': {
          const inserted = await this.workflows.insertTask(
            {
              workflowId,
              namespaceId,
              refName: command.refName,
              taskDefName: command.taskDefName,
              taskType: command.taskType,
              status: TaskStatus.SCHEDULED,
              attempt: command.attempt,
              // A retry replaces the failed attempt at the same identity, so it
              // is written at the next iteration slot to satisfy the unique
              // index while remaining the same logical step.
              iteration: command.iteration,
              parentRefName: command.parentRefName,
              domain: command.domain,
              input: command.input,
            },
            tx
          );
          // The same rule the schedule path applies, for the same reason: an
          // operator is resolved by the decider and a waiting task by a timer
          // or a callback, so queueing either strands it on a queue no worker
          // serves. A retried `SUB_WORKFLOW` landed there and waited forever.
          if (inserted && !isOperator(command.taskType) && !isWaitingTask(command.taskType)) {
            await this.taskQueue.enqueue(
              {
                namespaceId,
                // Same queue as the attempt it replaces.
                queueName: queueNameFor(command.taskDefName, command.domain),
                taskId: inserted.id,
                workflowId,
                taskType: command.taskType,
                delaySeconds: command.delaySeconds,
              },
              tx
            );
          } else if (!inserted) {
            absorbedDuplicate = true;
          }
          history.push({
            type: WorkflowEventType.TASK_RETRIED,
            payload: {
              refName: command.refName,
              attempt: command.attempt,
              delaySeconds: command.delaySeconds,
              previousTaskId: command.previousTaskId,
            },
          });
          break;
        }

        case 'SkipTask': {
          // Recorded only when the row is new. The decider re-derives skips on
          // passes after the one that made them, and the insert is idempotent —
          // the history was not, so one skipped branch read as skipped three times.
          const skipped = await this.workflows.insertTask(
            {
              workflowId,
              namespaceId,
              refName: command.refName,
              taskDefName: command.refName,
              taskType: 'NOOP',
              status: TaskStatus.SKIPPED,
              attempt: 0,
              iteration: command.iteration,
              input: {},
              output: { reason: command.reason },
            },
            tx
          );
          if (skipped) {
            history.push({
              type: WorkflowEventType.TASK_SKIPPED,
              payload: { refName: command.refName, reason: command.reason },
            });
          }
          break;
        }

        case 'CompleteTask':
          await this.workflows.completeTask(
            workflowId,
            command.taskId,
            TaskStatus.COMPLETED,
            command.output,
            undefined,
            undefined,
            tx
          );
          break;

        case 'FailTask':
          await this.workflows.completeTask(
            workflowId,
            command.taskId,
            command.status,
            undefined,
            command.reason,
            undefined,
            tx
          );
          break;

        case 'SetVariable':
          await this.workflows.mergeVariables(workflowId, command.values, tx);
          history.push({ type: WorkflowEventType.VARIABLES_SET, payload: command.values });
          break;

        case 'PublishEvent':
          // Into the outbox, in this transaction — so the event and the task's
          // completion commit together or not at all. The relay delivers it
          // after commit, which is the whole point of the outbox.
          await this.outbox.publish(
            namespaceId,
            command.sink,
            {
              ...command.payload,
              // Carried through to the subscriber: delivery is at-least-once,
              // so a consumer needs something stable to deduplicate on.
              _event: {
                id: command.idempotencyKey,
                workflowId,
                sink: command.sink,
              },
            },
            tx
          );
          history.push({
            type: WorkflowEventType.EVENT_PUBLISHED,
            payload: { sink: command.sink, id: command.idempotencyKey },
          });
          break;

        case 'CompleteWorkflow':
          await this.workflows.setStatus(
            workflowId,
            WorkflowStatus.COMPLETED,
            command.output,
            undefined,
            tx
          );
          history.push({
            type: WorkflowEventType.WORKFLOW_COMPLETED,
            payload: { output: command.output },
          });
          await this.reportToParent(workflow, TaskStatus.COMPLETED, command.output, undefined, tx);
          break;

        case 'FailWorkflow':
          await this.workflows.setStatus(
            workflowId,
            command.status,
            undefined,
            command.reason,
            tx
          );
          history.push({
            type: WorkflowEventType.WORKFLOW_FAILED,
            payload: { status: command.status, reason: command.reason },
          });
          await this.reportToParent(workflow, TaskStatus.FAILED, undefined, command.reason, tx);
          break;

        case 'StartSubWorkflow':
          // Emitted through the outbox so the child is started after this
          // transaction commits — starting it inline would leak a side effect
          // that a rollback could not undo.
          await this.outbox.publish(
            namespaceId,
            'subworkflow.start',
            {
              parentWorkflowId: workflowId,
              parentTaskRefName: command.parentTaskRefName,
              parentTaskAttempt: command.parentTaskAttempt,
              defName: command.defName,
              defVersion: command.defVersion ?? null,
              input: command.input as JsonValue,
              // A child runs on the same workers as its parent unless told otherwise:
              // the parent's routing, with the task's own entries on top.
              taskToDomain: mergeDomains(routing, command.taskToDomain),
            },
            tx
          );
          break;

        case 'StartWorkflow':
          await this.outbox.publish(
            namespaceId,
            'workflow.start',
            {
              defName: command.defName,
              defVersion: command.defVersion ?? null,
              input: command.input as JsonValue,
              idempotencyKey: command.idempotencyKey ?? null,
              correlationId: command.correlationId ?? null,
            },
            tx
          );
          break;

        case 'SetTimer': {
          if (!this.timers) break;
          // Deadlines are armed in the same transaction as the task they guard,
          // so a rollback cannot leave a timer pointing at a task that was never
          // created.
          await this.timers.schedule(
            {
              kind: command.kind,
              namespaceId,
              workflowId,
              taskId: command.refName ? scheduledTaskIds.get(command.refName) : undefined,
              fireAfterSeconds: command.fireAfterSeconds,
              payload: { refName: command.refName ?? null },
            },
            tx
          );
          break;
        }
      }
    }

    if (this.events) await this.events.append(workflowId, history, tx);

    return { absorbedDuplicate };
  }
}

/**
 * Applies a run's `taskToDomain` to a worker task: its definition name first,
 * then `*`, then whatever domain the definition gave it.
 *
 * Worker (SIMPLE) tasks only. System tasks are leased by this server's own
 * runner from their plain queues, so routing one to a domain would strand it
 * on a queue nothing polls.
 */
function routeToDomain(command: Command, routing: Record<string, string> | undefined): Command {
  if (!routing || (command.type !== 'ScheduleTask' && command.type !== 'RetryTask')) return command;
  if (command.taskType !== TaskType.SIMPLE) return command;
  const domain = routing[command.taskDefName] ?? routing['*'];
  return domain ? { ...command, domain } : command;
}

function mergeDomains(
  parent: Record<string, string> | undefined,
  own: Record<string, string> | undefined
): Record<string, string> | null {
  const merged = { ...(parent ?? {}), ...(own ?? {}) };
  return Object.keys(merged).length ? merged : null;
}
