import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import type { Db } from './database.js';
import { isUniqueViolation } from './pg-errors.js';

/**
 * Namespaces — the tenants.
 *
 * Until now these existed only in `nf bootstrap` and in SQL, which was fine
 * while an install had one and awkward the moment it had two: adding a tenant
 * meant shell access to the database, and that is not a thing a platform team
 * can delegate or automate.
 *
 * Deliberately small. Creating and listing are here; **deleting is not**. A
 * namespace cascade-deletes every definition, execution, secret and credential
 * under it, and an API that can do that by slug is one fat-fingered `curl` from
 * an unrecoverable outage. Removing a tenant stays a deliberate operation at a
 * terminal, where the person doing it has already had to think about backups.
 */

/**
 * The slug rules, in one place.
 *
 * A slug appears in every namespaced URL, so it has to survive a path segment
 * without encoding; it is compared exactly, so case is fixed rather than
 * folded. `default` is reserved only in the sense that bootstrap creates it —
 * nothing here treats it specially.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export interface Namespace {
  id: string;
  slug: string;
  settings: Record<string, JsonValue>;
  createdAt: Date;
}

export class NamespaceRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Namespace[]> {
    const rows = await this.db.selectFrom('Namespaces').selectAll().orderBy('slug').execute();
    return rows.map(toNamespace);
  }

  async get(slug: string): Promise<Namespace | undefined> {
    const row = await this.db.selectFrom('Namespaces').selectAll().where('slug', '=', slug).executeTakeFirst();
    return row ? toNamespace(row) : undefined;
  }

  /**
   * Creates a namespace, or says plainly that it exists.
   *
   * Not idempotent, unlike `nf bootstrap`. Bootstrap is run by a person who may
   * have lost their key and needs a way back in; this is an API call, and
   * silently returning the existing tenant would let a caller believe they had
   * created something they had not — then write into a stranger's namespace.
   */
  async create(slug: string, settings: Record<string, JsonValue> = {}): Promise<Namespace> {
    if (!SLUG.test(slug)) {
      throw new InvalidArgumentError(
        'a namespace slug is 3–64 characters of lowercase letters, digits and hyphens, starting and ending with a letter or digit'
      );
    }

    // `CONFLICT`, not a malformed argument: the slug above it *is* well formed,
    // and a tenant-provisioning script that reruns needs to tell "this name is
    // taken" apart from "this name is unusable". Same reasoning as a duplicate
    // workflow version.
    const existing = await this.get(slug);
    if (existing) throw slugTaken(slug);

    try {
      const row = await this.db
        .insertInto('Namespaces')
        .values({ slug, settings: JSON.stringify(settings) })
        .returningAll()
        .executeTakeFirstOrThrow();

      return toNamespace(row);
    } catch (error) {
      // Two provisioning runs racing both pass the check above; the unique
      // index on `slug` is what actually decides, and the loser must get the
      // same answer rather than a 500.
      if (isUniqueViolation(error)) throw slugTaken(slug);
      throw error;
    }
  }
}

/** The one error for a slug already taken, shared by both guards so they cannot drift. */
function slugTaken(slug: string): NodeFlowError {
  return new NodeFlowError(ErrorCode.CONFLICT, `namespace "${slug}" already exists`, { slug });
}

function toNamespace(row: Record<string, unknown>): Namespace {
  return {
    id: row['id'] as string,
    slug: row['slug'] as string,
    settings: (row['settings'] as Record<string, JsonValue>) ?? {},
    createdAt: row['createdAt'] as Date,
  };
}
