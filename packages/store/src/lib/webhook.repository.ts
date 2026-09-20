import { createHash, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { TaskStatus, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, DbTransaction, Queryable } from './database.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Incoming webhooks — the callback slots a `WAIT_FOR_WEBHOOK` task waits on.
 *
 * The token in the URL is the whole authorisation model, and that is
 * deliberate: a third party cannot hold an API credential for your system, so
 * the capability has to travel in the URL it was given. Everything here follows
 * from that:
 *
 *  - it is stored hashed, so a database leak does not hand over live workflows;
 *  - it completes exactly one task, so it grants nothing else;
 *  - it is single-use, because every webhook sender retries;
 *  - it expires, so an abandoned workflow leaves nothing open.
 */

const TOKEN_BYTES = 32;

export interface MintedCallback {
  /** Returned once, embedded in the URL, never stored in clear. */
  token: string;
  expiresAt?: Date;
}

export type CallbackResult =
  | { ok: true; workflowId: string; refName: string }
  | { ok: false; reason: 'unknown' | 'consumed' | 'expired' | 'bad_signature' | 'not_waiting' };

export class WebhookRepository {
  constructor(
    private readonly db: Db,
    private readonly workflows: WorkflowRepository,
    private readonly decideQueue: DecideQueueRepository
  ) {}

  /**
   * Opens a callback slot for a waiting task.
   *
   * Called by the applier as the task is scheduled, inside the same
   * transaction — so a rolled-back evaluation cannot leave a live token for a
   * task that was never created.
   */
  async mint(
    input: {
      namespaceId: string;
      workflowId: string;
      taskId: string;
      refName: string;
      expiresInSeconds?: number;
      signingKey?: string;
    },
    tx: Queryable
  ): Promise<MintedCallback> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = input.expiresInSeconds
      ? new Date(Date.now() + input.expiresInSeconds * 1000)
      : undefined;

    await tx
      .insertInto('WebhookCallbacks')
      .values({
        namespaceId: input.namespaceId,
        workflowId: input.workflowId,
        taskId: input.taskId,
        refName: input.refName,
        tokenHash: hashToken(token),
        signingKey: input.signingKey ?? null,
        expiresAt: expiresAt ?? null,
      })
      .execute();

    return { token, expiresAt };
  }

  /**
   * Delivers a callback: completes the waiting task with the payload.
   *
   * The whole thing is one transaction, and the slot is claimed with a
   * conditional update rather than a read-then-write. Two concurrent
   * deliveries of the same retried webhook would otherwise both see an
   * unconsumed row and both complete the task — which, for a payment
   * confirmation, means shipping the order twice.
   */
  async deliver(options: {
    token: string;
    payload: Record<string, JsonValue>;
    /** Raw body and signature header, when the sender signs its deliveries. */
    rawBody?: string;
    signature?: string;
  }): Promise<CallbackResult> {
    return this.db.transaction().execute(async (tx) => {
      const slot = await tx
        .selectFrom('WebhookCallbacks')
        .selectAll()
        .where('tokenHash', '=', hashToken(options.token))
        .executeTakeFirst();

      if (!slot) return { ok: false, reason: 'unknown' } as const;
      if (slot.consumedAt) return { ok: false, reason: 'consumed' } as const;
      if (slot.expiresAt && slot.expiresAt <= new Date()) {
        return { ok: false, reason: 'expired' } as const;
      }

      if (slot.signingKey) {
        if (!verifySignature(slot.signingKey, options.rawBody ?? '', options.signature)) {
          return { ok: false, reason: 'bad_signature' } as const;
        }
      }

      // Claim it. The `consumedAt IS NULL` predicate is what makes this
      // single-use under concurrency: the second delivery updates no rows.
      const claimed = await tx
        .updateTable('WebhookCallbacks')
        .set({ consumedAt: sql<Date>`now()` })
        .where('id', '=', slot.id)
        .where('consumedAt', 'is', null)
        .returning('id')
        .execute();

      if (claimed.length === 0) return { ok: false, reason: 'consumed' } as const;

      // The task may have been terminated or timed out while waiting. Treating
      // that as a delivery failure is right: the sender should be told its
      // callback went nowhere rather than getting a 200 for a no-op.
      const task = await this.findWaitingTask(slot.workflowId, slot.taskId, tx);
      if (!task) return { ok: false, reason: 'not_waiting' } as const;

      await this.workflows.completeTask(
        slot.workflowId,
        slot.taskId,
        TaskStatus.COMPLETED,
        options.payload,
        undefined,
        undefined,
        tx
      );

      await this.decideQueue.enqueue(
        slot.namespaceId,
        slot.workflowId,
        'webhook delivered',
        tx
      );

      return { ok: true, workflowId: slot.workflowId, refName: slot.refName } as const;
    });
  }

  /**
   * Closes every open slot for a workflow.
   *
   * Called when an execution ends. Leaving them open means a callback arriving
   * hours later finds a live token for a workflow that is long gone.
   */
  async closeForWorkflow(workflowId: string, tx?: Queryable): Promise<number> {
    const rows = await (tx ?? this.db)
      .deleteFrom('WebhookCallbacks')
      .where('workflowId', '=', workflowId)
      .returning('id')
      .execute();

    return rows.length;
  }

  /** Removes expired and long-consumed slots. For the poller. */
  async prune(consumedRetentionSeconds = 7 * 24 * 3600): Promise<number> {
    const rows = await this.db
      .deleteFrom('WebhookCallbacks')
      .where((eb) =>
        eb.or([
          eb('expiresAt', '<=', sql<Date>`now()`),
          eb(
            'consumedAt',
            '<',
            sql<Date>`now() - make_interval(secs => ${consumedRetentionSeconds})`
          ),
        ])
      )
      .returning('id')
      .execute();

    return rows.length;
  }

  private async findWaitingTask(workflowId: string, taskId: string, tx: DbTransaction) {
    return tx
      .selectFrom('TaskExecutions')
      .select('id')
      .where('workflowId', '=', workflowId)
      .where('id', '=', taskId)
      .where('status', 'in', [TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS])
      .executeTakeFirst();
  }
}

/**
 * Hashes a callback token for lookup.
 *
 * SHA-256, not a KDF — 256 bits of generated entropy has no dictionary to
 * search, and this runs on the request path. Same reasoning as API keys and
 * session tokens, and the opposite of passwords.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Verifies an HMAC signature over the raw body.
 *
 * Over the **raw bytes**, not the parsed object: re-serialising JSON changes
 * key order and whitespace, so a signature computed by the sender would never
 * match one computed over a round-tripped payload.
 *
 * Accepts a bare hex digest or a `sha256=` prefixed one, because the common
 * senders differ and rejecting on formatting alone is a support ticket rather
 * than a security boundary.
 */
export function verifySignature(
  key: string,
  rawBody: string,
  signature: string | undefined
): boolean {
  if (!signature) return false;

  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const expected = createHmac('sha256', key).update(rawBody).digest('hex');

  const left = Buffer.from(provided.toLowerCase());
  const right = Buffer.from(expected);

  // Length check first: `timingSafeEqual` throws on a mismatch rather than
  // returning false, which would turn a wrong-length signature into a 500.
  return left.length === right.length && timingSafeEqual(left, right);
}
