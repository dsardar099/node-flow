import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TaskStatus,
  TaskType,
  WorkflowStatus,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type JsonValue,
} from '@node-flow-dev/core';
import { compileBlueprint, type Blueprint } from '@node-flow-dev/engine';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemBlobStore, InMemoryBlobStore } from './blob-store.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator, type BlueprintLoader, type TaskDefLoader } from './evaluator.js';
import { OutboxRepository } from './outbox.repository.js';
import { PayloadGarbageCollector } from './payload-gc.js';
import { PayloadStore } from './payload-store.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * Payload offload — large inputs and outputs living outside Postgres.
 *
 * The failure this file exists to catch is not "the blob is missing". It is
 * that an unresolved ref reads as *absent* rather than erroring, so a workflow
 * branches on `undefined` and completes successfully down the wrong path. Every
 * test here therefore asserts on the value the engine actually saw, not merely
 * that a ref column was written.
 */

const THRESHOLD = 1024;

let harness: PostgresHarness;
let blobs: InMemoryBlobStore;
let payloads: PayloadStore;
let workflows: WorkflowRepository;
let decideQueue: DecideQueueRepository;
let taskQueue: TaskQueueRepository;
let outbox: OutboxRepository;
let dispatch: TaskDispatchService;
let evaluator: Evaluator;
let namespaceId: string;
let blueprints: StubBlueprints;

/** Comfortably over the threshold, and identifiable when it comes back. */
const big = (marker: string): Record<string, JsonValue> => ({
  marker,
  filler: 'x'.repeat(THRESHOLD * 2),
});

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  ...extra,
});

class StubBlueprints implements BlueprintLoader {
  private readonly map = new Map<string, Blueprint>();
  register(definition: Record<string, unknown>): void {
    const parsed = workflowDefinitionSchema.parse({ name: 'wf', version: 1, ...definition });
    this.map.set(`${parsed.name}:${parsed.version}`, compileBlueprint(parsed));
  }
  async load(_ns: string, defName: string, defVersion: number): Promise<Blueprint> {
    const bp = this.map.get(`${defName}:${defVersion}`);
    if (!bp) throw new Error(`no blueprint for ${defName} v${defVersion}`);
    return bp;
  }
}

const policyLoader: TaskDefLoader = {
  load: async (_ns, names) =>
    new Map(
      names.map((name) => [
        name,
        taskDefinitionSchema.parse({ name, retryCount: 0, retryDelaySeconds: 0 }),
      ])
    ),
};

beforeAll(async () => {
  harness = await startPostgresHarness();
  blobs = new InMemoryBlobStore();
  payloads = new PayloadStore(blobs, THRESHOLD);
  workflows = new WorkflowRepository(harness.db, payloads);
  decideQueue = new DecideQueueRepository(harness.db);
  taskQueue = new TaskQueueRepository(harness.db);
  outbox = new OutboxRepository(harness.db);
  dispatch = new TaskDispatchService(harness.db, workflows, taskQueue, decideQueue);
  blueprints = new StubBlueprints();
  evaluator = new Evaluator(
    harness.db,
    workflows,
    decideQueue,
    taskQueue,
    outbox,
    blueprints,
    policyLoader,
    undefined,
    undefined,
    payloads
  );
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  blobs.clear();
  namespaceId = await seedNamespace(harness.db);
});

async function drain(workflowId: string) {
  for (let i = 0; i < 20; i++) if (!(await evaluator.evaluate(workflowId)).evaluated) break;
}

async function complete(
  workflowId: string,
  queueName: string,
  output: Record<string, JsonValue>
) {
  const [leased] = await dispatch.lease({ namespaceId, queueName, workerId: 'w' });
  if (!leased) throw new Error(`nothing queued on ${queueName}`);
  await dispatch.report({
    namespaceId,
    queueName,
    workflowId,
    taskId: leased.taskId,
    leaseToken: leased.leaseToken,
    status: TaskStatus.COMPLETED,
    output,
  });
}

