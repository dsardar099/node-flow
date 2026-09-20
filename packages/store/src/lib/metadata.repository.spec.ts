import { ErrorCode, InvalidDefinitionError, TaskStatus, TaskType, WorkflowStatus } from '@node-flow-dev/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { Evaluator } from './evaluator.js';
import { MetadataRepository, checkDefinition } from './metadata.repository.js';
import { json } from './schema.js';
import { OutboxRepository } from './outbox.repository.js';
import { TaskQueueRepository } from './task-queue.repository.js';
import {
  seedNamespace,
  startPostgresHarness,
  truncateAll,
  type PostgresHarness,
} from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/** A reader that may reach everything, for tests that are not about tags. */
const ANY_TAGS = { tagGrants: ['admin'] };

/**
 * The metadata repository — definition CRUD, versioning and the blueprint cache.
 *
 * It also closes a real gap: until now `BlueprintLoader` existed only as a test
 * stub, so definitions could not be registered or loaded at all. These tests
 * drive a workflow end to end through the *real* loader.
 */

let harness: PostgresHarness;
let metadata: MetadataRepository;
let namespaceId: string;

const simple = (ref: string, extra: Record<string, unknown> = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: TaskType.SIMPLE,
  ...extra,
});

beforeAll(async () => {
  harness = await startPostgresHarness();
  metadata = new MetadataRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  metadata.clearCaches();
  namespaceId = await seedNamespace(harness.db);
});

