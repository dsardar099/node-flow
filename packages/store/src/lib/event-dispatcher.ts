import { TaskStatus, type JsonValue } from '@node-flow-dev/core';
import { resolveString, resolveValue, type ResolutionScope } from '@node-flow-dev/engine';
import { JsSandbox } from '@node-flow-dev/tasks';
import { createHash } from 'node:crypto';
import type { Db } from './database.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { EventHandlerRepository, type EventHandler } from './event-handler.repository.js';
import type { EventExecutionRepository } from './event-execution.repository.js';
import { MetadataRepository } from './metadata.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Turns an inbound message into workflow action.
 *
 * Separated from the transport on purpose. Everything interesting — matching,
 * filtering, expression resolution, idempotency — is decided here and is
 * testable without a broker; the sources below it only have to deliver bytes.
 */

export interface InboundMessage {
  /** The configured source, e.g. `kafka:default`. */
  source: string;
  topic: string;
  /** Parsed body. Non-JSON payloads arrive under `body` as a string. */
  payload: Record<string, JsonValue>;
  headers?: Record<string, string>;
  key?: string | null;
  /**
   * Stable identity for this delivery, from the transport — for Kafka the
   * partition and offset.
   *
   * Consumers are at-least-once: a crash between acting and committing an
   * offset redelivers the message. Without an identity that survives that, a
   * redelivered payment notification starts a second workflow.
   */
  deliveryId: string;
}

export interface DispatchResult {
  matched: number;
  acted: number;
  skipped: number;
  failed: number;
}

export class EventDispatcher {
  private readonly sandbox: JsSandbox;

  constructor(
    private readonly db: Db,
    private readonly handlers: EventHandlerRepository,
    private readonly workflows: WorkflowRepository,
    private readonly metadata: MetadataRepository,
    private readonly decideQueue: DecideQueueRepository,
    private readonly options: {
      onError?: (error: unknown, context: { handler?: string }) => void;
      sandbox?: ConstructorParameters<typeof JsSandbox>[0];
      /** Where the event monitor records each handler's outcome. */
      monitor?: EventExecutionRepository;
    } = {}
  ) {
    this.sandbox = new JsSandbox(options.sandbox);
  }

  async dispatch(message: InboundMessage, scope: { namespaceId?: string } = {}): Promise<DispatchResult> {
    const matching = await this.handlers.forTopic(message.source, message.topic, scope.namespaceId);
    const result: DispatchResult = { matched: matching.length, acted: 0, skipped: 0, failed: 0 };

    // Each handler independently: one that throws must not stop the others,
    // because a single broken handler on a busy topic would otherwise silence
    // every other subscriber to it.
    for (const handler of matching) {
      const delivered = await this.dispatchTo(handler, message);
      if (delivered.outcome === 'ACTED') result.acted += 1;
      else if (delivered.outcome === 'SKIPPED') result.skipped += 1;
      else result.failed += 1;
    }

    return result;
  }

  /**
   * Delivers a message to one handler, recording the outcome.
   *
   * Public so an operator can send a test message to a single handler: it goes
   * through exactly the path a real delivery does — condition, templates,
   * idempotency, bookkeeping — which is the only kind of test worth trusting.
   */
  async dispatchTo(
    handler: EventHandler,
    message: InboundMessage
  ): Promise<{ outcome: 'ACTED' | 'SKIPPED' | 'FAILED'; workflowId?: string; detail?: string }> {
    try {
      const applied = await this.apply(handler, message);
      const outcome = applied.acted ? 'ACTED' : 'SKIPPED';
      await this.handlers.recordDelivery(handler.id, undefined);
      await this.monitor(handler, message, outcome, applied.workflowId, applied.detail);
      return { outcome, workflowId: applied.workflowId, detail: applied.detail };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.options.onError?.(error, { handler: handler.name });
      await this.handlers.recordDelivery(handler.id, reason);
      await this.monitor(handler, message, 'FAILED', undefined, reason);
      return { outcome: 'FAILED', detail: reason };
    }
  }

  /** Best-effort: a monitor row that cannot be written must not fail a delivered message. */
  private async monitor(
    handler: EventHandler,
    message: InboundMessage,
    outcome: 'ACTED' | 'SKIPPED' | 'FAILED',
    workflowId: string | undefined,
    detail: string | undefined
  ): Promise<void> {
    if (!this.options.monitor) return;
    try {
      await this.options.monitor.record({
        namespaceId: handler.namespaceId,
        handlerName: handler.name,
        action: handler.action,
        source: message.source,
        topic: message.topic,
        messageKey: message.key,
        deliveryId: message.deliveryId,
        payload: message.payload,
        outcome,
        workflowId,
        detail,
      });
    } catch (error) {
      this.options.onError?.(error, { handler: handler.name });
    }
  }

  private async apply(
    handler: EventHandler,
    message: InboundMessage
  ): Promise<{ acted: boolean; workflowId?: string; detail?: string }> {
    if (!(await this.matches(handler, message))) {
      return { acted: false, detail: 'condition did not match' };
    }

    const scope = scopeFor(message);

    return handler.action === 'START_WORKFLOW'
      ? this.startWorkflow(handler, message, scope)
      : this.reportTask(handler, message, scope);
  }

  /**
   * Evaluates the handler's condition, if it has one.
   *
   * In the same QuickJS sandbox as `INLINE`, because it is user-supplied code
   * that arrived through an API. A condition that throws is treated as *not
   * matching* rather than as a failure: a filter that cannot decide must not
   * start a workflow, and a malformed one on a busy topic would otherwise
   * produce an error per message forever.
   */
  private async matches(handler: EventHandler, message: InboundMessage): Promise<boolean> {
    if (!handler.condition) return true;

    const decision = await this.sandbox.evaluate(handler.condition, message.payload);
    if (!decision.ok) {
      throw new Error(`condition failed to evaluate: ${decision.reason}`);
    }

    return decision.value === true;
  }

