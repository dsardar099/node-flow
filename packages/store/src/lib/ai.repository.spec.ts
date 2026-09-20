import { TaskType, WorkflowStatus } from '@node-flow-dev/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiResolver, IntegrationRepository, PromptRepository, VectorRepository, workflowTools } from './ai.repository.js';
import { DecideQueueRepository } from './decide-queue.repository.js';
import { MetadataRepository } from './metadata.repository.js';
import { seedNamespace, startPostgresHarness, truncateAll, type PostgresHarness } from './testing/postgres-harness.js';
import { WorkflowRepository } from './workflow.repository.js';

/**
 * The stored half of the AI tasks. The vector search runs twice — on stock
 * Postgres, through the SQL fallback, and on an image with pgvector — and both
 * must rank the same way, or an install's answers would depend on its image.
 */

const unit = (values: number[]) => {
  const norm = Math.sqrt(values.reduce((s, x) => s + x * x, 0));
  return values.map((x) => x / norm);
};

let harness: PostgresHarness;
let namespaceId: string;

beforeAll(async () => {
  harness = await startPostgresHarness();
}, 180_000);

afterAll(async () => {
  await harness?.stop();
}, 60_000);

beforeEach(async () => {
  await truncateAll(harness.db);
  await harness.db.deleteFrom('VectorDocuments').execute();
  namespaceId = await seedNamespace(harness.db);
});

describe('integrations', () => {
  it('stores an LLM integration by name, replaces it, and resolves its key only when asked', async () => {
    const integrations = new IntegrationRepository(harness.db);
    await integrations.put(namespaceId, { name: 'openai', kind: 'LLM', provider: 'openai', apiKeySecret: 'OPENAI_KEY', models: ['gpt-5', 'gpt-5', ' '] }, 'ada@example.com');
    const replaced = await integrations.put(namespaceId, { name: 'openai', kind: 'LLM', provider: 'openai', apiKeySecret: 'OPENAI_KEY', models: ['gpt-5-mini'] });
    expect(replaced).toMatchObject({ models: ['gpt-5-mini'], createdBy: 'ada@example.com', apiKeySecret: 'OPENAI_KEY' });
    expect(await integrations.list(namespaceId)).toHaveLength(1);

    const secrets = { resolve: async (_ns: string, names: string[]) => Object.fromEntries(names.filter((n) => n === 'OPENAI_KEY').map((n) => [n, 'sk-live'])) };
    const resolver = aiResolver(integrations, new PromptRepository(harness.db), secrets);
    expect(await resolver.llm(namespaceId, 'openai')).toEqual({ name: 'openai', provider: 'openai', baseUrl: undefined, apiKey: 'sk-live', models: ['gpt-5-mini'] });

    // Disabled, or the wrong kind, is as good as absent.
    await integrations.put(namespaceId, { name: 'openai', kind: 'LLM', provider: 'openai', enabled: false });
    expect(await resolver.llm(namespaceId, 'openai')).toBeUndefined();
    expect(await resolver.mcp(namespaceId, 'openai')).toBeUndefined();
  });

  it('puts an MCP key in the configured header', async () => {
    const integrations = new IntegrationRepository(harness.db);
    await integrations.put(namespaceId, { name: 'github', kind: 'MCP', provider: 'streamable_http', baseUrl: 'https://mcp.example.com/mcp/', apiKeySecret: 'GH', config: { headers: { 'X-Team': 'ops' } } });
    const resolver = aiResolver(integrations, new PromptRepository(harness.db), { resolve: async () => ({ GH: 'ghp_1' }) });
    expect(await resolver.mcp(namespaceId, 'github')).toEqual({ name: 'github', url: 'https://mcp.example.com/mcp', headers: { 'X-Team': 'ops', Authorization: 'Bearer ghp_1' } });
  });

  it('refuses a secret that does not exist rather than calling without a key', async () => {
    const integrations = new IntegrationRepository(harness.db);
    await integrations.put(namespaceId, { name: 'claude', kind: 'LLM', provider: 'anthropic', apiKeySecret: 'MISSING' });
    const resolver = aiResolver(integrations, new PromptRepository(harness.db), { resolve: async () => ({}) });
    await expect(resolver.llm(namespaceId, 'claude')).rejects.toThrow(/secret "MISSING" does not exist/);
  });

  it('validates what an integration may be', async () => {
    const integrations = new IntegrationRepository(harness.db);
    await expect(integrations.put(namespaceId, { name: 'Bad Name', kind: 'LLM', provider: 'openai' })).rejects.toThrow(/lowercase/);
    await expect(integrations.put(namespaceId, { name: 'x', kind: 'LLM', provider: 'skynet' })).rejects.toThrow(/provider must be one of/);
    await expect(integrations.put(namespaceId, { name: 'x', kind: 'LLM', provider: 'openai_compatible' })).rejects.toThrow(/needs "baseUrl"/);
    await expect(integrations.put(namespaceId, { name: 'x', kind: 'MCP', provider: 'streamable_http', baseUrl: 'ftp://x' })).rejects.toThrow(/http or https/);
    await expect(integrations.put(namespaceId, { name: 'x', kind: 'MCP', provider: 'streamable_http', baseUrl: 'https://x', models: ['m'] })).rejects.toThrow(/no models/);
  });
});

