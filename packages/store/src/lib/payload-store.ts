import { inlinePayload, type JsonValue, type Payload } from '@node-flow-dev/core';
import { newBlobKey, type BlobStore } from './blob-store.js';

/**
 * Decides what stays in Postgres and what moves to blob storage, and puts it
 * back together on the way out.
 *
 * Offloading is a **write-side** decision and resolution a **read-side** one,
 * and both have to be complete for the design to be safe. A ref the decider
 * cannot resolve does not throw — `${bigTask.output.id}` simply evaluates to
 * undefined and the workflow takes a wrong branch, silently. So the evaluator
 * resolves every payload it hands to the decider, and the decider never sees a
 * `ref` payload at all.
 */

/**
 * 256 KB. Below this the row wins: one round trip, no second store to be
 * consistent with, and the value is available to `jsonb` operators for search.
 * Above it, TOAST compression and out-of-line storage are already happening —
 * we are just choosing somewhere better than the WAL to put it.
 */
export const DEFAULT_OFFLOAD_THRESHOLD_BYTES = 256 * 1024;

export interface OffloadResult {
  /** The value to store in the row, or undefined when it was offloaded. */
  inline?: Record<string, JsonValue>;
  /** The ref to store in the row, or undefined when it stayed inline. */
  ref?: string;
  sizeBytes: number;
}

export class PayloadStore {
  constructor(
    private readonly blobs: BlobStore,
    private readonly thresholdBytes: number = DEFAULT_OFFLOAD_THRESHOLD_BYTES
  ) {}

  /**
   * Whether this payload would be offloaded.
   *
   * Exposed so a caller can skip work that only offloading needs — looking up a
   * namespace, for instance — without paying for it on every small payload.
   */
  exceedsThreshold(value: Record<string, JsonValue> | undefined): boolean {
    if (value === undefined) return false;
    return Buffer.byteLength(JSON.stringify(value), 'utf8') > this.thresholdBytes;
  }

  /**
   * Writes the payload to blob storage if it is over the threshold.
   *
   * **Ordering matters and is not symmetric.** The blob is written before the
   * transaction that references it commits. A rollback therefore leaves an
   * unreferenced blob — garbage, collected later by {@link PayloadGarbageCollector}.
   * The other order would commit a row pointing at a blob that does not exist,
   * which is unrecoverable data loss. Leaking storage is the right failure.
   */
  async externalise(
    namespaceId: string,
    value: Record<string, JsonValue> | undefined
  ): Promise<OffloadResult> {
    if (value === undefined) return { sizeBytes: 0 };

    const encoded = Buffer.from(JSON.stringify(value), 'utf8');
    if (encoded.byteLength <= this.thresholdBytes) {
      return { inline: value, sizeBytes: encoded.byteLength };
    }

    const key = newBlobKey(namespaceId);
    await this.blobs.put(key, encoded);

    return { ref: `${this.blobs.scheme}:${key}`, sizeBytes: encoded.byteLength };
  }

  /** Fetches an offloaded payload, or returns an inline one unchanged. */
  async resolve(payload: Payload | undefined): Promise<Record<string, JsonValue> | undefined> {
    if (!payload) return undefined;
    if (payload.kind === 'inline') return payload.value;

    const data = await this.blobs.get(this.keyOf(payload.ref));
    return JSON.parse(data.toString('utf8')) as Record<string, JsonValue>;
  }

  /** Resolves a payload in place, so downstream code only ever sees `inline`. */
  async inline(payload: Payload | undefined): Promise<Payload | undefined> {
    if (!payload || payload.kind === 'inline') return payload;
    return inlinePayload(await this.resolve(payload));
  }

  async delete(ref: string): Promise<void> {
    await this.blobs.delete(this.keyOf(ref));
  }

  /**
   * Strips the scheme from a ref.
   *
   * Refs carry it because they outlive the deployment that wrote them: a
   * cluster that starts on the filesystem and later moves to S3 still has years
   * of `fs:` refs in its history, and a bare key would give no way to tell which
   * store to ask. Failing loudly on an unknown scheme beats reading the wrong
   * store and reporting "not found".
   */
  private keyOf(ref: string): string {
    const separator = ref.indexOf(':');
    if (separator === -1) return ref; // Pre-scheme ref; assume the current store.

    const scheme = ref.slice(0, separator);
    if (scheme !== this.blobs.scheme) {
      throw new Error(
        `payload ${ref} is in "${scheme}" storage but this node is configured for "${this.blobs.scheme}"`
      );
    }
    return ref.slice(separator + 1);
  }
}
