import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditRepository, type AuditEntry } from '@node-flow-dev/store';
import type { JsonValue } from '@node-flow-dev/core';
import { from, Observable, switchMap, tap } from 'rxjs';
import { AuditSnapshots } from './audit-snapshots.js';

/**
 * Records control-plane changes, declared next to the route that makes them.
 *
 * An interceptor rather than a call in each handler, because an audit log whose
 * completeness depends on every future author remembering a line is an audit
 * log with holes in it — and the holes are invisible until the day somebody
 * needs the entry that is missing.
 *
 * It records the *attempt* as well as the outcome. A denied or failed change is
 * usually more interesting than a successful one: "who tried to read the
 * production secrets and was refused" is the question an incident starts with.
 */

export const AUDIT_KEY = 'nf:audit';

/** Declares a route as auditable: `@Audited('secret', 'put')`. */
export const Audited = (resource: string, action: string) =>
  SetMetadata(AUDIT_KEY, { resource, action });

interface AuditTarget {
  resource: string;
  action: string;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditRepository,
    private readonly snapshots: AuditSnapshots
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const target = this.reflector.getAllAndOverride<AuditTarget | undefined>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!target) return next.handle();

    const request = context.switchToHttp().getRequest<AuditRequest>();
    const principal = request.principal;

    // No principal means the guard refused before this ran, and there is
    // nobody to attribute the attempt to.
    if (!principal) return next.handle();

    const entry: AuditEntry = {
      namespaceId: principal.namespaceId,
      actor: { type: principal.type, id: principal.id, name: principal.name },
      action: `${target.resource}.${target.action}`,
      resource: target.resource,
      // The name in the path is what a person searches for; an id is not.
      // A create has no path parameter; the name in the body is still what a
      // person searches for, and a name or email is never the secret part.
      resourceId: request.params?.['name'] ?? request.params?.['id'] ?? bodyIdentity(request.body),
      detail: describe(request),
      ip: clientIp(request),
      userAgent: first(request.headers?.['user-agent']),
    };

    // No state to compare for actions that change none (a test dispatch, a key rotation).
    if (!this.snapshots.supports(target.resource, target.action)) {
      return next.handle().pipe(
        tap({
          next: () => void this.write(entry),
          error: (error: unknown) => void this.write({ ...entry, outcome: outcomeOf(error) }),
        })
      );
    }

    // Read before the handler runs, and again after it succeeds, so the entry
    // says what changed rather than only which fields were sent.
    const load = () => this.snapshots.load(target.resource, principal.namespaceId, request);
    return from(load()).pipe(
      switchMap((before) =>
        next.handle().pipe(
          tap({
            // Written after the handler succeeds, deliberately not inside its
            // transaction: an audit write that fails must not roll back the change
            // it describes, and losing an entry to a crash in that gap is the
            // better of the two failures.
            next: () =>
              void load().then((after) => this.write({ ...entry, detail: withStates(entry.detail, before, after) })),
            error: (error: unknown) =>
              void this.write({ ...entry, detail: withStates(entry.detail, before, undefined), outcome: outcomeOf(error) }),
          })
        )
      )
    );
  }

  private async write(entry: AuditEntry): Promise<void> {
    // Swallowed on purpose. The operation already happened; throwing here would
    // turn a successful change into a 500 and invite a retry that repeats it.
    await this.audit.record(entry).catch(() => undefined);
  }
}

/**
 * What changed, without the value of what changed.
 *
 * The body of a secret write contains the secret. Recording field *names* keeps
 * the entry useful — "they replaced the value and the description" — without
 * making the audit log a second place credentials live.
 */
function describe(request: AuditRequest): Record<string, string[] | string> {
  const body = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};

  return { fields: Object.keys(body as Record<string, unknown>) };
}

/** Adds `before` and `after` when they were read; either may be `null` (did not exist). */
function withStates(
  detail: AuditEntry['detail'],
  before: JsonValue | undefined,
  after: JsonValue | undefined
): AuditEntry['detail'] {
  return {
    ...detail,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
}

function bodyIdentity(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  // Email first: a user's display name is not unique, and "Member" identifies nobody.
  const value = record['email'] ?? record['name'];
  return typeof value === 'string' ? value.slice(0, 255) : undefined;
}

function outcomeOf(error: unknown): AuditEntry['outcome'] {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : undefined;

  return status === 401 || status === 403 ? 'denied' : 'failed';
}

/**
 * The client address.
 *
 * `x-forwarded-for` is honoured because node-flow sits behind a proxy in every
 * real deployment, and only the first entry is taken — the rest are appended by
 * intermediaries and a client can forge the whole header anyway. It is evidence,
 * not proof, and is recorded as such.
 */
function clientIp(request: AuditRequest): string | undefined {
  const forwarded = first(request.headers?.['x-forwarded-for']);
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return request.ip;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface AuditRequest {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  principal?: {
    type: AuditEntry['actor']['type'];
    id: string;
    name: string;
    namespaceId: string;
  };
}
