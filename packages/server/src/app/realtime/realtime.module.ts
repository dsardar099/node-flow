import {
  Controller,
  Get,
  Headers,
  Injectable,
  Module,
  NotFoundException,
  Query,
  Req,
  Sse,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import {
  ErrorCode,
  Scope,
  isWorkflowTerminal,
  maskFields,
  type Principal,
  type WorkflowExecution,
} from '@node-flow-dev/core';
import {
  MetadataRepository,
  WorkflowEventNotifier,
  WorkflowEventsRepository,
  WorkflowRepository,
  type WorkflowEventRecord,
} from '@node-flow-dev/store';
import { Observable } from 'rxjs';
import { AllowResourceGrant, RequireScopes } from '../auth/auth.decorators.js';
import { EXECUTION_SCOPES, mayUse } from '../common/access-policy.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * The live execution stream.
 *
 * **Server-sent events, where the plan said WebSocket.** The divergence is
 * deliberate and it is about resume, not about taste. This stream is strictly
 * one-directional — the viewer receives and never sends — and `WorkflowEvents`
 * already carries a gap-free `seq` per execution. SSE's `Last-Event-ID` is
 * exactly that cursor: the browser resends it automatically on reconnect, and
 * the server answers with an indexed range scan over `("workflowId", "seq")`.
 * A WebSocket would have to hand-roll the same protocol and then get the
 * reconnect loop right, which is the part that is always subtly wrong.
 *
 * It also costs nothing at the edges: SSE is ordinary HTTP, so the session
 * cookie, the auth guard, the dashboard's proxy route and every intermediary
 * work unchanged, where a WebSocket upgrade needs special handling in all four.
 *
 * The honest cost: nothing can be sent *to* the server over this. Worker push
 * delivery in Phase 8 still wants a real bidirectional transport, and that is
 * where WebSocket earns its place.
 */

/** What a client receives. `id` is the resume cursor, not decoration. */
interface StreamMessage {
  id: string;
  type: string;
  data: string;
}

/** Where the guard leaves the execution it authorised, for the handler. */
interface AuthorisedRequest {
  principal?: Principal;
  params: { id?: string };
  nfExecution?: WorkflowExecution;
  /** The definition's `maskedFields`, hidden in every payload the stream sends. */
  nfMaskedFields?: ReadonlySet<string>;
}

/**
 * Decides whether the caller may watch this execution — **before** the stream
 * starts.
 *
 * A guard and not a check inside the handler, and the reason is a bug found in
 * testing rather than a style preference. Nest does not await an `@Sse()`
 * handler before it begins the response. A `NotFoundException` thrown from the
 * handler after its first `await` therefore races the response headers, and
 * under concurrency the headers usually won: 49 of 50 refused requests came back
 * as `200` with an open, empty event stream. No event data leaked — the refusal
 * still stopped the subscription — but an authorisation failure reported as a
 * success is wrong, and each one held a connection open indefinitely.
 *
 * Guards are awaited before anything is written, so a refusal here is always a
 * clean 404.
 */
@Injectable()
export class ExecutionStreamAccessGuard implements CanActivate {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly metadata: MetadataRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthorisedRequest>();
    const id = request.params.id ?? '';
    const principal = request.principal;

    // A malformed id is a 404, not a 500 — see the execution controller.
    const execution = isUuid(id) ? await this.workflows.findById(id) : undefined;

    // Identical for "not yours" and "does not exist": distinguishing them would
    // confirm another tenant's execution exists.
    // Tag access too: a stream carries the same payloads as the execution itself.
    const tags =
      principal && execution && execution.namespaceId === principal.namespaceId
        ? ((await this.metadata.tagsOf(execution.namespaceId, execution.defName)) ?? [])
        : [];
    const reachable = principal && execution ? mayUse(principal, 'READ', { name: execution.defName, tags }, EXECUTION_SCOPES) : false;
    if (!principal || !execution || execution.namespaceId !== principal.namespaceId || !reachable) {
      throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no execution ${id}` });
    }

    request.nfExecution = execution;
    const blueprint = await this.metadata.load(execution.namespaceId, execution.defName, execution.defVersion).catch(() => undefined);
    request.nfMaskedFields = new Set(blueprint?.maskedFields ?? []);
    return true;
  }
}

@Controller('ns/:ns/executions')
export class RealtimeController {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly events: WorkflowEventsRepository,
    private readonly notifier: WorkflowEventNotifier
  ) {}

  /**
   * Streams one execution's events until it reaches a terminal state.
   *
   * Authorisation happens once, before the stream opens, and that is sound
   * here in a way it would not be for a long-lived bidirectional socket: the
   * stream carries a single execution whose namespace was checked, and it grows
   * no new capabilities as it runs.
   */
  @Get(':id/stream')
  @RequireScopes(Scope.EXECUTIONS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @UseGuards(ExecutionStreamAccessGuard)
  @Sse()
  @ApiRoute({
    summary: 'Live event stream for one execution (SSE)',
    description:
      'Resumable: the browser replays `Last-Event-ID` automatically, and the ' +
      'server answers from that sequence number. Closes when the execution ' +
      'reaches a terminal state.',
    tags: ['executions'],
  })
  stream(
    @Req() request: AuthorisedRequest,
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string
  ): Observable<StreamMessage> {
    // Set by `ExecutionStreamAccessGuard`, which has already refused anything
    // this caller may not see. Synchronous from here on, deliberately: nothing
    // in this handler may fail after the response has started.
    const execution = request.nfExecution;
    if (!execution) {
      throw new NotFoundException({ error: ErrorCode.NOT_FOUND, message: 'no execution' });
    }

    // The header is how a browser resumes — `EventSource` replays it on its own
    // after a dropped connection, with no client code involved. The query
    // parameter covers everything that is not an `EventSource`: a first
    // connection that already knows where it left off, `curl`, and tests.
    //
    // The header wins, because when both are present the header is the more
    // recent truth: the query string was fixed when the URL was built and the
    // header reflects what actually arrived.
    //
    // Either way it is a *cursor the client owns*, so it is clamped rather than
    // trusted — a negative or non-numeric value must not become a read of
    // everything.
    const from = Math.max(0, Number(lastEventIdHeader ?? lastEventIdQuery) || 0);

    return new Observable<StreamMessage>((subscriber) => {
      let cursor = from;
      let closed = false;
      // Serialises reads. Without it a burst of notifications runs several
      // catch-ups concurrently, and two reads at the same cursor emit the same
      // events twice — the one duplication a resumable stream cannot explain
      // away, since the client is told these ids are a sequence.
      let draining: Promise<void> = Promise.resolve();

      const drain = () => {
        draining = draining.then(async () => {
          if (closed) return;

          try {
            // Status **before** events, and the order is load-bearing. The
            // evaluator writes a workflow's terminal status and its final
            // events in one transaction, so a status read as terminal
            // guarantees every event was already committed and the read below
            // will see them. Reading events first would leave the window where
            // the last event lands between the two reads and the stream closes
            // without having sent it.
            const status = await this.workflows.statusOf(execution.id);
            const batch = await this.events.since(execution.id, cursor, BATCH_SIZE);

            for (const event of batch) {
              if (closed) return;
              subscriber.next(toMessage(event, request.nfMaskedFields));
              cursor = event.seq;
            }

            // A full batch means there is more behind it; keep going rather
            // than waiting for a notification that has already been raised.
            if (batch.length >= BATCH_SIZE) return drain();

            // Closing on the execution's own status rather than on a list of
            // terminal event types. That list looks equivalent and is not: a
            // workflow timed out by the sweeper reaches `TIMED_OUT` without
            // appending any `workflow.*` event at all, so an event-type check
            // holds the stream open forever on exactly the executions someone
            // is most likely to be watching. A status check also cannot drift
            // as event types are added.
            if (!status || isWorkflowTerminal(status)) {
              closed = true;
              subscriber.complete();
            }
          } catch (error) {
            closed = true;
            subscriber.error(error);
          }
        });

        return draining;
      };

      const unsubscribe = this.notifier.subscribe(execution.id, () => void drain());

      // A reconnect means notifications were missed, so close the gap at once
      // rather than waiting for the next event — which, for an execution that
      // finished during the gap, would never come.
      const unsubscribeReconnect = this.notifier.onReconnect(() => void drain());

      // The backstop. Notification is an optimisation over a durable log and
      // never a delivery guarantee, so the stream re-reads on a slow timer
      // regardless. Without this, a listener drop at the wrong moment leaves a
      // viewer watching a spinner for an execution that finished minutes ago.
      const poll = setInterval(() => void drain(), POLL_INTERVAL_MS);
      poll.unref?.();

      // An execution that was already terminal when the viewer arrived streams
      // its history and ends — no notification is ever coming for it, and the
      // drain itself now recognises that.
      void drain();

      return () => {
        closed = true;
        clearInterval(poll);
        unsubscribe();
        unsubscribeReconnect();
      };
    });
  }
}

const BATCH_SIZE = 200;
const POLL_INTERVAL_MS = 15_000;

/**
 * One event on the wire.
 *
 * `id` is the sequence number, which is what makes the stream resumable: the
 * browser stores the last one it saw and replays it as `Last-Event-ID`.
 */
function toMessage(event: WorkflowEventRecord, masked: ReadonlySet<string> = new Set()): StreamMessage {
  return {
    id: String(event.seq),
    type: event.type,
    data: JSON.stringify({
      seq: event.seq,
      type: event.type,
      at: event.at,
      payload: maskFields(event.payload, masked),
    }),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID.test(value);

@Module({ controllers: [RealtimeController], providers: [ExecutionStreamAccessGuard] })
export class RealtimeModule {}
