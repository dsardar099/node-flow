import { TaskStatus, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, Queryable } from './database.js';
import { randomUUID } from 'node:crypto';
import type { OutboxRepository } from './outbox.repository.js';
import { HUMAN_TASK_EVENTS, json, type HumanTaskEvent, type HumanTaskTrigger, type ResolvedAssignment } from './schema.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { isFormReference, type FormTemplateRepository } from './form-template.repository.js';
import type { SchemaValidator, SchemaViolation } from './schema-validator.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * The inbox behind `HUMAN`.
 *
 * Everything here exists to answer one question correctly under concurrency:
 * **who is allowed to finish this task?** An inbox is, by construction, a
 * shared list several people are looking at simultaneously, and the failure
 * mode is not an error message — it is two people doing the same work, or one
 * person's answer silently overwriting another's.
 *
 * So possession is explicit and claimed with a conditional update, and
 * completion requires holding it.
 */

export interface OpenHumanTask {
  namespaceId: string;
  workflowId: string;
  taskId: string;
  refName: string;
  title: string;
  description?: string;
  /** An inline JSON Schema, or `{ template, version? }` naming a user form. */
  form?: Record<string, unknown>;
  /** Pre-assignment, when the workflow names a person. */
  assigneeId?: string;
  /** Routed to a team; anyone in it may claim. */
  assigneeGroupId?: string;
  dueInSeconds?: number;
  /** An escalation chain; the first link becomes the assignee. */
  assignments?: ResolvedAssignment[];
  completionStrategy?: 'LEAVE_OPEN' | 'TERMINATE';
  /** Claim for the assignee immediately whenever it is a single person. */
  autoClaim?: boolean;
  /** Workflows to start as the task changes state. */
  triggers?: HumanTaskTrigger[];
}

export interface HumanTaskView {
  id: string;
  workflowId: string;
  taskId: string;
  refName: string;
  title: string;
  description: string | null;
  form: Record<string, unknown> | null;
  assigneeId: string | null;
  assigneeGroupId: string | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  completedBy: string | null;
  completedAt: Date | null;
  dueAt: Date | null;
  createdAt: Date;
  formTemplate: string | null;
  formVersion: number | null;
  assignments: ResolvedAssignment[] | null;
  assignmentIndex: number;
  assignedAt: Date;
  completionStrategy: string;
  skippedReason: string | null;
  autoClaim: boolean;
  triggers: HumanTaskTrigger[] | null;
}

export type ClaimResult =
  | { ok: true; task: HumanTaskView }
  | { ok: false; reason: 'unknown' | 'completed' | 'held_by_other' | 'not_yours' };

export type ReleaseResult =
  | { ok: true; task: HumanTaskView }
  | { ok: false; reason: 'unknown' | 'completed' | 'not_holder' };

export type CompleteResult =
  | { ok: true; workflowId: string; refName: string }
  | { ok: false; reason: 'unknown' | 'completed' | 'not_holder' | 'not_waiting' }
  | { ok: false; reason: 'invalid'; violations: SchemaViolation[] };

const COLUMNS = [
  'id',
  'workflowId',
  'taskId',
  'refName',
  'title',
  'description',
  'form',
  'assigneeId',
  'assigneeGroupId',
  'claimedBy',
  'claimedAt',
  'completedBy',
  'completedAt',
  'dueAt',
  'createdAt',
  'formTemplate',
  'formVersion',
  'assignments',
  'assignmentIndex',
  'assignedAt',
  'completionStrategy',
  'skippedReason',
  'autoClaim',
  'triggers',
] as const;

export class HumanTaskRepository {
  constructor(
    private readonly db: Db,
    private readonly workflows: WorkflowRepository,
    private readonly decideQueue: DecideQueueRepository,
    /** Resolves `{ template }` form references when a task opens. */
    private readonly forms?: FormTemplateRepository,
    /** Checks a response against the task's form before accepting it. */
    private readonly validator?: SchemaValidator,
    /** Starts trigger workflows, in the transaction that changed the task. */
    private readonly outbox?: OutboxRepository
  ) {}