describe('offload threshold', () => {
  it('keeps a small payload in the row', async () => {
    const wf = await workflows.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      input: { small: true },
    });

    const row = await harness.db
      .selectFrom('WorkflowExecutions')
      .select(['input', 'inputRef'])
      .where('id', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.inputRef).toBeNull();
    expect(row.input).toEqual({ small: true });
    expect(blobs.size).toBe(0);
  });

  it('moves a large workflow input out of the row', async () => {
    const wf = await workflows.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      input: big('wf-input'),
    });

    const row = await harness.db
      .selectFrom('WorkflowExecutions')
      .select(['input', 'inputRef'])
      .where('id', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.inputRef).toMatch(/^fs:/);
    // The row must not keep a copy, or the offload saved nothing.
    expect(row.input).toEqual({});
    expect(blobs.size).toBe(1);
  });

  it('round-trips the exact value', async () => {
    const wf = await workflows.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      input: big('round-trip'),
    });

    const loaded = await workflows.findById(wf.id);
    expect(loaded?.input.kind).toBe('ref');
    expect(await payloads.resolve(loaded?.input)).toEqual(big('round-trip'));
  });

  it('moves a large task output out of the row', async () => {
    blueprints.register({ tasks: [simple('a')] });
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await drain(wf.id);

    await complete(wf.id, 'a', big('task-output'));

    const row = await harness.db
      .selectFrom('TaskExecutions')
      .select(['output', 'outputRef'])
      .where('workflowId', '=', wf.id)
      .where('refName', '=', 'a')
      .executeTakeFirstOrThrow();

    expect(row.outputRef).toMatch(/^fs:/);
    expect(row.output).toEqual({});
  });
});

describe('resolution on the decision path', () => {
  // The core risk. An unresolved ref does not throw — the decider reads it as
  // absent, so the workflow takes the default branch and reports success.
  it('branches on a value that was offloaded', async () => {
    blueprints.register({
      tasks: [
        simple('classify'),
        {
          name: 'route',
          taskReferenceName: 'route',
          type: TaskType.SWITCH,
          expression: '${classify.output.marker}',
          decisionCases: { premium: [simple('whiteGlove')] },
          defaultCase: [simple('standard')],
        },
      ],
    });

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await drain(wf.id);

    await complete(wf.id, 'classify', big('premium'));
    await drain(wf.id);

    // Both branches leave a row — the untaken one as SKIPPED — so the status is
    // what says which way the switch actually went.
    const rows = await harness.db
      .selectFrom('TaskExecutions')
      .select(['refName', 'status'])
      .where('workflowId', '=', wf.id)
      .execute();
    const status = new Map(rows.map((t) => [t.refName, t.status]));

    expect(status.get('whiteGlove')).toBe(TaskStatus.SCHEDULED);
    expect(status.get('standard')).toBe(TaskStatus.SKIPPED);
  });

  it('passes an offloaded output into the next task input', async () => {
    blueprints.register({
      tasks: [
        simple('fetch'),
        simple('use', { inputParameters: { carried: '${fetch.output.marker}' } }),
      ],
    });

    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await drain(wf.id);

    await complete(wf.id, 'fetch', big('carried-through'));
    await drain(wf.id);

    const use = await harness.db
      .selectFrom('TaskExecutions')
      .select(['input', 'inputRef'])
      .where('workflowId', '=', wf.id)
      .where('refName', '=', 'use')
      .executeTakeFirstOrThrow();

    expect(use.input).toEqual({ carried: 'carried-through' });
  });

  it('completes a workflow whose every payload was offloaded', async () => {
    blueprints.register({ tasks: [simple('a'), simple('b')] });

    const wf = await workflows.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      input: big('wf'),
    });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await drain(wf.id);
    await complete(wf.id, 'a', big('a'));
    await drain(wf.id);
    await complete(wf.id, 'b', big('b'));
    await drain(wf.id);

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });
});