describe('registering workflow definitions', () => {
  it('validates, compiles and stores a definition', async () => {
    const { definition, blueprint } = await metadata.registerWorkflow({
      namespaceId,
      definition: { name: 'order', version: 1, tasks: [simple('a'), simple('b')] },
      createdBy: 'tester',
    });

    expect(definition.name).toBe('order');
    expect(blueprint.entryRef).toBe('a');
    expect(blueprint.size).toBe(2);

    const stored = await metadata.getWorkflowDefinition(namespaceId, 'order', ANY_TAGS, 1);
    expect(stored?.tasks).toHaveLength(2);
  });

  // Compiling at registration is what turns a class of 3am failures into a
  // rejected request: a bad reference is caught before anything can run.
  it('rejects a definition referencing a task that does not exist', async () => {
    await expect(
      metadata.registerWorkflow({
        namespaceId,
        definition: {
          name: 'broken',
          version: 1,
          tasks: [simple('a', { inputParameters: { v: '${ghost.output.x}' } })],
        },
      })
    ).rejects.toThrow(/references "ghost"/);
  });

  it('rejects a structurally invalid definition', async () => {
    await expect(
      metadata.registerWorkflow({ namespaceId, definition: { name: 'nope', tasks: [] } })
    ).rejects.toThrow(InvalidDefinitionError);
  });

  /**
   * The message has to name what is wrong, not merely that something is.
   *
   * The offending paths were attached as structured detail and left out of the
   * message, which is fine for a client that reads the whole error body and
   * useless for every one that does not — Conductor's own SDKs read `message`
   * and nothing else. Registering sixty workflows then failed with a sentence
   * that named neither the workflow nor the field.
   */
  it('names the offending path in the message, not only in the detail', async () => {
    const register = metadata.registerWorkflow({
      namespaceId,
      definition: {
        name: 'probe',
        version: 1,
        tasks: [{ name: 'a', taskReferenceName: 'a', type: 'SIMPLE', inputParameters: ['wrong'] }],
      },
    });

    await expect(register).rejects.toThrow(InvalidDefinitionError);
    await expect(register).rejects.toThrow(/tasks\.0\.inputParameters/);
  });

  // Versions are immutable, and the blueprint cache depends on that: a cached
  // entry can never go stale because the thing it describes cannot change.
  it('refuses to overwrite an existing version', async () => {
    const def = { name: 'order', version: 1, tasks: [simple('a')] };
    await metadata.registerWorkflow({ namespaceId, definition: def });

    // `CONFLICT`, not `INVALID_DEFINITION`. The definition is valid — it is the
    // state that disagrees — and the two codes tell a caller opposite things
    // about whether changing the request would help.
    await expect(
      metadata.registerWorkflow({ namespaceId, definition: def })
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT, message: /already exists/ });
  });

  // Concurrent registrations of one version must produce exactly one winner,
  // and every loser must get the same answer as a caller that simply arrived
  // second.
  it('admits one of eight concurrent registrations and refuses the rest alike', async () => {
    const def = { name: 'racy', version: 1, tasks: [simple('a')] };

    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => metadata.registerWorkflow({ namespaceId, definition: def }))
    );

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

    const reasons = outcomes
      .filter((o): o is PromiseRejectedResult => o.status === 'rejected')
      .map((o) => o.reason);
    expect(reasons).toHaveLength(7);
    for (const reason of reasons) {
      expect(reason).toMatchObject({ code: ErrorCode.CONFLICT, message: /already exists/ });
    }
  });

  /**
   * The insert's own guard, reached deterministically.
   *
   * The pre-check is a courtesy: two callers can both pass it before either
   * inserts, and then the primary key is what actually holds. In practice the
   * pre-check absorbs every loser — even eight at once, as the test above shows
   * — so the only honest way to exercise the path underneath it is to stand in
   * for the row a competing transaction committed in that window. Left
   * untranslated, that caller gets a 500 saying the server is broken when the
   * truth is that somebody else got there first.
   */
  it('translates a primary key violation into the same conflict', async () => {
    const realTransaction = harness.db.transaction.bind(harness.db);
    (harness.db as unknown as { transaction: unknown }).transaction = () => ({
      execute: async () => {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "WorkflowDefinitions_pkey"'),
          { code: '23505' }
        );
      },
    });

    try {
      await expect(
        metadata.registerWorkflow({
          namespaceId,
          definition: { name: 'lost_the_race', version: 1, tasks: [simple('a')] },
        })
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT, message: /already exists/ });
    } finally {
      (harness.db as unknown as { transaction: unknown }).transaction = realTransaction;
    }
  });

  it('allows a new version alongside the old one', async () => {
    await metadata.registerWorkflow({
      namespaceId,
      definition: { name: 'order', version: 1, tasks: [simple('a')] },
    });
    await metadata.registerWorkflow({
      namespaceId,
      definition: { name: 'order', version: 2, tasks: [simple('a'), simple('b')] },
    });

    expect(await metadata.latestVersion(namespaceId, 'order')).toBe(2);
    expect((await metadata.getWorkflowDefinition(namespaceId, 'order', ANY_TAGS, 1))?.tasks).toHaveLength(1);
    expect((await metadata.getWorkflowDefinition(namespaceId, 'order', ANY_TAGS))?.tasks).toHaveLength(2);
  });

  it('keeps namespaces isolated', async () => {
    const other = await seedNamespace(harness.db, 'other');
    await metadata.registerWorkflow({
      namespaceId,
      definition: { name: 'order', version: 1, tasks: [simple('a')] },
    });

    expect(await metadata.getWorkflowDefinition(other, 'order', ANY_TAGS, 1)).toBeUndefined();
    expect(await metadata.listWorkflows(other, ANY_TAGS)).toEqual([]);
  });
});