  /**
   * Starts the workflows a task declared for `event`.
   *
   * Published to the outbox inside the caller's transaction, so a trigger fires
   * exactly when the change it describes commits — never for a claim that
   * rolled back, and never lost to a crash between the two. The idempotency key
   * is minted here and carried by the outbox row, so a redelivery starts
   * nothing twice.
   */
  private async fire(
    tx: Queryable,
    namespaceId: string,
    task: Pick<
      HumanTaskView,
      'id' | 'workflowId' | 'refName' | 'title' | 'triggers' | 'assigneeId' | 'assigneeGroupId' | 'claimedBy' | 'completedBy'
    >,
    event: HumanTaskEvent,
    extra: Record<string, JsonValue> = {}
  ): Promise<void> {
    const matching = (task.triggers ?? []).filter((trigger) => trigger.on === event);
    if (matching.length === 0) return;
    if (!this.outbox) throw new Error(`human task "${task.refName}" has triggers but no outbox is configured`);

    for (const trigger of matching) {
      await this.outbox.publish(
        namespaceId,
        'workflow.start',
        {
          defName: trigger.workflow,
          defVersion: trigger.version ?? null,
          input: {
            event,
            humanTaskId: task.id,
            taskRef: task.refName,
            title: task.title,
            workflowId: task.workflowId,
            assigneeId: task.assigneeId,
            assigneeGroupId: task.assigneeGroupId,
            claimedBy: task.claimedBy,
            completedBy: task.completedBy,
            ...extra,
          },
          idempotencyKey: `human-task:${task.id}:${event}:${randomUUID()}`,
          correlationId: task.workflowId,
        },
        tx
      );
    }
  }

  /** ASSIGNED for a task that has an assignee, then CLAIMED if it was auto-claimed. */
  private async fireAssigned(tx: Queryable, namespaceId: string, task: HumanTaskView): Promise<void> {
    if (!task.assigneeId && !task.assigneeGroupId) return;
    await this.fire(tx, namespaceId, task, 'ASSIGNED', { assignmentIndex: task.assignmentIndex });
    if (task.autoClaim && task.claimedBy) await this.fire(tx, namespaceId, task, 'CLAIMED', { autoClaimed: true });
  }

  /**
   * Puts a task in the inbox.
   *
   * Called by the applier as the task is scheduled, inside the same
   * transaction — so a rolled-back evaluation cannot leave an inbox entry for a
   * task that was never created.
   */
  async open(input: OpenHumanTask, tx: Queryable): Promise<string> {
    // A template reference is copied, not linked: the form a person opens must
    // be the form the task was created with, whatever happens to the template.
    let form = input.form;
    let template: { name: string; version: number } | undefined;
    if (isFormReference(form)) {
      if (!this.forms) throw new Error('a form template was referenced but no form repository is configured');
      const found = await this.forms.require(input.namespaceId, form, tx);
      form = found.schema;
      template = { name: found.name, version: found.version };
    }

    // The first link of a chain is the assignee; otherwise what was named.
    const assigneeId = input.assignments?.[0]
      ? input.assignments[0].kind === 'user'
        ? input.assignments[0].id
        : null
      : (input.assigneeId ?? null);
    const autoClaim = input.autoClaim === true;

    const row = await tx
      .insertInto('HumanTasks')
      .values({
        namespaceId: input.namespaceId,
        workflowId: input.workflowId,
        taskId: input.taskId,
        refName: input.refName,
        title: input.title,
        description: input.description ?? null,
        form: form === undefined ? null : json(form),
        formTemplate: template?.name ?? null,
        formVersion: template?.version ?? null,
        assigneeId,
        assigneeGroupId: input.assignments?.[0]
          ? input.assignments[0].kind === 'group'
            ? input.assignments[0].id
            : null
          : (input.assigneeGroupId ?? null),
        assignments: input.assignments?.length ? json(input.assignments) : null,
        completionStrategy: input.completionStrategy ?? 'LEAVE_OPEN',
        dueAt: input.dueInSeconds
          ? sql<Date>`now() + make_interval(secs => ${input.dueInSeconds})`
          : null,
        autoClaim,
        triggers: input.triggers?.length ? json(input.triggers) : null,
        ...(autoClaim && assigneeId ? { claimedBy: assigneeId, claimedAt: sql<Date>`now()` } : {}),
      })
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();

    await this.fireAssigned(tx, input.namespaceId, row as HumanTaskView);
    return row.id;
  }

