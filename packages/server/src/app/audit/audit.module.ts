import { Controller, Get, Module, Query } from '@nestjs/common';
import { Scope, type Principal } from '@node-flow-dev/core';
import { AuditRepository, type AuditRecord } from '@node-flow-dev/store';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Reading the audit log.
 *
 * Read-only, because the repository offers nothing else — an audit log with an
 * edit path is one nobody can rely on.
 *
 * `admin`-scoped: the log names who did what and from where, which is both the
 * point and a reason not to expose it to everyone who can read an execution.
 */
@Controller('ns/:ns/audit')
export class AuditController {
  constructor(private readonly audit: AuditRepository) {}

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Read the audit log, newest first',
    description:
      'Keyset-paginated: pass the previous page’s `nextCursor`. Offsets are ' +
      'deliberately not offered — a log grows at the head, so page two of an ' +
      'offset query silently skips whatever arrived while page one was read.',
    tags: ['audit'],
  })
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query('actorId') actorId?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string
  ) {
    const entries = await this.audit.list(principal.namespaceId, {
      actorId,
      resource,
      action,
      limit: limit ? Number(limit) : undefined,
      before: parseCursor(cursor),
    });

    return {
      entries: entries.map(present),
      // Absent on the last page, so a caller can stop without a second request.
      nextCursor:
        entries.length > 0
          ? encodeCursor(entries[entries.length - 1])
          : undefined,
    };
  }
}

/** `at|id`, base64url — opaque to the caller, so its shape can change. */
function encodeCursor(entry: AuditRecord): string {
  return Buffer.from(`${entry.at.toISOString()}|${entry.id}`).toString('base64url');
}

function parseCursor(cursor?: string): { at: Date; id: string } | undefined {
  if (!cursor) return undefined;

  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const parsed = new Date(at ?? '');

  // A malformed cursor reads the first page rather than failing: it is almost
  // always a truncated URL, and an error there tells the reader nothing useful.
  return id && !Number.isNaN(parsed.getTime()) ? { at: parsed, id } : undefined;
}

function present(entry: AuditRecord) {
  return {
    id: entry.id,
    at: entry.at,
    actor: { type: entry.actorType, id: entry.actorId, name: entry.actorName },
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    detail: entry.detail,
    ip: entry.ip,
    userAgent: entry.userAgent,
    outcome: entry.outcome,
  };
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
