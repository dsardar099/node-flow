import type { JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, Queryable } from './database.js';
import { json } from './schema.js';

/**
 * Append-only execution history.
 *
 * Two jobs, and the second is why it is worth the write cost:
 *
 *  1. **Audit.** What happened, in order, and why — the question asked after
 *     every incident. Task rows show the final state; they do not show that a
 *     switch took the refund branch at 03:12 because a gateway returned 502.
 *  2. **Replay.** The decider is a pure function, so a recorded event stream is
 *     enough to reconstruct any evaluation exactly as it ran. That is what makes
 *     deterministic replay and time-travel debugging possible later, and it is
 *     only possible if the events are captured now.
 *
 * Written inside the evaluation transaction, so history can never disagree with
 * the state it describes.
 */

export const WorkflowEventType = {
  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_COMPLETED: 'workflow.completed',
  WORKFLOW_FAILED: 'workflow.failed',
  TASK_SCHEDULED: 'task.scheduled',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_RETRIED: 'task.retried',
  TASK_SKIPPED: 'task.skipped',
  /** An operator stopped a running task; distinct from a failure, which the workflow handles. */
  TASK_CANCELED: 'task.canceled',
  TASK_TIMED_OUT: 'task.timedOut',
  VARIABLES_SET: 'variables.set',
  EVENT_PUBLISHED: 'event.published',

  // Operator actions. Recorded because "who terminated this, and when" is a
  // question asked after every incident, and task rows cannot answer it.
  WORKFLOW_PAUSED: 'workflow.paused',
  WORKFLOW_RESUMED: 'workflow.resumed',
  WORKFLOW_TERMINATED: 'workflow.terminated',
  WORKFLOW_RETRIED: 'workflow.retried',
  WORKFLOW_RERUN: 'workflow.rerun',
} as const;

export type WorkflowEventType = (typeof WorkflowEventType)[keyof typeof WorkflowEventType];

export interface WorkflowEventRecord {
  seq: number;
  type: string;
  payload: Record<string, JsonValue>;
  at: Date;
}

export interface NewWorkflowEvent {
  type: WorkflowEventType;
  payload: Record<string, JsonValue>;
}

export class WorkflowEventsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Appends events with a gap-free sequence per workflow.
   *
   * `seq` comes from the table rather than a clock: two events written in the
   * same transaction can share a timestamp to microsecond precision, and a
   * history whose order depends on tie-breaking is not a history. The whole
   * batch is one statement so the numbering cannot interleave with a concurrent
   * append — though per-workflow serialisation already prevents that, this
   * keeps the guarantee local rather than borrowed.
   */
  async append(
    workflowId: string,
    events: NewWorkflowEvent[],
    tx: Queryable
  ): Promise<void> {
    if (events.length === 0) return;

    const next = await tx
      .selectFrom('WorkflowEvents')
      .select((eb) => eb.fn.coalesce(eb.fn.max('seq'), sql<number>`0`).as('maxSeq'))
      .where('workflowId', '=', workflowId)
      .executeTakeFirst();

    let seq = Number(next?.maxSeq ?? 0);

    await tx
      .insertInto('WorkflowEvents')
      .values(
        events.map((event) => ({
          workflowId,
          seq: ++seq,
          type: event.type,
          payload: json(event.payload),
        }))
      )
      .execute();
  }

  /**
   * Everything appended after a sequence number.
   *
   * The read behind a live stream, and the reason a dropped notification is
   * survivable: a subscriber asks from its own cursor, so whatever it missed
   * comes back alongside whatever is new. Bounded, because a viewer that
   * reconnects to a workflow which ran ten thousand tasks while it was away
   * must not be handed all of them in one frame.
   */
  async since(workflowId: string, afterSeq: number, limit = 200): Promise<WorkflowEventRecord[]> {
    const rows = await this.db
      .selectFrom('WorkflowEvents')
      .select(['seq', 'type', 'payload', 'at'])
      .where('workflowId', '=', workflowId)
      .where('seq', '>', afterSeq)
      .orderBy('seq')
      .limit(limit)
      .execute();

    return rows as unknown as WorkflowEventRecord[];
  }

  /** The full history of one workflow, in order. */
  async history(workflowId: string, limit = 1000): Promise<WorkflowEventRecord[]> {
    const rows = await this.db
      .selectFrom('WorkflowEvents')
      .select(['seq', 'type', 'payload', 'at'])
      .where('workflowId', '=', workflowId)
      .orderBy('seq')
      .limit(limit)
      .execute();

    return rows as unknown as WorkflowEventRecord[];
  }

  async count(workflowId: string): Promise<number> {
    const row = await this.db
      .selectFrom('WorkflowEvents')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('workflowId', '=', workflowId)
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }
}
