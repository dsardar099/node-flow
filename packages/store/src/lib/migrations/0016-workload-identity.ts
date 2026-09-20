import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Workload identities — proving who you are without holding a secret.
 *
 * One table for both mTLS and OIDC, because they differ only in what the
 * external identity is *called*. Both answer the same question: this request
 * arrived carrying a credential some other system vouched for — which service
 * account is that?
 *
 *  - **mTLS**: the issuer is the CA's distinguished name, the subject is the
 *    client certificate's.
 *  - **OIDC**: the issuer is the `iss` claim, the subject the `sub` — which for
 *    IRSA is a Kubernetes service account, for GCP a workload identity pool
 *    member, for SPIFFE a trust-domain URI.
 *
 * The binding is **explicit**, never inferred from a name match. A cert whose
 * CN happens to equal a service account name proving nothing is the whole
 * lesson of certificate-based auth: the CA decides who you are, and the
 * operator decides what that identity may do. Those are different decisions and
 * this row is where the second one lives.
 */

async function up(db: Kysely<Database>): Promise<void> {
  const run = (query: string) => sql.raw(query).execute(db);

  await run(`
    CREATE TABLE "WorkloadIdentities" (
      "id"               UUID PRIMARY KEY DEFAULT uuidv7(),
      "namespaceId"      UUID NOT NULL REFERENCES "Namespaces"("id") ON DELETE CASCADE,
      "serviceAccountId" UUID NOT NULL REFERENCES "ServiceAccounts"("id") ON DELETE CASCADE,

      -- 'mtls' | 'oidc'
      "kind"             TEXT NOT NULL,
      "issuer"           TEXT NOT NULL,
      "subject"          TEXT NOT NULL,

      "description"      TEXT,
      "disabledAt"       TIMESTAMPTZ,
      "lastSeenAt"       TIMESTAMPTZ,
      "createdBy"        TEXT,
      "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Globally unique, not per namespace: an identity vouched for by a CA or an
  // IdP must map to exactly one service account across the whole install, or
  // the same certificate would mean different things in different tenants.
  await run(`
    CREATE UNIQUE INDEX "WorkloadIdentities_binding_key"
      ON "WorkloadIdentities" ("kind", "issuer", "subject");
  `);

  await run(`
    CREATE INDEX "WorkloadIdentities_account_idx"
      ON "WorkloadIdentities" ("namespaceId", "serviceAccountId");
  `);
}

async function down(db: Kysely<Database>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS "WorkloadIdentities" CASCADE`).execute(db);
}

export const workloadIdentity = { name: '0016-workload-identity', up, down };
