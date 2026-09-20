import { Inject, Injectable } from '@nestjs/common';
import type { JsonValue } from '@node-flow-dev/core';
import type { Db } from '@node-flow-dev/store';
import { DB } from '../database/database.module.js';

/**
 * What an audited entity looked like, so an audit entry can say what changed
 * and not only that something did.
 *
 * Read by the interceptor before the handler runs and again after it succeeds.
 * Each loader selects columns by name rather than `*`: a column added to a
 * table later is not recorded until someone decides it is safe to, which is
 * the right default for anything holding password hashes, token hashes or
 * sealed secret values. Runtime counters (last run, event counts) are left out
 * too — they change on their own and would bury the edit in noise.
 */

export interface SnapshotRequest {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
}

/** Snapshots larger than this are replaced by a marker; a definition can be big. */
const MAX_SNAPSHOT_BYTES = 64_000;

type Loader = (db: Db, namespaceId: string, request: SnapshotRequest) => Promise<unknown>;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const bodyField = (request: SnapshotRequest, key: string) =>
  typeof request.body === 'object' && request.body !== null ? text((request.body as Record<string, unknown>)[key]) : undefined;
const nameOf = (request: SnapshotRequest) => text(request.params?.['name']) ?? bodyField(request, 'name');
const versionOf = (request: SnapshotRequest) => {
  const raw = request.query?.['version'];
  const version = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isInteger(version) && version > 0 ? version : undefined;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (request: SnapshotRequest) => {
  const id = text(request.params?.['id']);
  return id && UUID.test(id) ? id : undefined;
};

async function groupWithMembers(db: Db, namespaceId: string, name: string | undefined) {
  if (!name) return null;
  const group = await db
    .selectFrom('Groups')
    .select(['id', 'name', 'description', 'scopes', 'tagGrants'])
    .where('namespaceId', '=', namespaceId)
    .where('name', '=', name)
    .executeTakeFirst();
  if (!group) return null;
  const members = await db
    .selectFrom('GroupMembers')
    .innerJoin('Users', 'Users.id', 'GroupMembers.userId')
    .select('Users.email')
    .where('GroupMembers.groupId', '=', group.id)
    .orderBy('Users.email')
    .execute();
  const { id: _id, ...rest } = group;
  return { ...rest, members: members.map((m) => m.email) };
}

const LOADERS: Record<string, Loader> = {
  workflow: async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    return (
      (await db
        .selectFrom('WorkflowDefinitions')
        .select(['name', 'version', 'definition', 'tags'])
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .$call((q) => {
          const version = versionOf(request);
          return version ? q.where('version', '=', version) : q;
        })
        .orderBy('version', 'desc')
        .limit(1)
        .executeTakeFirst()) ?? null
    );
  },
  'task-definition': async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    const row = await db
      .selectFrom('TaskDefinitions')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();
    if (!row) return null;
    const { namespaceId: _ns, createdAt: _c, updatedAt: _u, ...definition } = row;
    return definition;
  },
  form: (db, namespaceId, request) => latestVersioned(db, 'FormTemplates', namespaceId, request, ['name', 'version', 'schema', 'description']),
  schema: (db, namespaceId, request) => latestVersioned(db, 'Schemas', namespaceId, request, ['name', 'version', 'type', 'data', 'description']),
  'environment-variable': async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    return (
      (await db
        .selectFrom('EnvironmentVariables')
        .select(['name', 'type', 'value', 'description'])
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .executeTakeFirst()) ?? null
    );
  },
  // Never the value: a secret's audit trail says it changed, not what to.
  secret: async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    return (
      (await db
        .selectFrom('Secrets')
        .select(['name', 'description', 'sealed', 'keyId', 'updatedAt'])
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .executeTakeFirst()) ?? null
    );
  },
  schedule: async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    return (
      (await db
        .selectFrom('Schedules')
        .select(['name', 'description', 'cron', 'timezone', 'defName', 'defVersion', 'input', 'correlationId', 'priority', 'paused', 'startAt', 'endAt', 'overlapPolicy', 'catchupPolicy'])
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .executeTakeFirst()) ?? null
    );
  },
  'event-handler': async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    return (
      (await db
        .selectFrom('EventHandlers')
        .select(['name', 'description', 'source', 'topic', 'condition', 'action', 'defName', 'defVersion', 'inputTemplate', 'correlationId', 'workflowIdExpr', 'taskRefExpr', 'enabled'])
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .executeTakeFirst()) ?? null
    );
  },
  integration: async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    const row = await db
      .selectFrom('Integrations')
      .select(['name', 'kind', 'provider', 'description', 'baseUrl', 'apiKeySecret', 'models', 'config', 'enabled'])
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();
    if (!row) return null;
    const { headers, ...config } = (row.config ?? {}) as Record<string, unknown>;
    return { ...row, config: headers ? { ...config, headerNames: Object.keys(headers as object).sort() } : config };
  },
  prompt: async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    return (
      (await db
        .selectFrom('Prompts')
        .select(['name', 'version', 'description', 'template', 'models'])
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .orderBy('version', 'desc')
        .limit(1)
        .executeTakeFirst()) ?? null
    );
  },
  'status-listener': async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    const row = await db
      .selectFrom('StatusListeners')
      .select(['name', 'description', 'enabled', 'workflowNames', 'events', 'sink', 'config', 'includeOutput'])
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();
    if (!row) return null;
    // Header values often carry a token; which headers are sent is the useful part.
    const { headers, ...config } = (row.config ?? {}) as Record<string, unknown>;
    return { ...row, config: headers ? { ...config, headerNames: Object.keys(headers as object).sort() } : config };
  },
  'incoming-webhook': async (db, namespaceId, request) => {
    const name = nameOf(request);
    if (!name) return null;
    return (
      (await db
        .selectFrom('IncomingWebhooks')
        .select(['name', 'description', 'verifier', 'config', 'secretName', 'enabled'])
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .executeTakeFirst()) ?? null
    );
  },
  group: (db, namespaceId, request) => groupWithMembers(db, namespaceId, nameOf(request)),
  user: async (db, namespaceId, request) => {
    const id = idOf(request);
    const email = bodyField(request, 'email')?.trim().toLowerCase();
    if (!id && !email) return null;
    return (
      (await db
        .selectFrom('Users')
        .select(['email', 'name', 'scopes', 'disabledAt'])
        .where('namespaceId', '=', namespaceId)
        .$call((q) => (id ? q.where('id', '=', id) : q.where('email', '=', email as string)))
        .executeTakeFirst()) ?? null
    );
  },
  'service-account': async (db, namespaceId, request) => {
    const id = idOf(request);
    const name = bodyField(request, 'name');
    if (!id && !name) return null;
    return (
      (await db
        .selectFrom('ServiceAccounts')
        .select(['name', 'keyId', 'scopes', 'disabledAt'])
        .where('namespaceId', '=', namespaceId)
        .$call((q) => (id ? q.where('id', '=', id) : q.where('name', '=', name as string)))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .executeTakeFirst()) ?? null
    );
  },
  'api-key': async (db, namespaceId, request) => {
    const id = idOf(request);
    const name = bodyField(request, 'name');
    if (!id && !name) return null;
    return (
      (await db
        .selectFrom('ApiKeys')
        .select(['name', 'prefix', 'scopes', 'expiresAt', 'revokedAt'])
        .where('namespaceId', '=', namespaceId)
        .$call((q) => (id ? q.where('id', '=', id) : q.where('name', '=', name as string)))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .executeTakeFirst()) ?? null
    );
  },
  'workload-identity': async (db, namespaceId, request) => {
    const id = idOf(request);
    const [kind, issuer, subject] = ['kind', 'issuer', 'subject'].map((key) => bodyField(request, key));
    if (!id && !(kind && issuer && subject)) return null;
    return (
      (await db
        .selectFrom('WorkloadIdentities')
        .leftJoin('ServiceAccounts', 'ServiceAccounts.id', 'WorkloadIdentities.serviceAccountId')
        .select(['WorkloadIdentities.kind', 'WorkloadIdentities.issuer', 'WorkloadIdentities.subject', 'WorkloadIdentities.description', 'WorkloadIdentities.disabledAt', 'ServiceAccounts.name as serviceAccount'])
        .where('WorkloadIdentities.namespaceId', '=', namespaceId)
        .$call((q) =>
          id
            ? q.where('WorkloadIdentities.id', '=', id)
            : q.where('WorkloadIdentities.kind', '=', kind as string).where('WorkloadIdentities.issuer', '=', issuer as string).where('WorkloadIdentities.subject', '=', subject as string)
        )
        .executeTakeFirst()) ?? null
    );
  },
  'human-task': async (db, namespaceId, request) => {
    const id = idOf(request);
    if (!id) return null;
    return (
      (await db
        .selectFrom('HumanTasks')
        .select(['title', 'refName', 'workflowId', 'assignments', 'assignmentIndex', 'assigneeId', 'assigneeGroupId', 'claimedBy', 'completedAt', 'completedBy', 'skippedReason'])
        .where('namespaceId', '=', namespaceId)
        .where('id', '=', id)
        .executeTakeFirst()) ?? null
    );
  },
  quota: async (db, namespaceId) => {
    const row = await db.selectFrom('Namespaces').select('settings').where('id', '=', namespaceId).executeTakeFirst();
    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    return settings['quotas'] ?? null;
  },
};

