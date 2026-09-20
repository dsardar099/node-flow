import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import type { TaskContext } from './executor.js';
import { UpdateSecretTaskExecutor, type SecretWriter } from './update-secret.executor.js';

/**
 * `UPDATE_SECRET`.
 *
 * The behaviour worth pinning is what it *does not* do: the value must not
 * appear in its own output or in a failure reason, because those are persisted
 * and this task is the one place that can avoid adding a second copy.
 */

const context = (input: Record<string, JsonValue>): TaskContext => ({
  taskId: 't-1',
  workflowId: 'w-1',
  namespaceId: 'ns-1',
  input,
  state: {},
  signal: new AbortController().signal,
  heartbeat: async () => undefined,
});

function recorder() {
  const writes: { namespaceId: string; name: string; value: string; by?: string }[] = [];
  const writer: SecretWriter = {
    put: async (input) => {
      writes.push(input);
      return undefined;
    },
  };
  return { writer, writes };
}

describe('storing', () => {
  it('has the declared type', () => {
    expect(new UpdateSecretTaskExecutor().type).toBe(TaskType.UPDATE_SECRET);
  });

  it('writes the value into the namespace it ran in', async () => {
    const { writer, writes } = recorder();

    const outcome = await new UpdateSecretTaskExecutor(writer).execute(
      context({ name: 'ACCESS_TOKEN', value: 'tok-123' })
    );

    expect(outcome.status).toBe('COMPLETED');
    expect(writes).toEqual([
      { namespaceId: 'ns-1', name: 'ACCESS_TOKEN', value: 'tok-123', by: 'workflow:w-1' },
    ]);
  });

  // This task's output is persisted like any other. Returning the value would
  // create exactly the second copy it is meant to avoid.
  it('never returns the value it stored', async () => {
    const { writer } = recorder();

    const outcome = await new UpdateSecretTaskExecutor(writer).execute(
      context({ name: 'ACCESS_TOKEN', value: 'tok-should-not-appear' })
    );

    expect(JSON.stringify(outcome)).not.toContain('tok-should-not-appear');
    expect(outcome.output).toEqual({ name: 'ACCESS_TOKEN', stored: true });
  });

  it('records which workflow wrote it', async () => {
    const { writer, writes } = recorder();
    await new UpdateSecretTaskExecutor(writer).execute(context({ name: 'A', value: 'x' }));

    expect(writes[0].by).toBe('workflow:w-1');
  });
});

describe('refusing', () => {
  // Failing loudly beats appearing to store something.
  it('fails when the install stores no secrets', async () => {
    const outcome = await new UpdateSecretTaskExecutor().execute(
      context({ name: 'A', value: 'x' })
    );

    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    if (outcome.status === 'FAILED') expect(outcome.reason).toContain('NODE_FLOW_SECRET_KEYS');
  });

  it('requires a name and a value', async () => {
    const { writer, writes } = recorder();
    const executor = new UpdateSecretTaskExecutor(writer);

    expect(await executor.execute(context({ value: 'x' }))).toMatchObject({
      status: 'FAILED',
      terminal: true,
    });
    expect(await executor.execute(context({ name: 'A' }))).toMatchObject({
      status: 'FAILED',
      terminal: true,
    });
    expect(writes).toEqual([]);
  });

  /**
   * A wrong-typed value is usually a mis-resolved expression carrying something
   * sensitive, so the reason says what was expected and never what arrived.
   */
  it('does not echo a rejected value into the failure reason', async () => {
    const { writer } = recorder();

    const outcome = await new UpdateSecretTaskExecutor(writer).execute(
      context({ name: 'A', value: { nested: 'leaked-token-value' } as unknown as JsonValue })
    );

    expect(outcome.status).toBe('FAILED');
    if (outcome.status === 'FAILED') expect(outcome.reason).not.toContain('leaked-token-value');
  });

  it('treats an unusable name as permanent and a blip as retryable', async () => {
    const rejecting: SecretWriter = {
      put: async () => {
        throw new Error('"bad name" is not a usable secret name: start with a letter');
      },
    };
    const flaky: SecretWriter = {
      put: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    };

    expect(
      await new UpdateSecretTaskExecutor(rejecting).execute(context({ name: 'x', value: 'v' }))
    ).toMatchObject({ terminal: true });
    expect(
      await new UpdateSecretTaskExecutor(flaky).execute(context({ name: 'x', value: 'v' }))
    ).toMatchObject({ terminal: false });
  });
});
