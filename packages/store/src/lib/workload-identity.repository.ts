import {
  ErrorCode,
  NodeFlowError,
  PrincipalType,
  type Principal,
} from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import { isUniqueViolation } from './pg-errors.js';

/**
 * Bindings from an externally-vouched identity to a service account.
 *
 * The binding is **explicit**. A certificate whose CN happens to match a
 * service account name proves nothing — the CA decides who you are, the
 * operator decides what that identity may do, and conflating the two is how a
 * certificate issued for one purpose ends up authorised for another.
 */

export type WorkloadKind = 'mtls' | 'oidc';

export interface WorkloadBinding {
  id: string;
  namespaceId: string;
  serviceAccountId: string;
  kind: WorkloadKind;
  issuer: string;
  subject: string;
  description: string | null;
  disabledAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export class WorkloadIdentityRepository {
  constructor(private readonly db: Db) {}

  async bind(input: {
    namespaceId: string;
    serviceAccountName: string;
    kind: WorkloadKind;
    issuer: string;
    subject: string;
    description?: string;
    by?: string;
  }): Promise<WorkloadBinding> {
    const account = await this.db
      .selectFrom('ServiceAccounts')
      .select('id')
      .where('namespaceId', '=', input.namespaceId)
      .where('name', '=', input.serviceAccountName)
      .executeTakeFirst();

    if (!account) {
      throw new NodeFlowError(
        ErrorCode.NOT_FOUND,
        `no service account "${input.serviceAccountName}" in this namespace`
      );
    }

    const row = await this.db
      .insertInto('WorkloadIdentities')
      .values({
        namespaceId: input.namespaceId,
        serviceAccountId: account.id,
        kind: input.kind,
        issuer: input.issuer,
        subject: input.subject,
        description: input.description ?? null,
        createdBy: input.by ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          // Globally unique: the same certificate or token meaning different
          // things in different tenants is the failure this prevents.
          throw new NodeFlowError(
            ErrorCode.CONFLICT,
            `${input.kind} identity ${input.subject} is already bound`
          );
        }
        throw error;
      });

    return row as WorkloadBinding;
  }

  async list(namespaceId: string): Promise<WorkloadBinding[]> {
    const rows = await this.db
      .selectFrom('WorkloadIdentities')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .orderBy('createdAt', 'desc')
      .execute();

    return rows as WorkloadBinding[];
  }

  async unbind(namespaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .deleteFrom('WorkloadIdentities')
      .where('namespaceId', '=', namespaceId)
      .where('id', '=', id)
      .returning('id')
      .execute();

    return rows.length > 0;
  }

  /**
   * Resolves a vouched identity to a principal.
   *
   * The service account's own state is checked in the same query: a disabled
   * account must not be reachable through a binding that nobody remembered to
   * remove, which is precisely the credential that outlives its owner.
   */
  async resolve(
    kind: WorkloadKind,
    issuer: string,
    subject: string
  ): Promise<Principal | undefined> {
    const row = await this.db
      .selectFrom('WorkloadIdentities')
      .innerJoin('ServiceAccounts', 'ServiceAccounts.id', 'WorkloadIdentities.serviceAccountId')
      .select([
        'WorkloadIdentities.id as bindingId',
        'ServiceAccounts.id as accountId',
        'ServiceAccounts.name as name',
        'ServiceAccounts.namespaceId as namespaceId',
        'ServiceAccounts.scopes as scopes',
      ])
      .where('WorkloadIdentities.kind', '=', kind)
      .where('WorkloadIdentities.issuer', '=', issuer)
      .where('WorkloadIdentities.subject', '=', subject)
      .where('WorkloadIdentities.disabledAt', 'is', null)
      .where('ServiceAccounts.disabledAt', 'is', null)
      .executeTakeFirst();

    if (!row) return undefined;

    // Fire-and-forget: "is this binding still used?" is the question asked
    // before removing one, and making authentication wait on a bookkeeping
    // write would put a row lock on the hot path for it.
    void this.touch(row.bindingId);

    return {
      type: PrincipalType.SERVICE_ACCOUNT,
      id: row.accountId,
      name: row.name,
      namespaceId: row.namespaceId,
      scopes: row.scopes,
    };
  }

  private async touch(id: string): Promise<void> {
    await this.db
      .updateTable('WorkloadIdentities')
      .set({ lastSeenAt: sql<Date>`now()` })
      .where('id', '=', id)
      .execute()
      .catch(() => undefined);
  }
}

