import { ErrorCode, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { MetadataRepository } from './metadata.repository.js';
import type {
  OutboxHandler,
  SubWorkflowStartPayload,
  WorkflowStartPayload,
} from './outbox-relay.js';
import type { OutboxEvent } from './outbox.repository.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * The handlers that actually start workflows the engine asked for.
 *
 * `SUB_WORKFLOW` and `START_WORKFLOW` do not start anything directly — starting
 * a child inline would leak a side effect a rollback could not undo — so they
 * publish to the outbox and the relay starts the child after commit.
 *
 * These are the other half of that, and **they were missing**. The topics were
 * published, the payload types were exported, and nothing in the server ever
 * registered a handler for either one. Every `store` test that exercised
 * sub-workflows registered its own handler inline, so the gap was invisible
 * there: in a real deployment the events backed off, dead-lettered, and the
 * parent waited forever for a child that was never created — precisely the
 * failure the relay's own documentation warns about.
 *
 * The lesson is the same one the webhook repository and the human-task inbox
 * both taught: **the wiring is the part that breaks, and it can only be tested
 * against the container that does the wiring.**
 */

/** Starts a child whose parent is waiting on it. */
export function subWorkflowStartHandler(
  workflows: WorkflowRepository,
  metadata: MetadataRepository,
  decideQueue: DecideQueueRepository
): OutboxHandler {
  return async (event: OutboxEvent) => {
    const payload = event.payload as unknown as SubWorkflowStartPayload;

    const version = await resolveVersion(metadata, event.namespaceId, payload.defName, payload.defVersion);

    // The parent task is identified by ref, but the child row needs the task's
    // id — that is what the completion path reads to find who to wake.
    const parentTask = await workflows.findTaskByRef(
      payload.parentWorkflowId,
      payload.parentTaskRefName
    );

    if (!parentTask) {
      // Throwing earns a retry and eventually the dead letter, which is right:
      // the parent task should exist, so its absence is a bug worth keeping
      // evidence of rather than a condition to swallow.
      throw new NodeFlowError(
        ErrorCode.NOT_FOUND,
        `sub-workflow parent task ${payload.parentWorkflowId}/${payload.parentTaskRefName} not found`
      );
    }

    const child = await workflows.start({
      namespaceId: event.namespaceId,
      defName: payload.defName,
      defVersion: version,
      input: payload.input,
      parentWorkflowId: payload.parentWorkflowId,
      parentTaskId: parentTask.id,
      taskToDomain: payload.taskToDomain ?? undefined,
      // Relay delivery is at-least-once, so without this a redelivery starts a
      // second child and the parent is joined to whichever finishes first.
      //
      // The attempt is part of the key because a *retry* is a genuinely new
      // child of the same parent task. Keyed on the ref alone, the retry was
      // absorbed as a duplicate of the previous attempt's child — which had
      // already failed — so nothing ever completed the retried task and the
      // parent hung in RUNNING for good.
      idempotencyKey: `sub:${payload.parentWorkflowId}:${payload.parentTaskRefName}:${payload.parentTaskAttempt ?? 0}`,
    });

    await decideQueue.enqueue(event.namespaceId, child.id, 'sub-workflow started');
  };
}

/** Starts a workflow nothing is waiting on — the `START_WORKFLOW` operator. */
export function workflowStartHandler(
  workflows: WorkflowRepository,
  metadata: MetadataRepository,
  decideQueue: DecideQueueRepository
): OutboxHandler {
  return async (event: OutboxEvent) => {
    const payload = event.payload as unknown as WorkflowStartPayload;

    const version = await resolveVersion(metadata, event.namespaceId, payload.defName, payload.defVersion);

    const started = await workflows.start({
      namespaceId: event.namespaceId,
      defName: payload.defName,
      defVersion: version,
      input: payload.input,
      // Carried from the command, which derives it from the task identity, so a
      // redelivery deduplicates instead of starting a second workflow.
      idempotencyKey: payload.idempotencyKey ?? undefined,
      // Dropped until a failure workflow needed it: START_WORKFLOW's own
      // correlationId never reached the run it started.
      correlationId: payload.correlationId ?? undefined,
    });

    await decideQueue.enqueue(event.namespaceId, started.id, 'workflow started');
  };
}

/**
 * Pins the version at start.
 *
 * A definition with no version named resolves to the latest *now*, once, rather
 * than being re-resolved later — a running execution must not change shape
 * because someone registered a new version while it was in flight.
 */
async function resolveVersion(
  metadata: MetadataRepository,
  namespaceId: string,
  defName: string,
  declared: number | null
): Promise<number> {
  if (declared !== null) return declared;

  const latest = await metadata.latestVersion(namespaceId, defName);
  if (latest === undefined) {
    throw new NodeFlowError(ErrorCode.NOT_FOUND, `no workflow definition "${defName}"`);
  }

  return latest;
}

/** Registers both, for any relay that should start workflows. */
export function registerWorkflowStartHandlers(
  relay: { on(topic: string, handler: OutboxHandler): unknown },
  workflows: WorkflowRepository,
  metadata: MetadataRepository,
  decideQueue: DecideQueueRepository
): void {
  relay.on('subworkflow.start', subWorkflowStartHandler(workflows, metadata, decideQueue));
  relay.on('workflow.start', workflowStartHandler(workflows, metadata, decideQueue));
}

export type { JsonValue };
