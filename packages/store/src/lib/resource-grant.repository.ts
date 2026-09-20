import {
  ErrorCode,
  InvalidArgumentError,
  NodeFlowError,
  PrincipalType,
  RESOURCE_ACCESS,
  RESOURCE_TYPES,
  isValidGrantTarget,
  type Principal,
  type ResourceAccess,
  type ResourceGrant,
  type ResourceType,
} from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';

/**
 * Fine-grained permissions, stored.
 *
 * A grant is one subject's access to one target. Subjects are users, groups
 * (every member gets it) and applications (a service account or an API key).
 * Resolved for a principal on each request — its own grants plus its groups' —
 * behind a short cache, so a revoked grant stops working within seconds.
 */

export const SUBJECT_TYPES = ['USER', 'GROUP', 'APPLICATION'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export interface StoredGrant extends ResourceGrant {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  /** What a person reads: an email, a group name or an application name. */
  subjectName: string | null;
  createdBy: string | null;
  updatedAt: Date;
}

export interface GrantInput {
  subjectType: SubjectType;
  subjectId: string;
  resourceType: ResourceType;
  resource: string;
  access: ResourceAccess[];
}

const CACHE_MS = 5_000;

export class ResourceGrantRepository {
  private readonly cache = new Map<string, { at: number; grants: ResourceGrant[] }>();

  constructor(private readonly db: Db) {}

  /** Creates or replaces the grant for this subject and target. An empty access list removes it. */
  async put(namespaceId: string, input: GrantInput, createdBy?: string): Promise<StoredGrant | undefined> {
    if (!SUBJECT_TYPES.includes(input.subjectType)) throw new InvalidArgumentError(`subjectType must be one of ${SUBJECT_TYPES.join(', ')}`);
    if (!RESOURCE_TYPES.includes(input.resourceType)) throw new InvalidArgumentError(`resourceType must be one of ${RESOURCE_TYPES.join(', ')}`);
    if (!isValidGrantTarget(input.resource)) {
      throw new InvalidArgumentError('a target is a name, a prefix ending in *, tag:key:value, tag:key:* or *');
    }
    const access = [...new Set(input.access)];
    const unknown = access.find((a) => !RESOURCE_ACCESS.includes(a));
    if (unknown) throw new InvalidArgumentError(`"${unknown}" is not an access; use ${RESOURCE_ACCESS.join(', ')}`);
    await this.assertSubject(namespaceId, input.subjectType, input.subjectId);

    this.cache.clear();
    if (access.length === 0) {
      await this.db
        .deleteFrom('ResourceGrants')
        .where('namespaceId', '=', namespaceId)
        .where('subjectType', '=', input.subjectType)
        .where('subjectId', '=', input.subjectId)
        .where('resourceType', '=', input.resourceType)
        .where('resource', '=', input.resource)
        .execute();
      return undefined;
    }

    const row = await this.db
      .insertInto('ResourceGrants')
      .values({ namespaceId, ...input, access, createdBy: createdBy ?? null })
      .onConflict((oc) =>
        oc
          .columns(['namespaceId', 'subjectType', 'subjectId', 'resourceType', 'resource'])
          .doUpdateSet({ access, updatedAt: sql<Date>`now()` })
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await this.list(namespaceId, {})).find((grant) => grant.id === row.id);
  }

  async delete(namespaceId: string, id: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const result = await this.db.deleteFrom('ResourceGrants').where('namespaceId', '=', namespaceId).where('id', '=', id).executeTakeFirst();
    this.cache.clear();
    return Number(result.numDeletedRows) > 0;
  }

  /** Grants in a namespace, optionally for one target or one subject, with subjects named. */
  async list(
    namespaceId: string,
    filter: { resourceType?: ResourceType; resource?: string; subjectType?: SubjectType; subjectId?: string }
  ): Promise<StoredGrant[]> {
    const rows = await this.db
      .selectFrom('ResourceGrants as g')
      .leftJoin('Users as u', (join) => join.onRef(sql.ref('u.id'), '=', sql.ref('g.subjectId')).on('g.subjectType', '=', 'USER'))
      .leftJoin('Groups as gr', (join) => join.onRef(sql.ref('gr.id'), '=', sql.ref('g.subjectId')).on('g.subjectType', '=', 'GROUP'))
      .leftJoin('ServiceAccounts as sa', (join) => join.onRef(sql.ref('sa.id'), '=', sql.ref('g.subjectId')).on('g.subjectType', '=', 'APPLICATION'))
      .leftJoin('ApiKeys as k', (join) => join.onRef(sql.ref('k.id'), '=', sql.ref('g.subjectId')).on('g.subjectType', '=', 'APPLICATION'))
      .select(['g.id', 'g.subjectType', 'g.subjectId', 'g.resourceType', 'g.resource', 'g.access', 'g.createdBy', 'g.updatedAt'])
      .select(sql<string | null>`coalesce("u"."email", "gr"."name", "sa"."name", "k"."name")`.as('subjectName'))
      .where('g.namespaceId', '=', namespaceId)
      .$if(filter.resourceType !== undefined, (q) => q.where('g.resourceType', '=', filter.resourceType as string))
      .$if(filter.resource !== undefined, (q) => q.where('g.resource', '=', filter.resource as string))
      .$if(filter.subjectType !== undefined, (q) => q.where('g.subjectType', '=', filter.subjectType as string))
      .$if(filter.subjectId !== undefined, (q) => q.where('g.subjectId', '=', filter.subjectId as string))
      .orderBy('g.resourceType')
      .orderBy('g.resource')
      .orderBy('subjectName')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      subjectType: row.subjectType as SubjectType,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      resourceType: row.resourceType as ResourceType,
      resource: row.resource,
      access: row.access as ResourceAccess[],
      createdBy: row.createdBy,
      updatedAt: row.updatedAt,
    }));
  }

  /** Every grant that applies to a principal: its own, and (for a user) its groups'. */
  async forPrincipal(principal: Principal): Promise<ResourceGrant[]> {
    const key = `${principal.namespaceId}:${principal.type}:${principal.id}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.grants;

    const subjectType: SubjectType = principal.type === PrincipalType.USER ? 'USER' : 'APPLICATION';
    const groupIds =
      principal.type === PrincipalType.USER
        ? (await this.db.selectFrom('GroupMembers').select('groupId').where('userId', '=', principal.id).execute()).map((r) => r.groupId)
        : [];
    const rows = UUID.test(principal.id)
      ? await this.db
          .selectFrom('ResourceGrants')
          .select(['resourceType', 'resource', 'access'])
          .where('namespaceId', '=', principal.namespaceId)
          .where((eb) =>
            eb.or([
              eb.and([eb('subjectType', '=', subjectType), eb('subjectId', '=', principal.id)]),
              ...(groupIds.length ? [eb.and([eb('subjectType', '=', 'GROUP'), eb('subjectId', 'in', groupIds)])] : []),
            ])
          )
          .execute()
      : [];
    const grants = rows.map((row) => ({ resourceType: row.resourceType as ResourceType, resource: row.resource, access: row.access as ResourceAccess[] }));
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, { at: Date.now(), grants });
    return grants;
  }

  private async assertSubject(namespaceId: string, type: SubjectType, id: string): Promise<void> {
    if (!UUID.test(id)) throw new InvalidArgumentError('subjectId must be an id');
    const found =
      type === 'USER'
        ? await this.db.selectFrom('Users').select('id').where('namespaceId', '=', namespaceId).where('id', '=', id).executeTakeFirst()
        : type === 'GROUP'
          ? await this.db.selectFrom('Groups').select('id').where('namespaceId', '=', namespaceId).where('id', '=', id).executeTakeFirst()
          : ((await this.db.selectFrom('ServiceAccounts').select('id').where('namespaceId', '=', namespaceId).where('id', '=', id).executeTakeFirst()) ??
            (await this.db.selectFrom('ApiKeys').select('id').where('namespaceId', '=', namespaceId).where('id', '=', id).executeTakeFirst()));
    if (!found) throw new NodeFlowError(ErrorCode.NOT_FOUND, `no ${type.toLowerCase()} ${id} in this namespace`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