describe('ref format', () => {
  // Refs outlive the deployment that wrote them, so a cluster that later moves
  // to object storage must be able to tell which store an old ref belongs to.
  it('refuses a ref belonging to another store', async () => {
    await expect(
      payloads.resolve({ kind: 'ref', ref: 's3:bucket/key.json', sizeBytes: 1 })
    ).rejects.toThrow(/configured for "fs"/);
  });

  it('rejects a key that would escape the blob root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'node-flow-blobs-'));
    try {
      const store = new FilesystemBlobStore(directory);
      await expect(store.get('../../etc/passwd')).rejects.toThrow(/invalid blob key/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('survives a real filesystem round trip', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'node-flow-blobs-'));
    try {
      const store = new PayloadStore(new FilesystemBlobStore(directory), THRESHOLD);
      const result = await store.externalise(namespaceId, big('on-disk'));

      expect(result.ref).toMatch(/^fs:/);
      expect(
        await store.resolve({ kind: 'ref', ref: result.ref as string, sizeBytes: 0 })
      ).toEqual(big('on-disk'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('garbage collection', () => {
  /**
   * Disables the grace period.
   *
   * A blob written microseconds ago is not "older than now" at millisecond
   * resolution, so a zero grace would skip these blobs entirely and every test
   * below would pass without collecting anything. A negative grace pushes the
   * cutoff into the future, which is what makes the reference check — the thing
   * actually under test — run at all.
   */
  const NO_GRACE = -1;

  it('keeps a blob a row still points at', async () => {
    await workflows.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      input: big('referenced'),
    });

    const gc = new PayloadGarbageCollector(harness.db, blobs);
    // The blob must be spared on the strength of the reference alone, not
    // because it was too young to consider.
    expect(await gc.collect(NO_GRACE)).toBe(0);
    expect(blobs.size).toBe(1);
  });

  // A blob written by a transaction that then rolled back looks exactly like a
  // live one until the transaction resolves — which is what the grace is for.
  it('collects a blob no row points at', async () => {
    await payloads.externalise(namespaceId, big('orphan'));
    expect(blobs.size).toBe(1);

    const gc = new PayloadGarbageCollector(harness.db, blobs);
    expect(await gc.collect(NO_GRACE)).toBe(1);
    expect(blobs.size).toBe(0);
  });

  it('leaves recent blobs alone regardless of references', async () => {
    await payloads.externalise(namespaceId, big('too-young'));

    const gc = new PayloadGarbageCollector(harness.db, blobs);
    expect(await gc.collect(3600)).toBe(0);
    expect(blobs.size).toBe(1);
  });

  it('collects the superseded output of a retried task', async () => {
    blueprints.register({ tasks: [simple('a')] });
    const wf = await workflows.start({ namespaceId, defName: 'wf', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'start');
    await drain(wf.id);

    // Two outputs written to the same task row: the first blob is unreachable
    // the moment the second overwrites the ref.
    const [leased] = await dispatch.lease({ namespaceId, queueName: 'a', workerId: 'w' });
    await workflows.completeTask(
      wf.id,
      leased.taskId,
      TaskStatus.COMPLETED,
      big('first'),
      undefined,
      undefined
    );
    await workflows.completeTask(
      wf.id,
      leased.taskId,
      TaskStatus.COMPLETED,
      big('second'),
      undefined,
      undefined
    );
    expect(blobs.size).toBe(2);

    const gc = new PayloadGarbageCollector(harness.db, blobs);
    expect(await gc.collect(NO_GRACE)).toBe(1);
    expect(blobs.size).toBe(1);
  });
});

describe('without a payload store configured', () => {
  it('writes everything inline and never sets a ref', async () => {
    const plain = new WorkflowRepository(harness.db);
    const wf = await plain.start({
      namespaceId,
      defName: 'wf',
      defVersion: 1,
      input: big('inline-only'),
    });

    const row = await harness.db
      .selectFrom('WorkflowExecutions')
      .select(['input', 'inputRef'])
      .where('id', '=', wf.id)
      .executeTakeFirstOrThrow();

    expect(row.inputRef).toBeNull();
    expect(row.input).toEqual(big('inline-only'));
  });
});
