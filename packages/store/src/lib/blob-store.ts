import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Storage for payloads too large to keep in a row.
 *
 * A workflow that passes a 40 MB document between six tasks writes that
 * document into `TaskExecutions` six times, and every evaluation that touches
 * those rows drags it through the WAL, the buffer cache and the network. Since
 * the decider usually only reads a couple of fields out of a payload — often
 * none at all — the bulk is pure overhead on the hot path.
 *
 * So payloads over a threshold move out of Postgres and the row keeps a
 * reference. The database stays a control plane; bulk data lives where bulk
 * data belongs.
 */

export interface BlobStore {
  /** The scheme this store owns, e.g. `fs`. Refs are `<scheme>:<key>`. */
  readonly scheme: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Keys written before `before`. Used to find orphans; order is unspecified. */
  listOlderThan(before: Date): Promise<string[]>;
}

/** A key that sorts by namespace then time, so listings stay browsable. */
export function newBlobKey(namespaceId: string): string {
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `${namespaceId}/${day}/${randomUUID()}.json`;
}

/**
 * Filesystem-backed blob storage — the default, and the reason node-flow needs
 * no object store to run.
 *
 * Suitable for a single node or any deployment with a shared mount. Multi-node
 * without a shared filesystem needs S3/GCS/Azure, which arrive in Phase 8 as
 * additional `BlobStore` implementations behind this same interface.
 */
export class FilesystemBlobStore implements BlobStore {
  readonly scheme = 'fs';

  constructor(private readonly root: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });

    // Write to a temporary name and rename into place. `rename` is atomic
    // within a filesystem, so a reader can never observe a half-written
    // payload — which matters because the row referencing it may become visible
    // the instant the transaction commits.
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, path);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async listOlderThan(before: Date): Promise<string[]> {
    const keys: string[] = [];
    await this.walk(this.root, '', before, keys);
    return keys;
  }

  private async walk(
    directory: string,
    prefix: string,
    before: Date,
    into: string[]
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return; // Nothing written yet.
    }

    for (const entry of entries) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.walk(join(directory, entry.name), key, before, into);
        continue;
      }
      if (entry.name.endsWith('.tmp')) continue;
      const info = await stat(join(directory, entry.name));
      if (info.mtime < before) into.push(key);
    }
  }

  private pathFor(key: string): string {
    // Keys are generated, never user-supplied, but a traversal here would read
    // and delete arbitrary files — cheap to make impossible rather than rely on
    // every future caller staying disciplined.
    if (key.includes('..') || key.startsWith('/')) {
      throw new Error(`invalid blob key: ${key}`);
    }
    return join(this.root, key);
  }
}

/** In-memory store for tests. Never use it for anything that must survive. */
export class InMemoryBlobStore implements BlobStore {
  readonly scheme = 'fs';
  private readonly blobs = new Map<string, { data: Buffer; at: Date }>();

  async put(key: string, data: Buffer): Promise<void> {
    this.blobs.set(key, { data, at: new Date() });
  }

  async get(key: string): Promise<Buffer> {
    const blob = this.blobs.get(key);
    if (!blob) throw new Error(`blob not found: ${key}`);
    return blob.data;
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  async listOlderThan(before: Date): Promise<string[]> {
    return [...this.blobs].filter(([, b]) => b.at < before).map(([key]) => key);
  }

  get size(): number {
    return this.blobs.size;
  }

  clear(): void {
    this.blobs.clear();
  }
}