describe('blueprint loading', () => {
  it('loads and compiles a stored definition', async () => {
    await metadata.registerWorkflow({
      namespaceId,
      definition: { name: 'order', version: 1, tasks: [simple('a'), simple('b')] },
    });
    metadata.clearCaches();

    const blueprint = await metadata.load(namespaceId, 'order', 1);
    expect(blueprint.entryRef).toBe('a');
    expect(blueprint.nodes.get('a')?.next).toEqual(['b']);
  });

  // A blueprint holds Maps and resolved edges that do not survive a JSON round
  // trip, so it is recompiled rather than rehydrated. The cache makes that
  // once-per-version-per-process.
  it('returns a usable Map-backed blueprint, not flattened JSON', async () => {
    await metadata.registerWorkflow({
      namespaceId,
      definition: { name: 'order', version: 1, tasks: [simple('a')] },
    });
    metadata.clearCaches();

    const blueprint = await metadata.load(namespaceId, 'order', 1);
    expect(blueprint.nodes).toBeInstanceOf(Map);
    expect(blueprint.nodes.get('a')?.ref).toBe('a');
  });

  it('serves repeat loads from cache', async () => {
    await metadata.registerWorkflow({
      namespaceId,
      definition: { name: 'order', version: 1, tasks: [simple('a')] },
    });

    const first = await metadata.load(namespaceId, 'order', 1);
    const second = await metadata.load(namespaceId, 'order', 1);
    expect(second).toBe(first);
  });

  it('reports a clear error for an unregistered version', async () => {
    await expect(metadata.load(namespaceId, 'ghost', 7)).rejects.toThrow(/no workflow definition/);
  });
});

describe('task definitions', () => {
  it('stores and reloads a policy', async () => {
    await metadata.upsertTaskDefinition(namespaceId, {
      name: 'charge',
      retryCount: 5,
      retryDelaySeconds: 2,
      concurrentExecLimit: 10,
    });

    const loaded = await metadata.loadTaskDefs(namespaceId, ['charge']);
    expect(loaded.get('charge')).toMatchObject({
      retryCount: 5,
      retryDelaySeconds: 2,
      concurrentExecLimit: 10,
    });
  });

  it('applies schema defaults for unspecified policy', async () => {
    await metadata.upsertTaskDefinition(namespaceId, { name: 'plain' });
    const loaded = await metadata.loadTaskDefs(namespaceId, ['plain']);

    expect(loaded.get('plain')).toMatchObject({
      retryLogic: 'EXPONENTIAL_BACKOFF',
      maxRetryDelaySeconds: 3600,
    });
    expect(loaded.get('plain')?.jitter).toBeGreaterThan(0);
  });

  it('updates an existing definition and invalidates its cache', async () => {
    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge', retryCount: 1 });
    expect((await metadata.loadTaskDefs(namespaceId, ['charge'])).get('charge')?.retryCount).toBe(1);

    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge', retryCount: 9 });
    expect((await metadata.loadTaskDefs(namespaceId, ['charge'])).get('charge')?.retryCount).toBe(9);
  });

  // Dispatching work before registering its policy must not break evaluation —
  // running under defaults is far better than an evaluation that throws.
  it('omits names with no stored definition rather than failing', async () => {
    const loaded = await metadata.loadTaskDefs(namespaceId, ['never-registered']);
    expect(loaded.size).toBe(0);
  });

  it('fetches one definition by name', async () => {
    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge', retryCount: 4 });
    expect(await metadata.getTaskDefinition(namespaceId, 'charge')).toMatchObject({ name: 'charge', retryCount: 4 });
    expect(await metadata.getTaskDefinition(namespaceId, 'missing')).toBeUndefined();
  });

  it('deletes a definition and forgets its cached policy', async () => {
    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge', retryCount: 4 });
    await metadata.loadTaskDefs(namespaceId, ['charge']);

    expect(await metadata.deleteTaskDefinition(namespaceId, 'charge')).toBe('deleted');
    expect((await metadata.loadTaskDefs(namespaceId, ['charge'])).size).toBe(0);
    expect(await metadata.deleteTaskDefinition(namespaceId, 'charge')).toBe('not_found');
  });

  // Deleting the policy under live work would silently change its retries and
  // timeouts mid-flight. A domain-routed task queues as `name:domain`.
  it.each([['charge'], ['charge:eu']])('refuses while a task is queued on %s', async (queueName) => {
    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge' });
    await new TaskQueueRepository(harness.db).enqueue({
      namespaceId,
      queueName,
      taskId: '01a0ab11-0000-7000-8000-000000000001',
      workflowId: '01a0ab11-0000-7000-8000-000000000002',
    });

    expect(await metadata.deleteTaskDefinition(namespaceId, 'charge')).toBe('in_use');
    expect(await metadata.getTaskDefinition(namespaceId, 'charge')).toBeDefined();
  });

  it('is not blocked by a different task whose name merely shares a prefix', async () => {
    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge' });
    await new TaskQueueRepository(harness.db).enqueue({
      namespaceId,
      queueName: 'charge_refund',
      taskId: '01a0ab11-0000-7000-8000-000000000003',
      workflowId: '01a0ab11-0000-7000-8000-000000000004',
    });

    expect(await metadata.deleteTaskDefinition(namespaceId, 'charge')).toBe('deleted');
  });
});

