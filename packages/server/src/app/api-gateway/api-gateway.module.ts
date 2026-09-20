import { Body, Controller, Headers, HttpCode, Inject, Module, NotFoundException, Options, Param, Post, Query, Res } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ErrorCode, Scope, WorkflowStatus, isWorkflowTerminal, type JsonValue, type Principal } from '@node-flow-dev/core';
import { MetadataRepository } from '@node-flow-dev/store';
import { AllowResourceGrant, CurrentPrincipal, Public, RequireScopes } from '../auth/auth.decorators.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { ExecutionController } from '../execution/execution.module.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Workflows as REST endpoints.
 *
 * The `/v1` API is shaped for operating node-flow: start a run, get a receipt,
 * poll it. That is the wrong shape for a caller who only wants an answer — a
 * partner's webhook, a front end, another team's service. They should not have
 * to learn what an execution is, or know that `output` lives two levels down
 * inside a status envelope.
 *
 * So: `POST /v1/ns/{ns}/api/{workflow}` runs the workflow and answers with its
 * **output**, nothing else. The request body is the input; query parameters are
 * merged in, so a link can carry arguments.
 *
 * ## The decisions worth knowing
 *
 * **Opt-in by tag, never by default.** A workflow is exposed only when it
 * carries `api:route`. Every definition becoming an endpoint the moment this
 * module loads is the kind of default that turns an internal workflow into a
 * public one without anyone deciding to.
 *
 * **Authentication is the same as everywhere else.** This is a different
 * *shape*, not a different *door*: the caller still needs a credential with
 * `executions:start` and whatever tag or resource grant covers that workflow.
 * Truly anonymous endpoints are a separate decision with its own blast radius,
 * and this layer deliberately does not make it quietly.
 *
 * **The workflow chooses its HTTP response, or gets a sensible one.** An
 * output with a `_response` object — `{ status, headers, body }` — is used as
 * the response; anything else is returned as a JSON body with 200. That covers
 * "return a 201 with a Location" without running user JavaScript inside the
 * gateway, which is what the products that offer "response transforms" end up
 * doing.
 *
 * **A run that outlives the wait is not an error.** It answers `202` with the
 * execution id, because the work is still happening and the caller can follow
 * it. Reporting a timeout as a failure would make every slow-but-fine workflow
 * look broken.
 */

export const API_ROUTE_TAG = 'api:route';

/** Reserved key in a workflow's output: the HTTP response it wants. */
const RESPONSE_KEY = '_response';

interface ReplyLike {
  header(name: string, value: string): unknown;
  status(code: number): unknown;
}