  /**
   * Every task in the namespace, for an operator: what is stuck, with whom, and
   * for how long. Not filtered by assignment — that is what the inbox is for.
   */
  async search(
    namespaceId: string,
    filter: {
      state?: 'open' | 'unclaimed' | 'claimed' | 'completed' | 'all';
      /** A person: assigned to them, or holding it. */
      userId?: string;
      groupId?: string;
      workflowId?: string;
      /** Case-insensitive match on title or task ref. */
      text?: string;
      /** Only tasks created at least this many minutes ago. */
      olderThanMinutes?: number;
      /** Workflows the caller may not see; their tasks are left out. */
      excludeDefNames?: string[];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ tasks: HumanTaskView[]; hasMore: boolean }> {
    const state = filter.state ?? 'open';
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);

    const rows = await this.db
      .selectFrom('HumanTasks')
      .select(COLUMNS)
      .where('namespaceId', '=', namespaceId)
      .$if(state === 'open', (q) => q.where('completedAt', 'is', null))
      .$if(state === 'unclaimed', (q) => q.where('completedAt', 'is', null).where('claimedBy', 'is', null))
      .$if(state === 'claimed', (q) => q.where('completedAt', 'is', null).where('claimedBy', 'is not', null))
      .$if(state === 'completed', (q) => q.where('completedAt', 'is not', null))
      .$if(filter.userId !== undefined, (q) =>
        q.where((eb) =>
          eb.or([
            eb('assigneeId', '=', filter.userId as string),
            eb('claimedBy', '=', filter.userId as string),
            eb('completedBy', '=', filter.userId as string),
          ])
        )
      )
      .$if(filter.groupId !== undefined, (q) => q.where('assigneeGroupId', '=', filter.groupId as string))
      .$if(filter.workflowId !== undefined, (q) => q.where('workflowId', '=', filter.workflowId as string))
      .$if((filter.excludeDefNames?.length ?? 0) > 0, (q) =>
        q.where('workflowId', 'not in', (eb) =>
          eb.selectFrom('WorkflowExecutions').select('id').where('namespaceId', '=', namespaceId).where('defName', 'in', filter.excludeDefNames as string[])
        )
      )
      .$if(Boolean(filter.text?.trim()), (q) => {
        const pattern = `%${(filter.text as string).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        return q.where((eb) => eb.or([eb('title', 'ilike', pattern), eb('refName', 'ilike', pattern)]));
      })
      .$if((filter.olderThanMinutes ?? 0) > 0, (q) =>
        q.where('createdAt', '<=', sql<Date>`now() - make_interval(mins => ${filter.olderThanMinutes})`)
      )
      // Open work oldest first, like the inbox; finished work newest first.
      .orderBy('createdAt', state === 'completed' || state === 'all' ? 'desc' : 'asc')
      .orderBy('id')
      .limit(limit + 1)
      .offset(offset)
      .execute();

    return { tasks: rows.slice(0, limit) as HumanTaskView[], hasMore: rows.length > limit };
  }

  /**
   * What one person should be looking at.
   *
   * Assigned-to-me *or* unassigned — never another person's assignment, and
   * never something someone else is already holding. An inbox that shows work
   * you cannot take is an inbox people stop reading.
   */
  async inbox(
    namespaceId: string,
    userId: string,
    options: { includeCompleted?: boolean; limit?: number; groupIds?: string[] } = {}
  ): Promise<HumanTaskView[]> {
    const groupIds = options.groupIds ?? [];
    let query = this.db
      .selectFrom('HumanTasks')
      .select(COLUMNS)
      .where('namespaceId', '=', namespaceId);

    if (!options.includeCompleted) {
      query = query.where('completedAt', 'is', null);
    }

    const rows = await query
      .where((eb) =>
        eb.or([
          eb('assigneeId', '=', userId),
          eb('claimedBy', '=', userId),
          // Routed to one of my teams and not yet taken.
          ...(groupIds.length > 0
            ? [eb.and([eb('assigneeGroupId', 'in', groupIds), eb('claimedBy', 'is', null)])]
            : []),
          eb.and([
            eb('assigneeId', 'is', null),
            eb('assigneeGroupId', 'is', null),
            eb('claimedBy', 'is', null),
          ]),
        ])
      )
      // Oldest first: an inbox ordered newest-first quietly starves the tasks
      // that have been waiting longest, which are the ones that matter.
      .orderBy('createdAt', 'asc')
      .limit(Math.min(options.limit ?? 50, 200))
      .execute();

    return rows as HumanTaskView[];
  }

  async findById(namespaceId: string, id: string): Promise<HumanTaskView | undefined> {
    const row = await this.db
      .selectFrom('HumanTasks')
      .select(COLUMNS)
      .where('namespaceId', '=', namespaceId)
      .where('id', '=', id)
      .executeTakeFirst();

    return row as HumanTaskView | undefined;
  }

  /**
   * Takes possession.
   *
   * **One conditional statement, not a read followed by a write.** An earlier
   * version checked the row first and updated after, and that is subtly wrong
   * in a way tests do not reliably catch: whether two simultaneous claims
   * collide then depends on how their reads and writes interleave, so the race
   * is real but only sometimes reachable. Deleting the guard from the update
   * left every test passing.
   *
   * As a single `UPDATE … WHERE claimedBy IS NULL`, Postgres serialises the two
   * on the row lock and the loser re-evaluates the predicate *after* the winner
   * commits, matching nothing. The outcome no longer depends on timing at all,
   * and removing the predicate fails a test rather than waiting to be a support
   * ticket about two people doing the same work.
   *
   * A second read happens only when nothing was updated, to say *why*.
   */
  async claim(
    namespaceId: string,
    id: string,
    userId: string,
    groupIds: string[] = []
  ): Promise<ClaimResult> {
    const claimed = await this.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('HumanTasks')
        .set({ claimedBy: userId, claimedAt: sql<Date>`now()` })
        .where('namespaceId', '=', namespaceId)
        .where('id', '=', id)
        .where('claimedBy', 'is', null)
        .where('completedAt', 'is', null)
        // An assignment is a statement about who the work is for; letting anyone
        // claim past it would make assignment decorative. A *group* assignment
        // says the same thing about a team, so membership is what satisfies it.
        .where((eb) =>
          eb.or([
            eb.and([eb('assigneeId', 'is', null), eb('assigneeGroupId', 'is', null)]),
            eb('assigneeId', '=', userId),
            ...(groupIds.length > 0 ? [eb('assigneeGroupId', 'in', groupIds)] : []),
          ])
        )
        .returning(COLUMNS)
        .executeTakeFirst();
      if (row) await this.fire(tx, namespaceId, row as HumanTaskView, 'CLAIMED');
      return row;
    });

    if (claimed) return { ok: true, task: claimed as HumanTaskView };

    const existing = await this.findById(namespaceId, id);
    if (!existing) return { ok: false, reason: 'unknown' };
    if (existing.completedAt) return { ok: false, reason: 'completed' };
    // Re-claiming something you already hold succeeds: a double click is not an
    // error, and the update above declines it only because it is already taken.
    if (existing.claimedBy === userId) return { ok: true, task: existing };
    if (existing.claimedBy) return { ok: false, reason: 'held_by_other' };
    return { ok: false, reason: 'not_yours' };
  }

  /**
   * Gives it back to the pool.
   *
   * Only the holder may, and the assignment is deliberately left intact: "I
   * cannot get to this right now" should not also mean "this is no longer mine".
   */
  async release(namespaceId: string, id: string, userId: string): Promise<ReleaseResult> {
    const released = await this.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('HumanTasks')
        .set({ claimedBy: null, claimedAt: null })
        .where('namespaceId', '=', namespaceId)
        .where('id', '=', id)
        .where('claimedBy', '=', userId)
        .where('completedAt', 'is', null)
        .returning(COLUMNS)
        .executeTakeFirst();
      if (row) await this.fire(tx, namespaceId, row as HumanTaskView, 'RELEASED', { releasedBy: userId });
      return row;
    });

    if (released) return { ok: true, task: released as HumanTaskView };

    const existing = await this.findById(namespaceId, id);
    if (!existing) return { ok: false, reason: 'unknown' };
    if (existing.completedAt) return { ok: false, reason: 'completed' };
    return { ok: false, reason: 'not_holder' };
  }

  /**
   * Finishes the task and lets the workflow move on.
   *
   * Requires the claim. Completing without it is how one person's answer
   * silently replaces another's on a task they were actively working — the
   * inbox equivalent of a lost update, and the reason possession exists at all.
   *
   * The whole thing is one transaction: claiming the row, completing the task
   * and waking the decider either all happen or none do.
   */
  async complete(
    namespaceId: string,
    id: string,
    userId: string,
    output: Record<string, JsonValue>
  ): Promise<CompleteResult> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom('HumanTasks')
        .selectAll()
        .where('namespaceId', '=', namespaceId)
        .where('id', '=', id)
        .executeTakeFirst();

      if (!row) return { ok: false, reason: 'unknown' } as const;
      if (row.completedAt) return { ok: false, reason: 'completed' } as const;
      if (row.claimedBy !== userId) return { ok: false, reason: 'not_holder' } as const;

      // The form is the contract. Checked here, not only in the UI: a response
      // posted straight to the API was accepted whatever it contained, and the
      // workflow downstream received an approval with no decision in it.
      if (this.validator && row.form && typeof row.form === 'object') {
        const violations = this.validator.check(
          { name: row.refName, outputSchema: row.form as never },
          'output',
          output
        );
        if (violations.length > 0) return { ok: false, reason: 'invalid', violations } as const;
      }

      const finished = await tx
        .updateTable('HumanTasks')
        .set({ completedBy: userId, completedAt: sql<Date>`now()` })
        .where('id', '=', id)
        .where('completedAt', 'is', null)
        .returning('id')
        .executeTakeFirst();

      if (!finished) return { ok: false, reason: 'completed' } as const;

      // The workflow may have been terminated, or the task may have timed out,
      // while the form was open. Saying so beats accepting an answer that goes
      // nowhere.
      const waiting = await tx
        .selectFrom('TaskExecutions')
        .select('id')
        .where('workflowId', '=', row.workflowId)
        .where('id', '=', row.taskId)
        .where('status', 'in', [TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS])
        .executeTakeFirst();

      if (!waiting) return { ok: false, reason: 'not_waiting' } as const;

      await this.workflows.completeTask(
        row.workflowId,
        row.taskId,
        TaskStatus.COMPLETED,
        // Who did it is part of the answer, and an approval without it is not
        // worth much when someone asks later.
        { ...output, completedBy: userId },
        undefined,
        undefined,
        tx
      );

      await this.decideQueue.enqueue(namespaceId, row.workflowId, 'human task completed', tx);
      await this.fire(tx, namespaceId, { ...row, completedBy: userId }, 'COMPLETED', { output });

      return { ok: true, workflowId: row.workflowId, refName: row.refName } as const;
    });
  }

  /**
   * Moves unclaimed tasks whose claim window ran out to the next assignee.
   *
   * Claimed tasks never move: someone is working on it. At the end of a chain
   * `LEAVE_OPEN` keeps the last assignee indefinitely, and `TERMINATE` times
   * the task out so the workflow's own timeout handling decides what happens.
   * Rows are locked with SKIP LOCKED, so every replica can run this safely.
   */
  async escalate(limit = 100): Promise<number> {
    return this.db.transaction().execute(async (tx) => {
      const due = await tx
        .selectFrom('HumanTasks')
        .select(COLUMNS)
        .select('namespaceId')
        .where('completedAt', 'is', null)
        // An auto-claim is not someone picking the work up: it was claimed in the
        // same transaction that assigned it (so at the same now()), and until the
        // person touches it the window still runs. Released and re-claimed by
        // hand, the timestamps differ and the task stays put.
        .where((eb) =>
          eb.or([eb('claimedBy', 'is', null), eb.and([eb('autoClaim', '=', true), eb('claimedAt', '=', eb.ref('assignedAt'))])])
        )
        .where('assignments', 'is not', null)
        .where(
          sql<boolean>`COALESCE(("assignments" -> "assignmentIndex" ->> 'slaMinutes')::int, 0) > 0
            AND "assignedAt" + make_interval(mins => ("assignments" -> "assignmentIndex" ->> 'slaMinutes')::int) <= now()`
        )
        .orderBy('assignedAt')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .execute();

      for (const task of due) {
        const chain = (task.assignments ?? []) as ResolvedAssignment[];
        const nextIndex = task.assignmentIndex + 1;
        const next = chain[nextIndex];

        if (next) {
          const moved = await tx
            .updateTable('HumanTasks')
            .set({
              assignmentIndex: nextIndex,
              assignedAt: sql<Date>`now()`,
              assigneeId: next.kind === 'user' ? next.id : null,
              assigneeGroupId: next.kind === 'group' ? next.id : null,
              ...(task.autoClaim && next.kind === 'user'
                ? { claimedBy: next.id, claimedAt: sql<Date>`now()` }
                : { claimedBy: null, claimedAt: null }),
            })
            .where('id', '=', task.id)
            .returning(COLUMNS)
            .executeTakeFirstOrThrow();
          await this.fireAssigned(tx, task.namespaceId, moved as HumanTaskView);
          continue;
        }

        if (task.completionStrategy === 'TERMINATE') {
          await this.fire(tx, task.namespaceId, task as HumanTaskView, 'TIMED_OUT');
          await this.workflows.completeTask(
            task.workflowId,
            task.taskId,
            TaskStatus.TIMED_OUT,
            undefined,
            `nobody claimed "${task.title}" before the last assignment's window closed`,
            undefined,
            tx
          );
          await tx.deleteFrom('HumanTasks').where('id', '=', task.id).execute();
          await this.decideQueue.enqueue(task.namespaceId, task.workflowId, 'human task timed out', tx);
          continue;
        }

        // LEAVE_OPEN: step past the end, which the sweep ignores from now on.
        await tx.updateTable('HumanTasks').set({ assignmentIndex: nextIndex }).where('id', '=', task.id).execute();
      }