async function latestVersioned(
  db: Db,
  table: 'FormTemplates' | 'Schemas',
  namespaceId: string,
  request: SnapshotRequest,
  columns: string[]
): Promise<unknown> {
  const name = nameOf(request);
  if (!name) return null;
  const version = versionOf(request);
  // Both tables share (namespaceId, name, version); the column list is fixed above.
  const query = (db as unknown as Db)
    .selectFrom(table as 'FormTemplates')
    .select(columns as never[])
    .where('namespaceId', '=', namespaceId)
    .where('name', '=', name);
  return (await (version ? query.where('version', '=', version) : query).orderBy('version', 'desc').limit(1).executeTakeFirst()) ?? null;
}

@Injectable()
export class AuditSnapshots {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Whether `resource` has a snapshot at all; actions like `secret.rotate` do not. */
  supports(resource: string, action: string): boolean {
    return resource in LOADERS && !(resource === 'event-handler' && action === 'test');
  }

  /**
   * The entity as JSON, `null` when it does not exist, or `undefined` when it
   * could not be read. A snapshot is best-effort: failing to read one must never
   * fail the change it would describe.
   */
  async load(resource: string, namespaceId: string, request: SnapshotRequest): Promise<JsonValue | undefined> {
    const loader = LOADERS[resource];
    if (!loader) return undefined;
    try {
      const value = await loader(this.db, namespaceId, request);
      // Dates to ISO strings, and nothing that is not plain JSON.
      const serialised = JSON.stringify(value ?? null);
      if (serialised.length > MAX_SNAPSHOT_BYTES) return { truncated: true, bytes: serialised.length };
      return JSON.parse(serialised) as JsonValue;
    } catch {
      return undefined;
    }
  }
}