@Controller('ns/:ns/api')
export class ApiGatewayController {
  constructor(
    private readonly metadata: MetadataRepository,
    private readonly modules: ModuleRef,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  private get executions(): ExecutionController {
    return this.modules.get(ExecutionController, { strict: false });
  }

  /**
   * The preflight a browser sends before a cross-origin call.
   *
   * `@Public()` by necessity — a preflight carries no credentials, so requiring
   * one would make every cross-origin call fail before the real request is ever
   * sent. It reveals nothing: the answer is the same for a workflow that exists
   * and one that does not.
   */
  @Public()
  @Options(':workflow')
  @HttpCode(204)
  preflight(@Headers('origin') origin: string | undefined, @Res({ passthrough: true }) reply: ReplyLike): void {
    if (!this.allowOrigin(origin, reply)) return;
    reply.header('access-control-allow-methods', 'POST, OPTIONS');
    reply.header('access-control-allow-headers', 'content-type, authorization, x-api-key, x-idempotency-key');
    reply.header('access-control-max-age', '600');
  }

  @Post(':workflow')
  @HttpCode(200)
  @RequireScopes(Scope.EXECUTIONS_START)
  @AllowResourceGrant('WORKFLOW', 'EXECUTE')
  @ApiRoute({
    summary: 'Call a workflow as a REST endpoint',
    description:
      'Runs a workflow tagged `api:route` and answers with its output. Query parameters are ' +
      'merged into the input. Waits up to `wait` seconds (default 15, max 60); a run still ' +
      'going answers 202 with its id. An output containing `_response` shapes the HTTP reply.',
    tags: ['gateway'],
  })
  async call(
    @CurrentPrincipal() principal: Principal,
    @Param('workflow') name: string,
    @Query() query: Record<string, string>,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: ReplyLike,
    @Headers('x-idempotency-key') idempotencyKey?: string,
    @Headers('origin') origin?: string
  ) {
    // The preflight's approval does not carry over to the real request; the
    // browser checks these headers on this response too, and omitting them
    // makes a cross-origin call fail *after* the workflow has already run.
    this.allowOrigin(origin, reply);

    // Tags are read with full access here, then checked: the caller's own
    // grants are enforced by the guard and by `execute` below, and a lookup
    // filtered by them would answer "not exposed" for a workflow that is
    // exposed but not theirs — a different fact, and a confusing one.
    const everything = { tagGrants: ['*'], can: () => true };
    const versions = await this.metadata.listWorkflows(principal.namespaceId, everything);
    const exposed = versions.find((row) => row.name === name && row.tags.includes(API_ROUTE_TAG));

    // The same answer whether the workflow does not exist or is not exposed:
    // otherwise this route enumerates every internal workflow by name.
    if (!exposed) {
      throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no API route "${name}"` });
    }

    const { wait, ...parameters } = query ?? {};
    const waitForSeconds = Math.min(Math.max(Number(wait ?? 15) || 0, 0), 60);

    const input: Record<string, JsonValue> = {
      // Query first, so a body field of the same name wins — the body is the
      // deliberate payload and a query string is often a copy-paste leftover.
      ...(parameters as Record<string, JsonValue>),
      ...(isRecord(body) ? (body as Record<string, JsonValue>) : body === undefined || body === null ? {} : { body: body as JsonValue }),
    };

    const outcome = (await this.executions.execute(principal, name, {
      input,
      waitForSeconds,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    } as never)) as {
      workflowId: string;
      status: WorkflowStatus;
      output?: Record<string, JsonValue>;
      reasonForIncompletion?: string | null;
    };

    if (!isWorkflowTerminal(outcome.status)) {
      reply.status(202);
      return { workflowId: outcome.workflowId, status: outcome.status };
    }

    if (outcome.status !== WorkflowStatus.COMPLETED) {
      // 502: the gateway asked something on the caller's behalf and it failed.
      // A 500 would say *this* service broke, which is a different diagnosis.
      reply.status(502);
      return {
        workflowId: outcome.workflowId,
        status: outcome.status,
        error: outcome.reasonForIncompletion ?? 'the workflow failed',
      };
    }

    return this.shapeResponse(outcome.output ?? {}, reply);
  }

  /**
   * Echoes the caller's origin when it is on the list, and says so to caches.
   *
   * Echoing rather than sending `*` is what allows credentials at all, and
   * `Vary: Origin` is what stops a shared cache from handing one site's
   * permissive response to another. Both are easy to omit, and the omission
   * usually shows up as a security finding months later.
   */
  private allowOrigin(origin: string | undefined, reply: ReplyLike): boolean {
    reply.header('vary', 'Origin');
    if (!origin || !this.config.NODE_FLOW_GATEWAY_CORS_ORIGINS.includes(origin)) return false;

    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-credentials', 'true');
    return true;
  }

  /**
   * Applies a `_response` the workflow produced, if it produced one.
   *
   * Header values are stringified and the status is bounded to a real HTTP
   * range: a workflow returning `{ status: 0 }` or an object as a header value
   * would otherwise produce a response Node refuses to send, turning a
   * successful run into an opaque 500.
   */
  private shapeResponse(output: Record<string, JsonValue>, reply: ReplyLike): unknown {
    const shape = output[RESPONSE_KEY];
    if (!isRecord(shape)) return output;

    const status = Number(shape['status']);
    if (Number.isInteger(status) && status >= 200 && status <= 599) reply.status(status);

    const headers = shape['headers'];
    if (isRecord(headers)) {
      for (const [header, value] of Object.entries(headers)) {
        if (value === null || value === undefined || isRecord(value) || Array.isArray(value)) continue;
        reply.header(header, String(value));
      }
    }

    return 'body' in shape ? shape['body'] : {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Module({ controllers: [ApiGatewayController] })
export class ApiGatewayModule {}