describe('driving a real workflow through the real loader', () => {
  // Every other suite uses a StubBlueprints. This one registers a definition
  // and runs it, so the production path is exercised end to end.
  it('registers a definition and runs it to completion', async () => {
    const workflows = new WorkflowRepository(harness.db);
    const decideQueue = new DecideQueueRepository(harness.db);
    const taskQueue = new TaskQueueRepository(harness.db);
    const outbox = new OutboxRepository(harness.db);

    const evaluator = new Evaluator(harness.db,
      workflows,
      decideQueue,
      taskQueue,
      outbox,
      metadata,
      metadata.taskDefLoader
    );

    await metadata.upsertTaskDefinition(namespaceId, { name: 'charge', retryCount: 3 });
    await metadata.registerWorkflow({
      namespaceId,
      definition: {
        name: 'order',
        version: 1,
        tasks: [simple('charge'), simple('ship', { inputParameters: { txn: '${charge.output.txnId}' } })],
      },
    });

    const wf = await workflows.start({ namespaceId, defName: 'order', defVersion: 1 });
    await decideQueue.enqueue(namespaceId, wf.id, 'started');

    const drain = async () => {
      for (let i = 0; i < 20; i++) {
        if (!(await evaluator.evaluate(wf.id)).evaluated) break;
      }
    };

    await drain();

    const [charge] = await taskQueue.lease('charge', 'w', 60, 1, namespaceId);
    expect(charge).toBeDefined();
    await workflows.completeTask(wf.id, charge.taskId, TaskStatus.COMPLETED, { txnId: 'tx-1' }, undefined, undefined);
    await taskQueue.acknowledge('charge', charge.taskId, charge.leaseToken);
    await decideQueue.enqueue(namespaceId, wf.id, 'charge done');
    await drain();

    const [ship] = await taskQueue.lease('ship', 'w', 60, 1, namespaceId);
    expect(ship).toBeDefined();
    await workflows.completeTask(wf.id, ship.taskId, TaskStatus.COMPLETED, {}, undefined, undefined);
    await taskQueue.acknowledge('ship', ship.taskId, ship.leaseToken);
    await decideQueue.enqueue(namespaceId, wf.id, 'ship done');
    await drain();

    expect((await workflows.findById(wf.id))?.status).toBe(WorkflowStatus.COMPLETED);
  });
});

