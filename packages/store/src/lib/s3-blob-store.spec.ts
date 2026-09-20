import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newBlobKey } from './blob-store.js';
import { S3BlobStore } from './s3-blob-store.js';

/**
 * The S3 payload store, against a real S3 API.
 *
 * MinIO rather than a mocked SDK: what this code can get wrong is the parts an
 * in-process fake would reproduce incorrectly anyway — streamed bodies, key
 * prefixes, paged listings and path-style addressing. A test that asserts the
 * SDK was called with certain arguments proves only that the test agrees with
 * itself.
 */

function ensureDockerHost(): void {
  if (process.env['DOCKER_HOST']) return;
  const home = homedir();
  const socket = [
    '/var/run/docker.sock',
    join(home, '.orbstack/run/docker.sock'),
    join(home, '.colima/default/docker.sock'),
    join(home, '.docker/run/docker.sock'),
    join(home, '.rd/docker.sock'),
  ].find((path) => existsSync(path));
  if (!socket) return;
  process.env['DOCKER_HOST'] = `unix://${socket}`;
  process.env['TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE'] ??= socket;
}

describe('S3 payload storage', () => {
  let container: StartedTestContainer;
  let store: S3BlobStore;
  let endpoint: string;

  const credentials = { accessKeyId: 'nodeflow', secretAccessKey: 'nodeflow-secret' };

  beforeAll(async () => {
    ensureDockerHost();
    container = await new GenericContainer('quay.io/minio/minio:latest')
      .withExposedPorts(9000)
      .withEnvironment({
        MINIO_ROOT_USER: credentials.accessKeyId,
        MINIO_ROOT_PASSWORD: credentials.secretAccessKey,
      })
      .withCommand(['server', '/data'])
      .withWaitStrategy(Wait.forLogMessage(/API:/))
      .start();

    endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;

    const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials });
    await client.send(new CreateBucketCommand({ Bucket: 'payloads' }));
    client.destroy();

    store = new S3BlobStore({ bucket: 'payloads', endpoint, forcePathStyle: true, prefix: 'install-a/', ...credentials });
  }, 240_000);

  afterAll(async () => {
    await store?.close();
    await container?.stop();
  }, 60_000);

  it('round-trips a payload under its prefix', async () => {
    const key = newBlobKey('ns-1');
    const payload = Buffer.from(JSON.stringify({ document: 'x'.repeat(100_000) }));

    await store.put(key, payload);
    expect(await store.get(key)).toEqual(payload);

    // The prefix is the store's business, not the caller's: the key handed back
    // by `newBlobKey` is what a row records, with no install prefix in it.
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials });
    const listing = await client.send(new ListObjectsV2Command({ Bucket: 'payloads' }));
    expect(listing.Contents?.map((o) => o.Key)).toContain(`install-a/${key}`);
    client.destroy();

    await store.delete(key);
    await expect(store.get(key)).rejects.toThrow();
  });

  it('lists only what is older than the cutoff, and strips the prefix again', async () => {
    const key = newBlobKey('ns-2');
    await store.put(key, Buffer.from('{}'));

    // Nothing is older than a moment ago.
    expect(await store.listOlderThan(new Date(Date.now() - 60_000))).not.toContain(key);

    const old = await store.listOlderThan(new Date(Date.now() + 60_000));
    expect(old).toContain(key);
    // A key the collector can hand straight back to `delete`.
    await store.delete(key);
    expect(await store.listOlderThan(new Date(Date.now() + 60_000))).not.toContain(key);
  });

  it('refuses a key that would escape the prefix', async () => {
    await expect(store.put('../../etc/passwd', Buffer.from('x'))).rejects.toThrow(/invalid blob key/);
    await expect(store.get('/absolute')).rejects.toThrow(/invalid blob key/);
  });
});
