import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ErrorCode, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { WebhookRepository } from '@node-flow-dev/store';
import { Public } from '../auth/auth.decorators.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * The inbound callback endpoint for `WAIT_FOR_WEBHOOK`.
 *
 * **Public, and that is the point.** A third party — a payment provider, a
 * signing service, an approval system — cannot hold an API credential for your
 * install. The unguessable token in the URL *is* the capability: it completes
 * exactly one task and grants nothing else, so handing it out is safe in a way
 * handing out an API key never is.
 *
 * Everything that makes that safe lives in `WebhookRepository`: the token is
 * stored hashed, claimed with a conditional update so a retried delivery cannot
 * complete the task twice, optionally HMAC-verified, and expiring.
 */
@Controller('ns/:ns/webhooks')
export class WebhookController {
  constructor(private readonly webhooks: WebhookRepository) {}

  /**
   * Delivers a callback.
   *
   * The status codes are chosen for how senders actually behave, which matters
   * more here than elsewhere: almost every webhook sender retries on 5xx and
   * gives up on 4xx, so getting these wrong means either a lost callback or an
   * endless retry storm.
   */
  @Public()
  @Post(':token')
  @HttpCode(200)
  @ApiRoute({
    summary: 'Deliver a callback to a waiting WAIT_FOR_WEBHOOK task',
    description:
      'Public by design: the unguessable token is the capability, and it ' +
      'completes exactly one task. Single-use, so a retried delivery is a 409 ' +
      'rather than a second completion.',
    tags: ['webhooks'],
  })
  async deliver(
    @Param('token') token: string,
    @Body() body: unknown,
    @Headers('x-nodeflow-signature') signature: string | undefined,
    @Req() request: { rawBody?: Buffer | string }
  ) {
    const payload =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, JsonValue>)
        : { body: body as JsonValue };

    const result = await this.webhooks.deliver({
      token,
      payload,
      rawBody: rawBodyOf(request, body),
      signature,
    });

    if (result.ok) {
      return { accepted: true, workflowId: result.workflowId, taskRef: result.refName };
    }

    switch (result.reason) {
      case 'consumed':
        // 409, not 200. A sender retrying its own successful delivery should
        // learn it already landed; a 200 would be indistinguishable from having
        // completed the task a second time.
        throw new NodeFlowError(ErrorCode.CONFLICT, 'this callback has already been delivered');

      case 'expired':
        throw new NodeFlowError(ErrorCode.CONFLICT, 'this callback has expired');

      case 'not_waiting':
        // The workflow was terminated, or the task timed out while waiting.
        // Telling the sender beats a 200 for a no-op.
        throw new NodeFlowError(
          ErrorCode.CONFLICT,
          'the task this callback belongs to is no longer waiting'
        );

      case 'bad_signature':
        throw new NodeFlowError(ErrorCode.INVALID_ARGUMENT, 'signature does not match');

      default:
        // Deliberately indistinguishable from a token that never existed:
        // confirming which tokens are real would let someone probe for live
        // callbacks.
        throw new NotFoundException({
          error: ErrorCode.NOT_FOUND,
          message: 'no such callback',
        });
    }
  }
}

/**
 * The exact bytes the sender signed.
 *
 * A signature is computed over the raw body: re-serialising the parsed object
 * changes key order and whitespace, so a recomputed digest would never match.
 * Fastify only retains the raw body when asked, so this falls back to a
 * faithful re-serialisation — which works for senders producing canonical JSON,
 * and is why `rawBody` is preferred whenever it is present.
 */
function rawBodyOf(request: { rawBody?: Buffer | string }, parsed: unknown): string {
  if (typeof request.rawBody === 'string') return request.rawBody;
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody.toString('utf8');
  return JSON.stringify(parsed);
}

@Module({ controllers: [WebhookController] })
export class WebhookModule {}
