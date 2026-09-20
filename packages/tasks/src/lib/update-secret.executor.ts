import { TaskType, type JsonValue } from '@node-flow-dev/core';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';

/**
 * `UPDATE_SECRET` — writes a value into the secret store from a workflow.
 *
 * The use it exists for is token refresh: call an identity provider, get a
 * short-lived credential back, store it so later executions can use it through
 * `${secrets.NAME}` without calling the provider again.
 *
 * ## What this does not do, stated plainly
 *
 * It does **not** retroactively protect the value. Anything reaching this task
 * arrived through the workflow — almost always as `${refresh.output.token}` —
 * and that producing task's output was persisted, in clear, when it completed.
 * Writing it to the secret store makes *future* reads protected; it does not
 * remove the copy already in the execution history.
 *
 * Saying so matters because the opposite is the natural assumption, and acting
 * on it would leave a credential in a task output that nobody is watching.
 * Closing that gap properly needs output redaction declared on the task
 * definition, which is tracked separately.
 *
 * What this task *can* do is avoid making it worse: the value never appears in
 * its own output, and the name is all that is reported.
 */

/** The seam to the secret store, which lives in a package `tasks` cannot import. */
export interface SecretWriter {
  put(input: { namespaceId: string; name: string; value: string; by?: string }): Promise<unknown>;
}

export class UpdateSecretTaskExecutor implements TaskExecutor {
  readonly type = TaskType.UPDATE_SECRET;

  constructor(private readonly secrets?: SecretWriter) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    if (!this.secrets) {
      return {
        status: 'FAILED',
        reason: 'this install stores no secrets: set NODE_FLOW_SECRET_KEYS to enable them',
        terminal: true,
      };
    }

    const name = context.input['name'] ?? context.input['key'];
    if (typeof name !== 'string' || name === '') {
      return { status: 'FAILED', reason: 'UPDATE_SECRET requires a "name"', terminal: true };
    }

    const value = context.input['value'];
    if (typeof value !== 'string' || value === '') {
      // Deliberately does not say what was received. A wrong-typed value here
      // is usually a mis-resolved expression carrying something sensitive, and
      // echoing it into a failure reason would persist it a second time.
      return {
        status: 'FAILED',
        reason: `UPDATE_SECRET "${name}" requires a non-empty string "value"`,
        terminal: true,
      };
    }

    try {
      await this.secrets.put({
        namespaceId: context.namespaceId,
        name,
        value,
        by: `workflow:${context.workflowId}`,
      });
    } catch (error) {
      return {
        status: 'FAILED',
        reason: `could not store secret "${name}": ${(error as Error).message}`,
        // A rejected name will be rejected again; a database blip will not.
        terminal: /not a usable secret name/.test((error as Error).message),
      };
    }

    // The name and nothing else. Returning the value would write it into this
    // task's output as well, which is the one copy this task is responsible for.
    return { status: 'COMPLETED', output: { name, stored: true } as Record<string, JsonValue> };
  }
}
