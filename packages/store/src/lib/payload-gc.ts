import { sql } from 'kysely';
import type { BlobStore } from './blob-store.js';
import type { Db } from './database.js';

/**
 * Deletes blobs no row references.
 *
 * Two things produce them, and both are consequences of writing the blob before
 * the transaction that references it commits — the ordering
 * {@link PayloadStore.externalise} explains and deliberately chose:
 *
 *  1. **Rolled-back transactions.** The blob was written, the row never was.
 *  2. **Superseded rows.** A retried task writes a fresh output; the previous
 *     attempt's blob is no longer reachable from anywhere.
 *
 * Neither is a correctness problem — the database is always right and the blob
 * is merely wasted space — but unbounded waste on a payload store sized for
 * 40 MB documents becomes an operational problem quickly.
 */
export class PayloadGarbageCollector {
  constructor(
    private readonly db: Db,
    private readonly blobs: BlobStore
  ) {}

  /**
   * Collects one batch.
   *
   * `graceSeconds` must comfortably exceed the longest transaction the system
   * can run. A blob written by a transaction that has not yet committed looks
   * exactly like an orphan, and deleting it would strand a row that is about to
   * become visible — turning a storage leak into data loss. A day of grace
   * costs nothing and removes the whole class of race.
   */
  async collect(graceSeconds = 86_400, limit = 1000): Promise<number> {
    const before = new Date(Date.now() - graceSeconds * 1000);
    const candidates = (await this.blobs.listOlderThan(before)).slice(0, limit);

    let collected = 0;
    for (const key of candidates) {
      const ref = `${this.blobs.scheme}:${key}`;
      if (await this.isReferenced(ref)) continue;
      await this.blobs.delete(key);
      collected++;
    }

    return collected;
  }

  /**
   * Whether any execution row still points at this ref.
   *
   * Four partial indexes make each of these a point lookup rather than a scan
   * of two partitioned tables; they cover only offloaded rows, so they cost
   * almost nothing when offloading is rare.
   */
  private async isReferenced(ref: string): Promise<boolean> {
    const found = await sql<{ found: number }>`
      SELECT 1 AS found WHERE EXISTS (
        SELECT 1 FROM "WorkflowExecutions" WHERE "inputRef"  = ${ref}
        UNION ALL
        SELECT 1 FROM "WorkflowExecutions" WHERE "outputRef" = ${ref}
        UNION ALL
        SELECT 1 FROM "TaskExecutions"     WHERE "inputRef"  = ${ref}
        UNION ALL
        SELECT 1 FROM "TaskExecutions"     WHERE "outputRef" = ${ref}
      )
    `.execute(this.db);

    return found.rows.length > 0;
  }
}
