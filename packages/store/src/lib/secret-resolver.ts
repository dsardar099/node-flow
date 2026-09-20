import { ErrorCode, NodeFlowError, isSealedValue, type JsonValue } from '@node-flow-dev/core';
import { extractReferences, extractSecretNames, resolveValue } from '@node-flow-dev/engine';
import type { OutputSealer } from './output-sealer.js';
import type { SecretRepository } from './secret.repository.js';
import type { WorkflowRepository } from './workflow.repository.js';

/**
 * Resolves `${secrets.NAME}` into a task's input, at dispatch.
 *
 * **This is the only place a secret is ever resolved**, and the whole design of
 * secret handling rests on that being true.
 *
 * The decider resolves a task's input and the applier persists it, so a secret
 * resolved there would be written to `TaskExecutions` in clear, returned by the
 * execution API, rendered in the UI and kept for the retention period — a
 * credential leak with a long half-life and no audit trail. So `${secrets.x}`
 * survives evaluation untouched and is substituted here, into the copy handed
 * to an executor or a worker and into nothing that is stored.
 *
 * The corollary is worth stating because it constrains future work: anything
 * that persists a task's *resolved* input — a debugging aid, a replay feature,
 * a richer audit log — has to resolve secrets after it takes its copy, not
 * before.
 */
export class SecretResolver {
  constructor(
    private readonly secrets: SecretRepository,
    /** Opens sealed task-output fields, when the install seals any. */
    private readonly sealer?: OutputSealer,
    private readonly workflows?: WorkflowRepository
  ) {}

  /**
   * Substitutes the secrets a value references.
   *
   * Returns the input untouched when it references none, which is almost every
   * task — so the common path costs one synchronous scan and no query.
   */
  async resolve(
    namespaceId: string,
    input: Record<string, JsonValue>,
    /** Present for a task; absent when resolving something not tied to one. */
    workflowId?: string
  ): Promise<Record<string, JsonValue>> {
    const withOutputs = await this.openSealedOutputs(namespaceId, input, workflowId);

    const names = extractSecretNames(withOutputs as JsonValue);
    if (names.size === 0) return withOutputs;

    input = withOutputs;

    const values = await this.secrets.resolve(namespaceId, [...names]);

    const missing = [...names].filter((name) => !(name in values));
    if (missing.length > 0) {
      // Failing loudly beats substituting an empty string: a task that silently
      // authenticates with "" produces a 401 from somewhere far away, and the
      // reason is nowhere near it.
      throw new NodeFlowError(
        ErrorCode.NOT_FOUND,
        `no secret named ${missing.map((name) => `"${name}"`).join(', ')}`
      );
    }

    return resolveValue(input as JsonValue, {
      tasks: new Map(),
      workflow: {},
      variables: {},
      secrets: values,
    }) as Record<string, JsonValue>;
  }

  /**
   * Resolves `${task.output.field}` references the decider deliberately left
   * alone because the value was sealed.
   *
   * The engine defers those rather than resolving them, since it holds no key
   * and resolving would persist an envelope where a plaintext value belongs.
   * This is the other end of that: the referenced task's output is loaded, the
   * sealed field opened, and the value substituted into the copy handed to an
   * executor.
   *
   * Nothing happens for the overwhelming majority of tasks, which reference no
   * task output that is sealed — the scan is synchronous and the query only
   * runs when a reference survived evaluation.
   */
  private async openSealedOutputs(
    namespaceId: string,
    input: Record<string, JsonValue>,
    workflowId?: string
  ): Promise<Record<string, JsonValue>> {
    if (!this.sealer?.enabled || !this.workflows || !workflowId) return input;

    // A reference that survived the decider is either a sealed field or a
    // genuine dangling reference; either way there are none in most inputs.
    const refs = extractReferences(input as JsonValue);
    if (refs.size === 0) return input;

    const tasks = new Map<string, { output?: Record<string, JsonValue> }>();

    for (const ref of refs) {
      const task = await this.workflows.findTaskByRef(workflowId, ref);
      if (!task || task.output?.kind !== 'inline') continue;

      const output = task.output.value;
      const opened: Record<string, JsonValue> = {};

      for (const [key, value] of Object.entries(output)) {
        opened[key] = isSealedValue(value)
          ? this.sealer.open(value, {
              namespaceId,
              taskDefName: task.taskDefName,
              field: key,
            })
          : value;
      }

      tasks.set(ref, { output: opened });
    }

    if (tasks.size === 0) return input;

    return resolveValue(input as JsonValue, {
      tasks,
      workflow: {},
      variables: {},
      // Left undefined so `${secrets.x}` stays deferred through this pass and
      // is resolved by the step above, which is the only one that should.
    }) as Record<string, JsonValue>;
  }
}