  private async startWorkflow(
    handler: EventHandler,
    message: InboundMessage,
    scope: ResolutionScope
  ): Promise<{ acted: boolean; workflowId?: string; detail?: string }> {
    const version = await this.resolveVersion(handler);

    const input = resolveValue(handler.inputTemplate as JsonValue, scope) as Record<
      string,
      JsonValue
    >;

    const execution = await this.workflows.start({
      namespaceId: handler.namespaceId,
      defName: handler.defName as string,
      defVersion: version,
      input: {
        ...input,
        // The raw message, always. A template that forgot a field is a common
        // mistake and an unrecoverable one if the original is discarded.
        _event: {
          source: message.source,
          topic: message.topic,
          key: message.key ?? null,
          payload: message.payload,
        } as JsonValue,
      },
      correlationId: handler.correlationId
        ? String(resolveString(handler.correlationId, scope))
        : undefined,
      // Derived from the handler and the delivery, so a redelivered message
      // resolves to the execution it already started rather than a second one.
      idempotencyKey: deliveryKey(handler.id, message.deliveryId),
    });

    await this.decideQueue.enqueue(
      handler.namespaceId,
      execution.id,
      `event ${message.source}/${message.topic}`
    );

    return { acted: true, workflowId: execution.id };
  }

  /**
   * Completes or fails a task the message is about.
   *
   * This is what makes an event-driven pause work: a workflow reaches a task
   * that waits, and a message on a topic finishes it.
   */
  private async reportTask(
    handler: EventHandler,
    message: InboundMessage,
    scope: ResolutionScope
  ): Promise<{ acted: boolean; workflowId?: string; detail?: string }> {
    const workflowId = String(resolveString(handler.workflowIdExpr as string, scope) ?? '');
    const refName = String(resolveString(handler.taskRefExpr as string, scope) ?? '');

    if (!workflowId || !refName) {
      throw new Error('could not resolve which workflow and task the message is about');
    }

    // Namespace first, before anything is read about the task. Ids are
    // unguessable, but that is not access control — and checking the task first
    // would let a handler in one namespace learn whether a task exists in
    // another by comparing which error came back.
    // A malformed id is simply not a workflow here; querying with it would
    // surface the database's own complaint about uuid syntax instead.
    const workflow = UUID.test(workflowId) ? await this.workflows.findById(workflowId) : undefined;
    if (!workflow || workflow.namespaceId !== handler.namespaceId) {
      throw new Error(`no workflow ${workflowId} in this namespace`);
    }

    const task = await this.workflows.findTaskByRef(workflowId, refName);
    if (!task) {
      throw new Error(`no task "${refName}" in workflow ${workflowId}`);
    }

    // Already finished — the common shape of a redelivery, and not an error.
    if (task.status !== TaskStatus.SCHEDULED && task.status !== TaskStatus.IN_PROGRESS) {
      return { acted: false, workflowId, detail: `task "${refName}" already ${task.status}` };
    }

    await this.db.transaction().execute(async (tx) => {
      await this.workflows.completeTask(
        workflowId,
        task.id,
        handler.action === 'FAIL_TASK' ? TaskStatus.FAILED : TaskStatus.COMPLETED,
        message.payload,
        handler.action === 'FAIL_TASK'
          ? `failed by event ${message.source}/${message.topic}`
          : undefined,
        undefined,
        tx
      );

      await this.decideQueue.enqueue(
        handler.namespaceId,
        workflowId,
        `event ${message.source}/${message.topic}`,
        tx
      );
    });

    return { acted: true, workflowId };
  }

  /**
   * The version to run, checked to exist.
   *
   * Checked even when the handler pins a version — the same correction the
   * scheduler needed. Without it, a handler naming a deleted definition starts
   * an execution that fails later for an unrelated-looking reason, while an
   * unpinned one records a clear error on its row. "Why isn't my handler
   * working?" deserves the same answer either way, and the lookup is served
   * from the blueprint cache.
   */
  private async resolveVersion(handler: EventHandler): Promise<number> {
    const name = handler.defName as string;

    if (handler.defVersion === null) {
      const latest = await this.metadata.latestVersion(handler.namespaceId, name);
      if (latest === undefined) throw new Error(`no workflow definition "${name}"`);
      return latest;
    }

    const pinned = await this.metadata.definitionExists(
      handler.namespaceId,
      name,
      handler.defVersion
    );
    if (!pinned) {
      throw new Error(`no workflow definition "${name}" version ${handler.defVersion}`);
    }

    return handler.defVersion;
  }
}

/**
 * Binds the message as `event.output`, so templates read
 * `${event.output.orderId}`.
 *
 * Deliberately the shape the DSL already uses for a task's output rather than a
 * new one: an author who can write a task input parameter can write this
 * without learning anything.
 */
function scopeFor(message: InboundMessage): ResolutionScope {
  return {
    tasks: new Map([['event', { output: message.payload }]]),
    workflow: {},
    variables: {},
  };
}

/**
 * Keeps the idempotency key inside the column's bounds.
 *
 * A Kafka delivery id is short, but a source is free to use something long —
 * a message id, a URL — and a key that overflows would fail the insert rather
 * than deduplicating it.
 */
function deliveryKey(handlerId: string, deliveryId: string): string {
  const digest = createHash('sha256').update(`${handlerId}:${deliveryId}`).digest('hex');
  return `event:${digest.slice(0, 32)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