describe('SWITCH expressions that would always take the default case', () => {
  const switchDefinition = (name: string, route: Record<string, unknown>) => ({
    name,
    version: 1,
    tasks: [
      {
        name: 'route',
        taskReferenceName: 'route',
        type: TaskType.SWITCH,
        decisionCases: { gold: [simple('priority')] },
        defaultCase: [simple('standard')],
        ...route,
      },
    ],
  });

  it('refuses a value-param expression naming no input parameter', async () => {
    await expect(
      metadata.registerWorkflow({
        namespaceId,
        definition: switchDefinition('orphan_param', { evaluatorType: 'value-param', expression: 'tier' }),
      })
    ).rejects.toThrow(/SWITCH "route".*not one of this task's input parameters/);
  });

  it('registers the Conductor form, where the expression names an input parameter', async () => {
    await expect(
      metadata.registerWorkflow({
        namespaceId,
        definition: switchDefinition('conductor_switch', {
          evaluatorType: 'value-param',
          expression: 'tier',
          inputParameters: { tier: '${workflow.input.tier}' },
        }),
      })
    ).resolves.toMatchObject({ definition: { name: 'conductor_switch' } });
  });
});

describe('loop conditions that would silently run once', () => {
  const loopDefinition = (name: string, loopCondition: string) => ({
    name,
    version: 1,
    tasks: [
      {
        name: 'loop',
        taskReferenceName: 'loop',
        type: TaskType.DO_WHILE,
        loopCondition,
        loopOver: [simple('body')],
      },
    ],
  });

  it('refuses one at registration, naming the loop', async () => {
    await expect(
      metadata.registerWorkflow({
        namespaceId,
        definition: loopDefinition('conductor_style', "$.loop['iteration'] < 3"),
      })
    ).rejects.toThrow(/DO_WHILE "loop".*looks like an expression/);
  });

  it('reports it from the dry run as a located issue, not an exception', () => {
    const checked = checkDefinition(loopDefinition('dry', '${loop.output.done}'));

    expect(checked.valid).toBe(false);
    if (checked.valid) return;
    expect(checked.issues[0]).toMatchObject({ taskReferenceName: 'loop' });
    expect(checked.issues[0].message).toMatch(/not a comparison/);
  });

  // Why the rule lives at registration and not in the compiler. A definition
  // stored before the rule existed is recompiled every time a process loads it;
  // had the compiler been tightened, this load would throw and every running
  // execution of the workflow would stop being evaluated.
  it('still loads a definition that was stored before the rule existed', async () => {
    await harness.db
      .insertInto('WorkflowDefinitions')
      .values({
        namespaceId,
        name: 'legacy_loop',
        version: 1,
        definition: json(loopDefinition('legacy_loop', "$.loop['iteration'] < 3")),
        blueprint: json({}),
        tags: [],
      })
      .execute();

    const blueprint = await metadata.load(namespaceId, 'legacy_loop', 1);
    expect(blueprint.nodes.get('loop')).toBeDefined();
  });
});

describe('listing and deleting workflow definitions', () => {
  const definition = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    version: 1,
    tasks: [simple('a')],
    ...extra,
  });

  it('lists description and owner from inside the stored definition', async () => {
    await metadata.registerWorkflow({
      namespaceId,
      definition: definition('described', { description: 'Charges a card', ownerEmail: 'ops@example.com' }),
      createdBy: 'ada',
    });

    const [row] = (await metadata.listWorkflows(namespaceId, ANY_TAGS)).filter((r) => r.name === 'described');
    expect(row).toMatchObject({
      description: 'Charges a card',
      ownerEmail: 'ops@example.com',
      createdBy: 'ada',
    });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('deletes one version and leaves the others', async () => {
    await metadata.registerWorkflow({ namespaceId, definition: definition('versioned') });
    await metadata.registerWorkflow({ namespaceId, definition: definition('versioned', { version: 2 }) });

    expect(await metadata.deleteWorkflowVersion(namespaceId, 'versioned', 1, ANY_TAGS)).toBe('deleted');

    const versions = (await metadata.listWorkflows(namespaceId, ANY_TAGS))
      .filter((r) => r.name === 'versioned')
      .map((r) => r.version);
    expect(versions).toEqual([2]);
  });

  it('refuses while an execution of that version is still running', async () => {
    // A running execution reloads its definition from this row. Deleting it
    // would strand the execution with nothing to evaluate against.
    await metadata.registerWorkflow({ namespaceId, definition: definition('busy') });
    const workflows = new WorkflowRepository(harness.db);
    await workflows.start({ namespaceId, defName: 'busy', defVersion: 1 });

    expect(await metadata.deleteWorkflowVersion(namespaceId, 'busy', 1, ANY_TAGS)).toBe('in_use');
    expect(await metadata.load(namespaceId, 'busy', 1)).toBeDefined();
  });

  it('allows it once those executions have finished', async () => {
    await metadata.registerWorkflow({ namespaceId, definition: definition('done') });
    const workflows = new WorkflowRepository(harness.db);
    const run = await workflows.start({ namespaceId, defName: 'done', defVersion: 1 });
    await harness.db
      .transaction()
      .execute((tx) => workflows.setStatus(run.id, WorkflowStatus.COMPLETED, undefined, undefined, tx));

    expect(await metadata.deleteWorkflowVersion(namespaceId, 'done', 1, ANY_TAGS)).toBe('deleted');
  });

  it('does not delete what the caller’s tag grants cannot reach', async () => {
    await metadata.registerWorkflow({ namespaceId, definition: definition('guarded'), tags: ['env:prod'] });

    expect(
      await metadata.deleteWorkflowVersion(namespaceId, 'guarded', 1, { tagGrants: ['env:dev'] })
    ).toBe('not_found');
  });
});

/**
 * Tags protect a workflow by name, not one version of it.
 *
 * Both of these were possible: tagging a workflow by registering a tagged
 * version left every earlier version readable by anyone, and registering a new
 * version without restating the tags quietly made the workflow public again.
 */
describe('tags belong to the workflow, not a version', () => {
  const definition = (name: string, version: number) => ({ name, version, tasks: [simple('a')] });
  const finance = { tagGrants: ['team:finance'] };
  const outsider = { tagGrants: ['team:growth'] };

  it('protects earlier versions once a later version is tagged', async () => {
    await metadata.registerWorkflow({ namespaceId, definition: definition('payroll', 1) });
    await metadata.registerWorkflow({ namespaceId, definition: definition('payroll', 2), tags: ['team:finance'] });

    expect(await metadata.getWorkflowDefinition(namespaceId, 'payroll', outsider, 1)).toBeUndefined();
    expect((await metadata.listWorkflows(namespaceId, outsider)).filter((r) => r.name === 'payroll')).toEqual([]);
    expect(await metadata.getWorkflowDefinition(namespaceId, 'payroll', finance, 1)).toBeDefined();
  });

  it('keeps the tags when a new version is registered without restating them', async () => {
    await metadata.registerWorkflow({ namespaceId, definition: definition('ledger', 1), tags: ['team:finance'] });
    await metadata.registerWorkflow({ namespaceId, definition: definition('ledger', 2), access: finance });

    expect(await metadata.tagsOf(namespaceId, 'ledger')).toEqual(['team:finance']);
    expect(await metadata.getWorkflowDefinition(namespaceId, 'ledger', outsider, 2)).toBeUndefined();
  });

  it('replaces the tags on every version when told to, including clearing them', async () => {
    await metadata.registerWorkflow({ namespaceId, definition: definition('invoices', 1), tags: ['team:finance'] });
    await metadata.registerWorkflow({ namespaceId, definition: definition('invoices', 2), tags: ['team:billing'], access: finance });

    expect(await metadata.getWorkflowDefinition(namespaceId, 'invoices', finance, 1)).toBeUndefined();
    expect(await metadata.getWorkflowDefinition(namespaceId, 'invoices', { tagGrants: ['team:billing'] }, 1)).toBeDefined();

    expect(await metadata.setTags(namespaceId, 'invoices', [], { tagGrants: ['team:billing'] })).toBe('updated');
    expect(await metadata.getWorkflowDefinition(namespaceId, 'invoices', outsider, 1)).toBeDefined();
  });

  it('refuses to retag what the caller cannot reach, and rejects malformed tags', async () => {
    await metadata.registerWorkflow({ namespaceId, definition: definition('secret', 1), tags: ['team:finance'] });

    expect(await metadata.setTags(namespaceId, 'secret', [], outsider)).toBe('not_found');
    expect(await metadata.setTags(namespaceId, 'missing', [], finance)).toBe('not_found');
    await expect(metadata.setTags(namespaceId, 'secret', ['Not A Tag'], finance)).rejects.toThrow(/not a usable tag/);
    expect(await metadata.tagsOf(namespaceId, 'secret')).toEqual(['team:finance']);
  });
});
