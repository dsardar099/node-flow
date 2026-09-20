import type { BlobStore } from './blob-store.js';

/**
 * Object-storage payloads: S3, and anything that speaks its API.
 *
 * The filesystem store is the default and needs nothing, but it assumes every
 * replica sees the same disk. The moment node-flow runs on more than one node
 * without a shared mount, a payload written by one server is unreadable by the
 * next — and the failure appears as a task that cannot read its own input,
 * long after the write looked fine. This is the store for that deployment.
 *
 * Deliberately written against the S3 API rather than one vendor's: MinIO,
 * Cloudflare R2, Backblaze B2, Ceph and Google's XML API all speak it, so
 * `endpoint` plus `forcePathStyle` covers them without an adapter each.
 *
 * `@aws-sdk/client-s3` is an **optional peer**. An install that never sets
 * `NODE_FLOW_BLOB_STORE=s3` never loads it, which keeps the AWS SDK out of a
 * default deployment; asking for S3 without it says so by name rather than
 * failing at the first large payload.
 */

export interface S3BlobStoreOptions {
  bucket: string;
  region?: string;
  /** For S3-compatible services. Omitted for AWS itself. */
  endpoint?: string;
  /** Required by most S3-compatible services, which do not do virtual-host style. */
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** A prefix inside the bucket, so one bucket can hold several installs. */
  prefix?: string;
}

interface S3ClientLike {
  send(command: unknown): Promise<Record<string, unknown>>;
  destroy(): void;
}

interface S3Module {
  S3Client: new (config: Record<string, unknown>) => S3ClientLike;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
  ListObjectsV2Command: new (input: Record<string, unknown>) => unknown;
}

/** A literal import, so the workspace dependency check sees the optional peer. */
async function loadS3(): Promise<S3Module> {
  try {
    return (await import('@aws-sdk/client-s3')) as unknown as S3Module;
  } catch {
    throw new Error('the S3 blob store needs the "@aws-sdk/client-s3" package, which is not installed');
  }
}

export class S3BlobStore implements BlobStore {
  readonly scheme = 's3';
  private client?: S3ClientLike;
  private sdk?: S3Module;
  private readonly prefix: string;

  constructor(private readonly options: S3BlobStoreOptions) {
    // Normalised once: a prefix with or without a trailing slash must produce
    // the same keys, or payloads written before a config edit become orphans.
    const raw = (options.prefix ?? '').replace(/^\/+|\/+$/g, '');
    this.prefix = raw ? `${raw}/` : '';
  }

  async put(key: string, data: Buffer): Promise<void> {
    const { client, sdk } = await this.connect();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.options.bucket,
        Key: this.keyFor(key),
        Body: data,
        ContentType: 'application/json',
      })
    );
  }

  async get(key: string): Promise<Buffer> {
    const { client, sdk } = await this.connect();
    const result = await client.send(
      new sdk.GetObjectCommand({ Bucket: this.options.bucket, Key: this.keyFor(key) })
    );

    const body = result['Body'] as AsyncIterable<Uint8Array> | undefined;
    if (!body) throw new Error(`blob not found: ${key}`);

    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const { client, sdk } = await this.connect();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.keyFor(key) }));
  }

  /**
   * Keys written before `before`, for the payload collector.
   *
   * Paged rather than fetched at once: a bucket holding a year of payloads has
   * millions of objects, and `ListObjectsV2` returns a thousand at a time
   * whether or not the caller is ready for that.
   */
  async listOlderThan(before: Date): Promise<string[]> {
    const { client, sdk } = await this.connect();
    const keys: string[] = [];
    let token: string | undefined;

    do {
      const page = await client.send(
        new sdk.ListObjectsV2Command({
          Bucket: this.options.bucket,
          ...(this.prefix ? { Prefix: this.prefix } : {}),
          ...(token ? { ContinuationToken: token } : {}),
        })
      );

      for (const object of (page['Contents'] as { Key?: string; LastModified?: Date }[] | undefined) ?? []) {
        if (!object.Key || !object.LastModified || object.LastModified >= before) continue;
        keys.push(object.Key.slice(this.prefix.length));
      }

      // `IsTruncated` rather than the token alone: a truncated page without a
      // token is a bug worth failing on, not a reason to silently stop early.
      token = page['IsTruncated'] === true ? (page['NextContinuationToken'] as string | undefined) : undefined;
    } while (token);

    return keys;
  }

  /** Releases the SDK's sockets. Safe to call when nothing was ever loaded. */
  async close(): Promise<void> {
    this.client?.destroy();
    this.client = undefined;
  }

  private async connect(): Promise<{ client: S3ClientLike; sdk: S3Module }> {
    if (!this.sdk) this.sdk = await loadS3();
    if (!this.client) {
      const { region, endpoint, forcePathStyle, accessKeyId, secretAccessKey } = this.options;
      this.client = new this.sdk.S3Client({
        // Credentials are optional on purpose: left out, the SDK reads the
        // instance role, IRSA or the environment, which is how a deployment
        // holding no long-lived keys is supposed to work.
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
        ...(region ? { region } : { region: 'us-east-1' }),
        ...(endpoint ? { endpoint } : {}),
        ...(forcePathStyle !== undefined ? { forcePathStyle } : endpoint ? { forcePathStyle: true } : {}),
      });
    }
    return { client: this.client, sdk: this.sdk };
  }

  private keyFor(key: string): string {
    if (key.includes('..') || key.startsWith('/')) throw new Error(`invalid blob key: ${key}`);
    return `${this.prefix}${key}`;
  }
}