      return due.length;
    });
  }

  /**
   * Replaces who a task is assigned to — an operator stepping in.
   *
   * Releases any claim: reassigning work someone is holding without telling
   * them is how two people end up doing it.
   */
  async reassign(namespaceId: string, id: string, assignments: ResolvedAssignment[]): Promise<HumanTaskView | undefined> {
    const first = assignments[0];
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('HumanTasks')
        .set({
          assignments: json(assignments),
          assignmentIndex: 0,
          assignedAt: sql<Date>`now()`,
          assigneeId: first?.kind === 'user' ? first.id : null,
          assigneeGroupId: first?.kind === 'group' ? first.id : null,
          // Auto-claim follows the task to its new person; otherwise any claim
          // is released.
          claimedBy: sql<string | null>`CASE WHEN "autoClaim" THEN ${first?.kind === 'user' ? first.id : null}::uuid END`,
          claimedAt: sql<Date | null>`CASE WHEN "autoClaim" AND ${first?.kind === 'user'} THEN now() END`,
        })
        .where('namespaceId', '=', namespaceId)
        .where('id', '=', id)
        .where('completedAt', 'is', null)
        .returning(COLUMNS)
        .executeTakeFirst();
      if (row) await this.fireAssigned(tx, namespaceId, row as HumanTaskView);
      return row as HumanTaskView | undefined;
    });
  }

  /**
   * Skips a task nobody should do: the workflow continues as if it completed,
   * with the reason in its output.
   */
  async skip(namespaceId: string, id: string, by: string, reason: string): Promise<CompleteResult> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('HumanTasks')
        .set({ completedAt: sql<Date>`now()`, completedBy: by, skippedReason: reason })
        .where('namespaceId', '=', namespaceId)
        .where('id', '=', id)
        .where('completedAt', 'is', null)
        .returning(COLUMNS)
        .executeTakeFirst();
      if (!row) return { ok: false, reason: 'completed' } as const;

      const completed = await this.workflows.completeTask(
        row.workflowId,
        row.taskId,
        TaskStatus.SKIPPED,
        { skipped: true, reason, skippedBy: by },
        reason,
        undefined,
        tx
      );
      if (!completed) return { ok: false, reason: 'not_waiting' } as const;

      await this.decideQueue.enqueue(namespaceId, row.workflowId, 'human task skipped', tx);
      await this.fire(tx, namespaceId, row as HumanTaskView, 'SKIPPED', { reason });
      return { ok: true, workflowId: row.workflowId, refName: row.refName } as const;
    });
  }

  /**
   * Closes whatever a finished execution left open.
   *
   * Without it a terminated workflow leaves its approvals sitting in somebody's
   * inbox forever, and the person who eventually opens one gets an error for
   * doing exactly what they were asked.
   */
  async closeForWorkflow(workflowId: string, tx?: Queryable): Promise<number> {
    const rows = await (tx ?? this.db)
      .deleteFrom('HumanTasks')
      .where('workflowId', '=', workflowId)
      .where('completedAt', 'is', null)
      .returning('id')
      .execute();

    return rows.length;
  }
}