describe('prompts', () => {
  it('versions every save, lists the latest, and extracts variables', async () => {
    const prompts = new PromptRepository(harness.db);
    await prompts.save(namespaceId, { name: 'triage', template: 'Classify ${ticket}' });
    const second = await prompts.save(namespaceId, { name: 'triage', template: 'Classify ${ticket} for ${team.name}', description: 'v2' });
    await prompts.save(namespaceId, { name: 'summary', template: 'Summarise' });

    expect(second).toMatchObject({ version: 2, variables: ['ticket', 'team'] });
    expect((await prompts.list(namespaceId)).map((p) => [p.name, p.version, p.versions])).toEqual([
      ['summary', 1, 1],
      ['triage', 2, 2],
    ]);
    expect((await prompts.get(namespaceId, 'triage', 1))?.template).toBe('Classify ${ticket}');
    expect((await prompts.get(namespaceId, 'triage'))?.version).toBe(2);
  });

  // Two editors saving at once must not both become version 2.
  it('numbers concurrent saves without collision', async () => {
    const prompts = new PromptRepository(harness.db);
    const saved = await Promise.all(Array.from({ length: 8 }, (_, i) => prompts.save(namespaceId, { name: 'busy', template: `v ${i}` })));
    expect(saved.map((p) => p.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

async function exerciseVectors(db: PostgresHarness['db'], ns: string) {
  const vectors = new VectorRepository(db);
  await vectors.upsert(ns, 'kb', [
    { docId: 'refunds', chunk: 0, text: 'refunds', metadata: { team: 'billing' }, embedding: unit([1, 0, 0]), model: 'm' },
    { docId: 'refunds', chunk: 1, text: 'refunds tail', metadata: {}, embedding: unit([1, 0.2, 0]), model: 'm' },
    { docId: 'shipping', chunk: 0, text: 'shipping', metadata: {}, embedding: unit([0, 1, 0]), model: 'm' },
  ]);
  // Re-indexed with one chunk: the old tail must go.
  await vectors.upsert(ns, 'kb', [{ docId: 'refunds', chunk: 0, text: 'refunds v2', metadata: {}, embedding: unit([1, 0.1, 0]), model: 'm' }]);

  const results = await vectors.search(ns, 'kb', unit([1, 0.05, 0]), 5);
  const indexes = await vectors.indexes(ns);
  const filtered = await vectors.search(ns, 'kb', unit([1, 0.05, 0]), 5, 0.5);
  const mismatch = await vectors.search(ns, 'kb', [1, 0], 5).catch((e: Error) => e.message);
  const wrongWrite = await vectors.upsert(ns, 'kb', [{ docId: 'x', chunk: 0, text: 'x', metadata: {}, embedding: [1, 0] }]).catch((e: Error) => e.message);
  const empty = await vectors.search(ns, 'nothing-here', unit([1, 0, 0]), 5);
  return { results, indexes, filtered, mismatch, wrongWrite, empty, native: await vectors.usesPgvector() };
}

describe('vector search on stock Postgres', () => {
  it('ranks by cosine similarity, replaces documents and refuses mismatched dimensions', async () => {
    const run = await exerciseVectors(harness.db, namespaceId);
    expect(run.native).toBe(false);
    expect(run.results.map((r) => r.text)).toEqual(['refunds v2', 'shipping']);
    expect(run.results[0].score).toBeGreaterThan(0.99);
    expect(run.filtered.map((r) => r.docId)).toEqual(['refunds']);
    expect(run.indexes).toEqual([expect.objectContaining({ indexName: 'kb', documents: 2, chunks: 2, dimensions: 3, models: ['m'] })]);
    expect(run.mismatch).toMatch(/3-dimension embeddings but the query has 2/);
    expect(run.wrongWrite).toMatch(/holds 3-dimension embeddings/);
    expect(run.empty).toEqual([]);
  });
});

describe('vector search with pgvector', () => {
  let vectorHarness: PostgresHarness;

  beforeAll(async () => {
    vectorHarness = await startPostgresHarness({ image: 'pgvector/pgvector:pg18' });
  }, 240_000);

  afterAll(async () => {
    await vectorHarness?.stop();
  }, 60_000);

  it('uses the extension and ranks exactly as the fallback does', async () => {
    const ns = await seedNamespace(vectorHarness.db);
    const run = await exerciseVectors(vectorHarness.db, ns);
    expect(run.native).toBe(true);
    expect(run.results.map((r) => r.text)).toEqual(['refunds v2', 'shipping']);
    expect(run.filtered.map((r) => r.docId)).toEqual(['refunds']);
    expect(run.mismatch).toMatch(/3-dimension/);
  });
});

describe('workflows as agent tools', () => {
  it('describes a definition, starts it once per tool call, and reports its status', async () => {
    const metadata = new MetadataRepository(harness.db);
    const workflows = new WorkflowRepository(harness.db);
    await metadata.registerWorkflow({
      namespaceId,
      definition: {
        name: 'refund_order',
        version: 1,
        description: 'Refunds an order',
        inputParameters: ['orderId'],
        tasks: [{ name: 'noop', taskReferenceName: 'noop', type: TaskType.NOOP }],
      } as never,
    });
    const tools = workflowTools(workflows, metadata, new DecideQueueRepository(harness.db));

    expect(await tools.describe(namespaceId, 'refund_order')).toEqual({ description: 'Refunds an order', inputSchema: { type: 'object', properties: { orderId: {} } } });
    expect(await tools.describe(namespaceId, 'nope')).toBeUndefined();

    const first = await tools.start(namespaceId, 'refund_order', { orderId: 'A-1' }, 'agent:t1:call_1', 'parent-wf');
    const again = await tools.start(namespaceId, 'refund_order', { orderId: 'A-1' }, 'agent:t1:call_1', 'parent-wf');
    expect(again).toBe(first);
    expect(await tools.status(namespaceId, first)).toMatchObject({ status: WorkflowStatus.RUNNING });
    // Another namespace's run is not visible through its id.
    expect(await tools.status(await seedNamespace(harness.db, 'other'), first)).toBeUndefined();
  });
});
