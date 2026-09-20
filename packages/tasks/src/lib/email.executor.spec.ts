import type { JsonValue } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { EmailTaskExecutor, type MailTransport } from './email.executor.js';
import type { TaskContext } from './executor.js';

/**
 * The `EMAIL` task.
 *
 * The transport is stubbed — this is not a test of SMTP. What is tested is the
 * boundary a definition sees: that credentials stay in operator configuration,
 * that a permanent rejection is not retried forever, and that an install which
 * has deliberately disabled mail says so rather than silently swallowing it.
 */

function contextFor(input: Record<string, JsonValue>): TaskContext {
  return {
    taskId: 't-1',
    workflowId: 'w-1',
    namespaceId: 'ns-1',
    input,
    signal: new AbortController().signal,
    state: {},
    heartbeat: async () => undefined,
  };
}

/** A transport that records what it was asked to send. */
function stubTransport(reply: () => Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }> = async () => ({
  messageId: '<abc@example.com>',
  accepted: ['ada@example.com'],
  rejected: [],
})) {
  const sent: Record<string, unknown>[] = [];
  const transport: MailTransport = {
    sendMail: async (message) => {
      sent.push(message);
      return reply();
    },
  };
  return { sent, createTransport: async () => transport };
}

const transports = {
  default: { host: 'smtp.example.com', port: 587, user: 'mailer', pass: 'secret', from: 'ops@example.com' },
  staging: { host: 'smtp.staging', disabled: true },
};

describe('sending email', () => {
  it('sends through the configured transport, with the operator’s from address', async () => {
    const stub = stubTransport();
    const outcome = await new EmailTaskExecutor({ transports, createTransport: stub.createTransport }).execute(
      contextFor({ to: 'ada@example.com', subject: 'Your order shipped', body: 'It is on its way.' })
    );

    expect(outcome.status).toBe('COMPLETED');
    if (outcome.status === 'COMPLETED') {
      expect(outcome.output).toMatchObject({ messageId: '<abc@example.com>', transport: 'default' });
    }

    // The definition supplied none of this: the from address and the
    // credentials are the operator's, which is the whole point of the task.
    expect(stub.sent[0]).toMatchObject({
      from: 'ops@example.com',
      to: 'ada@example.com',
      subject: 'Your order shipped',
      text: 'It is on its way.',
    });
    expect(JSON.stringify(stub.sent[0])).not.toContain('secret');
  });

  it('accepts recipients as a list or a comma-separated string', async () => {
    const stub = stubTransport();
    const task = new EmailTaskExecutor({ transports, createTransport: stub.createTransport });

    await task.execute(contextFor({ to: ['ada@example.com', 'grace@example.com'], body: 'x' }));
    await task.execute(contextFor({ to: 'ada@example.com, grace@example.com', cc: 'ops@example.com', body: 'x' }));

    expect(stub.sent[0]['to']).toBe('ada@example.com, grace@example.com');
    expect(stub.sent[1]['to']).toBe('ada@example.com, grace@example.com');
    expect(stub.sent[1]['cc']).toBe('ops@example.com');
  });

  it('refuses a disabled transport rather than pretending to send', async () => {
    const stub = stubTransport();
    const outcome = await new EmailTaskExecutor({ transports, createTransport: stub.createTransport }).execute(
      contextFor({ transport: 'staging', to: 'ada@example.com', body: 'x' })
    );

    // A staging install that quietly swallows mail teaches everyone the task
    // works, and the surprise arrives in production.
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    expect(stub.sent).toHaveLength(0);
  });

  it('says what is missing rather than failing at the server', async () => {
    const stub = stubTransport();
    const task = new EmailTaskExecutor({ transports, createTransport: stub.createTransport });

    expect(await task.execute(contextFor({ subject: 'x', body: 'y' }))).toMatchObject({
      status: 'FAILED',
      terminal: true,
      reason: expect.stringMatching(/requires "to"/),
    });
    expect(await task.execute(contextFor({ to: 'ada@example.com' }))).toMatchObject({
      reason: expect.stringMatching(/requires "body" \(text\) or "html"/),
    });
    expect(await task.execute(contextFor({ transport: 'nope', to: 'a@b.c', body: 'x' }))).toMatchObject({
      reason: expect.stringMatching(/no SMTP transport "nope".*available: default, staging/),
    });

    // No transports at all: the task says that, rather than reporting a
    // connection failure to a server nobody configured.
    expect(await new EmailTaskExecutor().execute(contextFor({ to: 'a@b.c', body: 'x' }))).toMatchObject({
      reason: expect.stringMatching(/no SMTP transport configured/),
    });
  });

  /**
   * The distinction that makes a retry policy useful: a 5xx from SMTP means the
   * message was refused and will be refused again; anything else is the kind of
   * blip retrying exists for.
   */
  it('retries a transient failure and gives up on a permanent one', async () => {
    const permanent = stubTransport(async () => {
      throw new Error('550 5.1.1 recipient rejected');
    });
    expect(
      await new EmailTaskExecutor({ transports, createTransport: permanent.createTransport }).execute(
        contextFor({ to: 'nobody@example.com', body: 'x' })
      )
    ).toMatchObject({ status: 'FAILED', terminal: true });

    const transient = stubTransport(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:587');
    });
    expect(
      await new EmailTaskExecutor({ transports, createTransport: transient.createTransport }).execute(
        contextFor({ to: 'ada@example.com', body: 'x' })
      )
    ).toMatchObject({ status: 'FAILED', terminal: false });
  });
});
