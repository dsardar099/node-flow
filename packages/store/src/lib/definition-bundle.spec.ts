import { TaskType } from '@node-flow-dev/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { exportDefinitions, importDefinitions } from './definition-bundle.js';
import { MetadataRepository } from './metadata.repository.js';
import { seedNamespace, startPostgresHarness, truncateAll, type PostgresHarness } from './testing/postgres-harness.js';

let harness: PostgresHarness;
let metadata: MetadataRepository;
let source: string;
let target: string;
const admin = { tagGrants: ['admin'] };

beforeAll(async () => {
  harness = await startPostgresHarness();
  metadata = new MetadataRepository(harness.db);
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  source = await seedNamespace(harness.db, 'source');
  target = await seedNamespace(harness.db, 'target');
});

const simple = (name: string) => ({ name, taskReferenceName: name, type: TaskType.SIMPLE });
const register = (namespaceId: string, definition: Record<string, unknown>, tags?: string[]) =>
  metadata.registerWorkflow({ namespaceId, definition, tags, access: admin });

async function seed() {
  await metadata.upsertTaskDefinition(source, { name: 'charge', retryCount: 5 });
  await metadata.upsertTaskDefinition(source, { name: 'ship', retryCount: 1 });
  await metadata.upsertTaskDefinition(source, { name: 'unrelated', retryCount: 2 });
  await register(source, { name: 'refund_child', version: 1, tasks: [simple('ship')] });
  await register(source, { name: 'on_failure', version: 1, tasks: [simple('ship')] });
  await register(source, { name: 'checkout', version: 1, tasks: [simple('charge')] });
  await register(source, {
    name: 'checkout',
    version: 2,
    failureWorkflow: 'on_failure',
    tasks: [
      simple('charge'),
      { name: 'child', taskReferenceName: 'child', type: TaskType.SUB_WORKFLOW, subWorkflowParam: { name: 'refund_child', version: 1 } },
    ],
  }, ['team:payments']);
}

describe('exporting definitions', () => {
  it('exports a workflow with what it needs to run elsewhere', async () => {
    await seed();
    const bundle = await exportDefinitions(metadata, source, admin, { workflows: ['checkout'] });

    expect(bundle.format).toBe('node-flow.definitions');
    expect(bundle.workflows.map((w) => `${w['name']}@${w['version']}`)).toEqual(['checkout@2', 'on_failure@1', 'refund_child@1']);
    expect(bundle.workflows[0]['tags']).toEqual(['team:payments']);
    // Only the task definitions its worker tasks use.
    expect(bundle.taskDefinitions.map((t) => t['name']).sort()).toEqual(['charge', 'ship']);

    const all = await exportDefinitions(metadata, source, admin, { workflows: ['checkout'], versions: 'all', includeDependencies: false });
    expect(all.workflows.map((w) => `${w['name']}@${w['version']}`)).toEqual(['checkout@1', 'checkout@2']);
  });

  // An agent's workflow tools run as child executions; exported alone it would fail elsewhere.
  it('brings the workflows an agent calls as tools', async () => {
    await seed();
    await register(source, {
      name: 'assistant',
      version: 1,
      tasks: [{ name: 'agent', taskReferenceName: 'agent', type: TaskType.AGENT, inputParameters: { llmProvider: 'x', prompt: 'p', tools: [{ type: 'workflow', name: 'refund_child' }, { type: 'mcp', mcpServer: 'm' }] } }],
    });
    const bundle = await exportDefinitions(metadata, source, admin, { workflows: ['assistant'] });
    expect(bundle.workflows.map((w) => w['name'])).toEqual(['assistant', 'refund_child']);
  });

  it('leaves out workflows the caller’s tags cannot reach', async () => {
    await seed();
    const outsider = { tagGrants: ['workflows:read'] };
    const bundle = await exportDefinitions(metadata, source, outsider);
    expect(bundle.workflows.map((w) => w['name'])).not.toContain('checkout');
    await expect(exportDefinitions(metadata, source, outsider, { workflows: ['checkout'] })).rejects.toThrow(/no workflow "checkout"/);
  });
});

