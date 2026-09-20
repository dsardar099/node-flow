import { ErrorCode, NodeFlowError, TaskStatus, TaskType, isWorkflowTerminal, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, DbTransaction } from './database.js';
import type { DecideQueueRepository } from './decide-queue.repository.js';
import { json } from './schema.js';
import type { WorkflowRepository } from './workflow.repository.js';

/**
 * A message queue per execution, and the task that reads it.
 *
 * Pushing a message and delivering it to a waiting `PULL_WORKFLOW_MESSAGES`
 * task happen under the execution's row lock — the same lock an evaluation
 * holds. Without it, a message pushed while an evaluation is scheduling the
 * pull would see no waiting task, the new task would see no message, and the
 * two would wait for each other forever.
 */

export interface WorkflowMessage {
  id: string;
  payload: Record<string, JsonValue>;
  receivedAt: Date;
  consumedByTaskId: string | null;
  consumedAt: Date | null;
}

/** Most a single pull hands over, whatever it asks for. */
export const MAX_PULL_BATCH = 100;

export class WorkflowMessageRepository {
  constructor(
    private readonly db: Db,
    private readonly workflows: Pick<WorkflowRepository, 'lockForEvaluation' | 'completeTask'>,
    private readonly decideQueue: Pick<DecideQueueRepository, 'enqueue'>
  ) {}

  /** Adds a message, and hands it straight to a pull that is already waiting. */
  async push(namespaceId: string, workflowId: string, payload: Record<string, JsonValue>): Promise<{ messageId: string; delivered: boolean }> {
    return this.db.transaction().execute(async (tx) => {
      const workflow = await this.workflows.lockForEvaluation(workflowId, tx);
      if (!workflow || workflow.namespaceId !== namespaceId) {
        throw new NodeFlowError(ErrorCode.NOT_FOUND, `no execution ${workflowId}`);
      }
      // Nothing will ever read it, and accepting it would say otherwise.
      if (isWorkflowTerminal(workflow.status)) {
        throw new NodeFlowError(ErrorCode.CONFLICT, `execution ${workflowId} is ${workflow.status} and takes no more messages`);
      }

      const row = await tx
        .insertInto('WorkflowMessages')
        .values({ namespaceId, workflowId, payload: json(payload) })
        .returning('id')
        .executeTakeFirstOrThrow();

      const delivered = await this.deliver(namespaceId, workflowId, tx);
      return { messageId: String(row.id), delivered };
    });
  }

  /**
   * Completes the waiting pull, if there is one and messages are queued.
   *
   * Called by `push`, and by the evaluator right after it schedules a pull —
   * both inside a transaction holding the execution's row lock.
   */
  async deliver(namespaceId: string, workflowId: string, tx: DbTransaction): Promise<boolean> {
    const task = await tx
      .selectFrom('TaskExecutions')
      .select(['id', 'input'])
      .where('workflowId', '=', workflowId)
      .where('taskType', '=', TaskType.PULL_WORKFLOW_MESSAGES)
      .where('status', '=', TaskStatus.IN_PROGRESS)
      .orderBy('scheduledAt')
      .limit(1)
      .executeTakeFirst();
    if (!task) return false;

    const requested = Number((task.input as Record<string, unknown> | null)?.['batchSize'] ?? 1);
    const batchSize = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PULL_BATCH) : 1;

    const taken = await sql<{ id: string; payload: Record<string, JsonValue>; receivedAt: Date }>`
      WITH next AS (
        SELECT id FROM "WorkflowMessages"
        WHERE "workflowId" = ${workflowId} AND "consumedAt" IS NULL
        ORDER BY id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "WorkflowMessages" m SET "consumedAt" = now(), "consumedByTaskId" = ${task.id}
      FROM next WHERE m.id = next.id
      RETURNING m.id, m.payload, m."receivedAt"
    `.execute(tx);
    if (taken.rows.length === 0) return false;

    const messages = [...taken.rows]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((row) => ({ id: String(row.id), payload: row.payload, receivedAt: row.receivedAt.toISOString() }));

    await this.workflows.completeTask(
      workflowId,
      task.id,
      TaskStatus.COMPLETED,
      { messages, count: messages.length } as unknown as Record<string, JsonValue>,
      undefined,
      undefined,
      tx
    );
    await this.decideQueue.enqueue(namespaceId, workflowId, 'workflow messages delivered', tx);
    return true;
  }

  /** Every message for an execution, oldest first, with who consumed it. */
  async list(workflowId: string, limit = 500): Promise<WorkflowMessage[]> {
    const rows = await this.db
      .selectFrom('WorkflowMessages')
      .select(['id', 'payload', 'receivedAt', 'consumedByTaskId', 'consumedAt'])
      .where('workflowId', '=', workflowId)
      .orderBy('id')
      .limit(Math.min(Math.max(limit, 1), 1000))
      .execute();
    return rows.map((row) => ({ ...row, id: String(row.id), payload: row.payload as Record<string, JsonValue> }));
  }
}
