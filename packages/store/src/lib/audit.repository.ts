import type { JsonValue, Principal } from '@node-flow-dev/core';
import type { Db, Queryable } from './database.js';
import { json } from './schema.js';

/**
 * The audit log.
 *
 * **Append-only by construction**: there is no update and no delete here, and
 * that absence is the feature. An audit log with an edit path is a log nobody
 * can rely on, and the argument for adding one always sounds reasonable in the
 * moment.
 *
 * Retention is handled by dropping whole partitions, which never rewrites a
 * surviving row.
 */

export interface AuditEntry {
  namespaceId: string;
  actor: Pick<Principal, 'type' | 'id' | 'name'>;
  /** `resource.action` — `secret.put`, `group.scopes-set`, `schedule.delete`. */
  action: string;
  resource: string;
  resourceId?: string;
  /** Context, never the value of anything sensitive. */
  detail?: Record<string, JsonValue>;
  ip?: string;
  userAgent?: string;
  outcome?: 'ok' | 'denied' | 'failed';
}

export interface AuditRecord extends Omit<AuditEntry, 'actor'> {
  id: string;
  actorType: string;
  actorId: string;
  actorName: string | null;
  at: Date;
}

export class AuditRepository {
  constructor(private readonly db: Db) {}

  /**
   * Records a change.
   *
   * Takes an optional transaction so an entry can share the fate of what it
   * describes: writing "secret rotated" for a rotation that rolled back is a
   * log that lies, which is worse than no log.
   *
   * Callers that cannot share one — anything reporting on a request already
   * committed — pass nothing and accept that a crash in the gap loses the
   * entry. That trade is deliberate: never dropping the *operation* because
   * its audit write failed matters more.
   */
  async record(entry: AuditEntry, tx?: Queryable): Promise<void> {
    await (tx ?? this.db)
      .insertInto('AuditEvents')
      .values({
        namespaceId: entry.namespaceId,
        actorType: entry.actor.type,
        actorId: entry.actor.id,
        actorName: entry.actor.name ?? null,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        detail: json(entry.detail ?? {}),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        outcome: entry.outcome ?? 'ok',
      })
      .execute();
  }

  /**
   * The query an investigation runs: this namespace, newest first.
   *
   * Keyset-paginated on `(at, id)` rather than by offset, because an audit log
   * grows at the head and an offset walks a moving target — page two of an
   * OFFSET query silently skips whatever arrived while you were reading page
   * one, which for an audit log is the worst possible failure.
   */
  async list(
    namespaceId: string,
    options: {
      actorId?: string;
      resource?: string;
      action?: string;
      limit?: number;
      before?: { at: Date; id: string };
    } = {}
  ): Promise<AuditRecord[]> {
    let query = this.db
      .selectFrom('AuditEvents')
      .selectAll()
      .where('namespaceId', '=', namespaceId);

    if (options.actorId) query = query.where('actorId', '=', options.actorId);
    if (options.resource) query = query.where('resource', '=', options.resource);
    if (options.action) query = query.where('action', '=', options.action);

    if (options.before) {
      // Strictly before the cursor, comparing the pair — `at` alone is not
      // unique, and two entries in the same microsecond would otherwise repeat
      // or vanish across a page boundary.
      const { at, id } = options.before;
      query = query.where((eb) =>
        eb.or([eb('at', '<', at), eb.and([eb('at', '=', at), eb('id', '<', id)])])
      );
    }

    const rows = await query
      .orderBy('at', 'desc')
      .orderBy('id', 'desc')
      .limit(Math.min(options.limit ?? 50, 500))
      .execute();

    return rows.map((row) => ({
      id: row.id,
      namespaceId: row.namespaceId,
      actorType: row.actorType,
      actorId: row.actorId,
      actorName: row.actorName,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId ?? undefined,
      detail: (row.detail ?? {}) as Record<string, JsonValue>,
      ip: row.ip ?? undefined,
      userAgent: row.userAgent ?? undefined,
      outcome: row.outcome as AuditEntry['outcome'],
      at: row.at,
    }));
  }
}