describe('importing definitions', () => {
  it('recreates an exported bundle in an empty namespace, and is idempotent', async () => {
    await seed();
    const bundle = await exportDefinitions(metadata, source, admin);

    const first = await importDefinitions(metadata, target, admin, bundle);
    expect(first).toMatchObject({ applied: true, summary: { created: 6, invalid: 0 } });
    expect((await metadata.getWorkflowDefinition(target, 'checkout', admin, 2))?.failureWorkflow).toBe('on_failure');
    expect(await metadata.tagsOf(target, 'checkout')).toEqual(['team:payments']);
    expect((await metadata.getTaskDefinition(target, 'charge'))?.retryCount).toBe(5);

    const again = await importDefinitions(metadata, target, admin, bundle);
    expect(again.summary).toMatchObject({ created: 0, unchanged: 6 });
  });

  it('skips a conflicting version, or registers it as the next one', async () => {
    await register(target, { name: 'checkout', version: 1, tasks: [simple('charge')] });
    const bundle = {
      workflows: [
        { name: 'checkout', version: 1, tasks: [simple('charge'), simple('ship')] },
        { name: 'checkout', version: 2, tasks: [simple('refund')] },
      ],
    };

    const skipped = await importDefinitions(metadata, target, admin, bundle);
    expect(skipped.items.map((i) => [i.version, i.action])).toEqual([
      [1, 'skipped'],
      [2, 'created'],
    ]);

    await register(target, { name: 'orders', version: 1, tasks: [simple('a')] });
    const bumped = await importDefinitions(
      metadata,
      target,
      admin,
      { workflows: [{ name: 'orders', version: 1, tasks: [simple('b')] }, { name: 'orders', version: 2, tasks: [simple('c')] }] },
      { workflowConflicts: 'new-version' }
    );
    // The bumped v1 goes past every version the bundle declares, so the bundle's own v2 still lands as v2.
    expect(bumped).toMatchObject({ applied: true });
    expect(bumped.items.map((i) => [i.version, i.action, i.importedAs])).toEqual([
      [1, 'new-version', 3],
      [2, 'created', undefined],
    ]);
    expect(await metadata.latestVersion(target, 'orders')).toBe(3);
  });

  it('writes nothing when anything in the bundle is invalid, and nothing on a dry run', async () => {
    const broken = {
      taskDefinitions: [{ name: 'charge', retryCount: 1 }],
      workflows: [
        { name: 'good', version: 1, tasks: [simple('a')] },
        { name: 'bad', version: 1, tasks: [{ name: 'j', taskReferenceName: 'j', type: TaskType.JOIN, joinOn: ['missing'] }] },
      ],
    };
    const result = await importDefinitions(metadata, target, admin, broken);
    expect(result.applied).toBe(false);
    expect(result.items.find((i) => i.name === 'bad')).toMatchObject({ action: 'invalid' });
    expect(await metadata.latestVersion(target, 'good')).toBeUndefined();
    expect(await metadata.getTaskDefinition(target, 'charge')).toBeUndefined();

    const dry = await importDefinitions(metadata, target, admin, { workflows: [broken.workflows[0]] }, { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, applied: false, summary: { created: 1 } });
    expect(await metadata.latestVersion(target, 'good')).toBeUndefined();
  });

  it('overwrites task definitions only when asked', async () => {
    await metadata.upsertTaskDefinition(target, { name: 'charge', retryCount: 1 });
    const bundle = { taskDefinitions: [{ name: 'charge', retryCount: 9 }] };
    expect((await importDefinitions(metadata, target, admin, bundle)).items[0].action).toBe('skipped');
    expect((await importDefinitions(metadata, target, admin, bundle, { taskDefinitionConflicts: 'overwrite' })).items[0].action).toBe('updated');
    expect((await metadata.getTaskDefinition(target, 'charge'))?.retryCount).toBe(9);
  });

  it('does not strip or bypass tags', async () => {
    await register(target, { name: 'vault', version: 1, tasks: [simple('a')] }, ['env:prod']);
    const outsider = { tagGrants: ['workflows:write'] };
    const blocked = await importDefinitions(metadata, target, outsider, { workflows: [{ name: 'vault', version: 2, tasks: [simple('b')] }] });
    expect(blocked).toMatchObject({ applied: false, items: [{ action: 'invalid' }] });

    // A bundle without tags adds a version but keeps the protection.
    await importDefinitions(metadata, target, admin, { workflows: [{ name: 'vault', version: 2, tasks: [simple('b')] }] });
    expect(await metadata.tagsOf(target, 'vault')).toEqual(['env:prod']);
  });

  it('refuses what is not a bundle', async () => {
    await expect(importDefinitions(metadata, target, admin, [])).rejects.toThrow(/JSON object/);
    await expect(importDefinitions(metadata, target, admin, { format: 'conductor', workflows: [] })).rejects.toThrow(/not a node-flow/);
    await expect(importDefinitions(metadata, target, admin, { formatVersion: 99, workflows: [{}] })).rejects.toThrow(/format version 99/);
    await expect(importDefinitions(metadata, target, admin, {})).rejects.toThrow(/no workflows/);
  });
});