/**
 * Resolves an assignment chain as written in a definition or an API call —
 * `[{ "user": "ada@example.com", "slaMinutes": 30 }, { "group": "payments" }]`
 * — into ids, or a violation naming the first link that does not resolve.
 *
 * Emails and group names, because that is what a person writing a definition
 * knows; resolved when the task opens, because an escalation to a team that
 * does not exist would otherwise be discovered only when the first window
 * closed, with nobody watching.
 */
export async function resolveAssignments(
  executor: Queryable,
  namespaceId: string,
  chain: unknown
): Promise<{ assignments: ResolvedAssignment[] | undefined } | { violation: string }> {
  if (chain === undefined || chain === null) return { assignments: undefined };
  if (!Array.isArray(chain) || chain.length === 0) {
    return { violation: '"assignments" must be a non-empty list of { user | group, slaMinutes }' };
  }

  const assignments: ResolvedAssignment[] = [];
  for (const [index, link] of chain.entries()) {
    const entry = (typeof link === 'object' && link !== null ? link : {}) as Record<string, unknown>;
    const sla = entry['slaMinutes'] === undefined ? 0 : Number(entry['slaMinutes']);
    if (!Number.isInteger(sla) || sla < 0) {
      return { violation: `assignments[${index}].slaMinutes must be a whole number of minutes` };
    }
    if (typeof entry['user'] === 'string') {
      const user = await executor
        .selectFrom('Users')
        .select(['id', 'email'])
        .where('namespaceId', '=', namespaceId)
        .where('email', '=', entry['user'].trim().toLowerCase())
        .executeTakeFirst();
      if (!user) return { violation: `assignments[${index}]: no user "${entry['user']}" in this namespace` };
      assignments.push({ kind: 'user', id: user.id, label: user.email, slaMinutes: sla });
    } else if (typeof entry['group'] === 'string') {
      const group = await executor
        .selectFrom('Groups')
        .select(['id', 'name'])
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', entry['group'])
        .executeTakeFirst();
      if (!group) return { violation: `assignments[${index}]: no group "${entry['group']}" in this namespace` };
      assignments.push({ kind: 'group', id: group.id, label: group.name, slaMinutes: sla });
    } else {
      return { violation: `assignments[${index}] must name a "user" (email) or a "group"` };
    }
  }
  return { assignments };
}

