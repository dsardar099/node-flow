import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@node-flow-dev/store';
import { DB } from '../database/database.module.js';

/**
 * Resolves a namespace slug to its id.
 *
 * A service rather than a guard, deliberately. It was a second global guard
 * once, and that was a mistake worth recording: two `APP_GUARD` providers
 * registered in different modules run in an order Nest decides, so the
 * namespace guard could run *before* the auth guard had established a
 * principal. It handled that by allowing the request — and a guard that opens
 * when its precondition is missing is not a guard.
 *
 * Folding the check into `AuthGuard`, immediately after the principal exists,
 * removes the ordering question entirely rather than documenting it.
 */
@Injectable()
export class NamespaceResolver {
  /**
   * Slug → id, cached for the process lifetime.
   *
   * Namespaces are few and effectively immutable, and this would otherwise be a
   * query on every request. A deleted namespace leaves a stale entry, which is
   * harmless: its credentials are cascade-deleted, so authentication fails
   * before the mapping is ever consulted.
   */
  private readonly ids = new Map<string, string>();

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Id → slug.
   *
   * The reverse direction, for telling a caller which namespace they are in.
   * A principal carries an id, and every namespaced URL is written with a slug,
   * so a dashboard cannot construct a single API path without this.
   */
  async slugFor(id: string): Promise<string | undefined> {
    for (const [slug, known] of this.ids) if (known === id) return slug;

    const row = await this.db
      .selectFrom('Namespaces')
      .select('slug')
      .where('id', '=', id)
      .executeTakeFirst();

    if (row) this.ids.set(row.slug, id);
    return row?.slug;
  }

  async idFor(slug: string): Promise<string | undefined> {
    const cached = this.ids.get(slug);
    if (cached) return cached;

    const row = await this.db
      .selectFrom('Namespaces')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (row) this.ids.set(slug, row.id);
    return row?.id;
  }
}
