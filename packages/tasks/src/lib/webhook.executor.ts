import { createHmac } from 'node:crypto';
import { TaskType, type JsonValue } from '@node-flow-dev/core';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';
import { HttpTaskExecutor, type HttpExecutorOptions } from './http.executor.js';

/**
 * `WEBHOOK` — delivers a signed event to an external URL.
 *
 * Deliberately a separate task type rather than "use `HTTP`", because the thing
 * that makes a webhook a webhook is exactly what generic HTTP does not do:
 *
 *  - **It is signed.** The receiver has no other way to know the delivery came
 *    from you rather than from anyone who learned the URL. Without a signature
 *    a public callback endpoint is an open write.
 *  - **It carries delivery metadata.** A timestamp and a unique id are what let
 *    the receiver reject replays and deduplicate retries — and every sender
 *    retries, so a receiver without them will eventually double-process.
 *  - **Its failures are delivery failures.** A 500 from the receiver means try
 *    again; a 400 means this event will never be accepted. The retry policy
 *    needs that distinction, and `HTTP` already draws it.
 *
 * The transport is the `HTTP` executor, reused rather than re-implemented — so
 * the SSRF guard, redirect handling, size caps and header redaction all apply
 * here too. A webhook URL is user-supplied like any other.
 */

export interface WebhookExecutorOptions extends HttpExecutorOptions {
  /** Header carrying the signature. Defaults to the widely-used spelling. */
  signatureHeader?: string;
  timestampHeader?: string;
  deliveryIdHeader?: string;
}

export class WebhookTaskExecutor implements TaskExecutor {
  readonly type = TaskType.WEBHOOK;
  private readonly http: HttpTaskExecutor;

  constructor(private readonly options: WebhookExecutorOptions = {}) {
    this.http = new HttpTaskExecutor(options);
  }

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const url = context.input['url'] ?? context.input['uri'];
    if (typeof url !== 'string' || url === '') {
      return { status: 'FAILED', reason: 'webhook task requires a "url"', terminal: true };
    }

    const event = context.input['event'] ?? context.input['payload'] ?? {};
    const secret = context.input['signingKey'] ?? context.input['secret'];

    // A stable, unique id per *task*, not per attempt. A retry re-delivers the
    // same event, and a receiver deduplicating on this id must see them as one
    // — which is the entire point of sending it.
    const deliveryId = context.taskId;
    const timestamp = Math.floor(Date.now() / 1000);

    const envelope: Record<string, JsonValue> = {
      id: deliveryId,
      timestamp,
      workflowId: context.workflowId,
      event: event as JsonValue,
    };

    const body = JSON.stringify(envelope);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [this.options.deliveryIdHeader ?? 'x-nodeflow-delivery']: deliveryId,
      [this.options.timestampHeader ?? 'x-nodeflow-timestamp']: String(timestamp),
      ...readHeaders(context.input['headers']),
    };

    if (typeof secret === 'string' && secret !== '') {
      // Signed over `timestamp.body`, not the body alone. Binding the timestamp
      // into the signature is what makes it useful against replay: a captured
      // delivery cannot be re-sent later with a fresh timestamp, because doing
      // so invalidates the signature.
      const signature = createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');

      headers[this.options.signatureHeader ?? 'x-nodeflow-signature'] = `sha256=${signature}`;
    }

    const outcome = await this.http.execute({
      ...context,
      input: {
        uri: url,
        method: 'POST',
        headers,
        // Pre-serialised, so the bytes signed are exactly the bytes sent. Handing
        // the object over and letting it re-serialise would change key order and
        // break every signature.
        body,
      },
    });

    return annotate(outcome, deliveryId, timestamp);
  }
}

/**
 * Adds the delivery receipt to whatever the transport reported.
 *
 * Recorded on failure as well as success: "we tried to deliver this id at this
 * time and got a 503" is the question asked when a receiver says it never
 * arrived, and without it the answer is a shrug.
 */
function annotate(outcome: TaskOutcome, deliveryId: string, timestamp: number): TaskOutcome {
  const receipt = { deliveryId, deliveredAt: timestamp };

  return outcome.status === 'COMPLETED'
    ? { ...outcome, output: { ...(outcome.output ?? {}), ...receipt } }
    : { ...outcome, output: { ...(outcome.output ?? {}), ...receipt } };
}

function readHeaders(value: JsonValue | undefined): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const headers: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      headers[name.toLowerCase()] = String(entry);
    }
  }

  return headers;
}
