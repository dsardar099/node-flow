import { sql } from 'kysely';
import type { Db } from './database.js';

export interface WorkerSighting {
  queueName: string;
  workerId: string;
  lastPollAt: Date;
}

/** How often one worker's polls of one queue are written, at most. */
const WRITE_INTERVAL_MS = 5_000;

/**
 * The latest poll from each worker on each queue.
 *
 * Written on the lease path, which is the hottest request in the system, so
 * writes are throttled in memory: a fleet long-polling in a loop would
 * otherwise turn every poll into an upsert. Seconds of staleness cost nothing
 * — the question is "is anyone listening", not "exactly when".
 */
export class WorkerPollRepository {
  private readonly lastWrite = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now
  ) {}

  async record(namespaceId: string, queueName: string, workerId: string): Promise<void> {
    const key = JSON.stringify([namespaceId, queueName, workerId]);
    const at = this.now();
    const previous = this.lastWrite.get(key);
    if (previous !== undefined && at - previous < WRITE_INTERVAL_MS) return;

    // Bounded: a namespace churning through ephemeral worker ids must not grow
    // this map without limit. Dropping entries only means an extra write.
    if (this.lastWrite.size > 10_000) this.lastWrite.clear();
    this.lastWrite.set(key, at);

    await this.db
      .insertInto('WorkerPolls')
      .values({ namespaceId, queueName, workerId })
      .onConflict((oc) =>
        oc.columns(['namespaceId', 'queueName', 'workerId']).doUpdateSet({ lastPollAt: sql<Date>`now()` })
      )
      .execute();
  }

  /** Workers seen within the window, most recent first. */
  async recent(namespaceId: string, withinSeconds = 86_400): Promise<WorkerSighting[]> {
    return this.db
      .selectFrom('WorkerPolls')
      .select(['queueName', 'workerId', 'lastPollAt'])
      .where('namespaceId', '=', namespaceId)
      .where('lastPollAt', '>', sql<Date>`now() - make_interval(secs => ${withinSeconds})`)
      .orderBy('lastPollAt', 'desc')
      .limit(1000)
      .execute();
  }
}