/**
 * Reads `triggers` as written in a HUMAN task's input —
 * `[{ "on": "COMPLETED", "workflow": "notify_requester", "version": 2 }]` —
 * or a violation naming the first entry that is wrong. The workflows named are
 * checked to exist, for the same reason assignments are resolved up front: a
 * trigger that cannot start would otherwise fail silently in the outbox, long
 * after anyone was looking.
 */
export async function resolveTriggers(
  executor: Queryable,
  namespaceId: string,
  value: unknown
): Promise<{ triggers: HumanTaskTrigger[] | undefined } | { violation: string }> {
  if (value === undefined || value === null) return { triggers: undefined };
  if (!Array.isArray(value)) return { violation: '"triggers" must be a list of { on, workflow, version? }' };

  const triggers: HumanTaskTrigger[] = [];
  for (const [index, entry] of value.entries()) {
    const trigger = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (!HUMAN_TASK_EVENTS.includes(trigger['on'] as HumanTaskEvent)) {
      return { violation: `triggers[${index}].on must be one of ${HUMAN_TASK_EVENTS.join(', ')}` };
    }
    if (typeof trigger['workflow'] !== 'string' || trigger['workflow'] === '') {
      return { violation: `triggers[${index}].workflow must name a workflow` };
    }
    const version = trigger['version'];
    if (version !== undefined && (!Number.isInteger(version) || (version as number) < 1)) {
      return { violation: `triggers[${index}].version must be a positive whole number` };
    }
    const exists = await executor
      .selectFrom('WorkflowDefinitions')
      .select('version')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', trigger['workflow'])
      .$if(version !== undefined, (q) => q.where('version', '=', version as number))
      .executeTakeFirst();
    if (!exists) {
      return {
        violation: `triggers[${index}]: no workflow "${trigger['workflow']}"${version !== undefined ? ` version ${version}` : ''} in this namespace`,
      };
    }
    triggers.push({ on: trigger['on'] as HumanTaskEvent, workflow: trigger['workflow'], ...(version !== undefined ? { version: version as number } : {}) });
  }
  return { triggers: triggers.length > 0 ? triggers : undefined };
}
