import type { JsonValue } from '@node-flow-dev/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskContext, TaskOutcome } from '../executor.js';
import { promptVariables, renderPrompt, type AiExecutorOptions, type AiResolver, type VectorRecord, type VectorStore } from './ai.js';
import { AgentExecutor } from './agent.executor.js';
import { chunkText, ChunkTextExecutor, GenerateEmbeddingsExecutor, IndexTextExecutor, SearchIndexExecutor } from './embeddings.executor.js';
import { LlmChatCompleteExecutor, LlmTextCompleteExecutor } from './llm.executor.js';
import { CallMcpToolExecutor, ListMcpToolsExecutor } from './mcp.js';
import { defaultReply, startMockMcp, startMockOpenAi, type ChatReply, type ChatRequest, type MockOpenAi } from './testing.js';

let openai: MockOpenAi;
let mcp: Awaited<ReturnType<typeof startMockMcp>>;
let script: ((request: ChatRequest) => ChatReply) | undefined;

beforeAll(async () => {
  openai = await startMockOpenAi((request) => (script ? script(request) : defaultReply(request)));
  mcp = await startMockMcp(
    [
      {
        name: 'lookup_order',
        description: 'Finds an order',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        handler: (args) => ({ order: String(args['query']), status: 'shipped' }),
      },
      { name: 'explode', handler: () => { throw new Error('warehouse offline'); } },
    ],
    ['x-mcp-token', 'letmein']
  );
});

afterAll(async () => {
  await openai?.close();
  await mcp?.close();
});

class MemoryVectors implements VectorStore {
  records = new Map<string, VectorRecord & { index: string }>();
  async upsert(_ns: string, index: string, records: VectorRecord[]) {
    for (const [key, r] of this.records) if (r.index === index && records.some((n) => n.docId === r.docId)) this.records.delete(key);
    for (const r of records) this.records.set(`${index}:${r.docId}:${r.chunk}`, { ...r, index });
    return records.length;
  }
  async search(_ns: string, index: string, embedding: number[], topK: number) {
    return [...this.records.values()]
      .filter((r) => r.index === index)
      .map((r) => ({ docId: r.docId, chunk: r.chunk, text: r.text, metadata: r.metadata, score: r.embedding.reduce((s, x, i) => s + x * embedding[i], 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

function resolver(overrides: Partial<{ apiKey: string; models: string[] }> = {}): AiResolver {
  return {
    llm: async (_ns, name) =>
      name === 'mock'
        ? { name, provider: 'openai_compatible', baseUrl: openai.url, apiKey: overrides.apiKey ?? 'sk-test', models: overrides.models ?? ['mock-chat', 'mock-embed'] }
        : undefined,
    mcp: async (_ns, name) => (name === 'orders' ? { name, url: mcp.url, headers: { 'x-mcp-token': 'letmein' } } : undefined),
    prompt: async (_ns, name, version) =>
      name === 'support' && (version === undefined || version === 2) ? { name, version: 2, template: 'You help customers of ${company}. Be brief.' } : undefined,
  };
}

function context(input: Record<string, unknown>, state: Record<string, JsonValue> = {}): TaskContext {
  return {
    taskId: 'task-1',
    workflowId: 'wf-1',
    namespaceId: 'ns',
    input: input as Record<string, JsonValue>,
    signal: new AbortController().signal,
    heartbeat: async () => undefined,
    state,
  };
}

const output = (outcome: TaskOutcome) => ('output' in outcome ? (outcome.output ?? {}) : {}) as Record<string, any>;

describe('prompts', () => {
  it('fills placeholders, including nested values, and lists them', () => {
    expect(renderPrompt('Hi ${name}, order ${order.id} costs ${order}', { name: 'Ada', order: { id: 'A-1' } })).toBe('Hi Ada, order A-1 costs {"id":"A-1"}');
    expect(promptVariables('${a} ${ b } ${a} ${c.d}')).toEqual(['a', 'b', 'c']);
  });

  // A prompt that silently lost its subject still gets a confident answer.
  it('refuses to send a prompt with a variable missing', () => {
    expect(() => renderPrompt('Summarise ${document}', {})).toThrow(/missing: document/);
  });
});

describe('LLM_TEXT_COMPLETE', () => {
  const run = (input: Record<string, unknown>, options: AiExecutorOptions = { resolver: resolver() }) => new LlmTextCompleteExecutor(options).execute(context(input));

  it('calls the integration’s provider with its key and returns the answer and usage', async () => {
    const outcome = await run({ llmProvider: 'mock', model: 'mock-chat', prompt: 'hello there', instructions: 'Be terse.' });
    expect(outcome.status).toBe('COMPLETED');
    expect(output(outcome)).toMatchObject({ result: 'echo: hello there', model: 'mock-chat', llmProvider: 'mock', usage: { inputTokens: 12, outputTokens: 7 } });
    expect(openai.requests.at(-1)?.messages[0]).toMatchObject({ role: 'system', content: 'Be terse.' });
  });

  it('renders a stored prompt and reports which version it used', async () => {
    const outcome = await run({ llmProvider: 'mock', promptName: 'support', promptVariables: { company: 'Acme' } });
    expect(output(outcome)).toMatchObject({ result: 'echo: You help customers of Acme. Be brief.', promptVersion: 2, model: 'mock-chat' });
  });

  it('fails terminally for what a retry cannot fix', async () => {
    expect(await run({ llmProvider: 'nope', prompt: 'x' })).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/no enabled LLM integration "nope"/) });
    expect(await run({ llmProvider: 'mock', model: 'gpt-9', prompt: 'x' })).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/not enabled/) });
    expect(await run({ llmProvider: 'mock', promptName: 'support' })).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/missing: company/) });
    expect(await run({ llmProvider: 'mock', prompt: 'x' }, {})).toMatchObject({ status: 'FAILED', terminal: true });
    // A rejected key is the provider's 401, and retrying it only burns attempts.
    const denied = await run({ llmProvider: 'mock', prompt: 'x' }, { resolver: resolver({ apiKey: 'bad-key' }) });
    expect(denied).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/401/) });
  });

  it('parses JSON answers, fences and all, and fails when the answer is not JSON', async () => {
    script = () => ({ content: '```json\n{"sentiment":"positive","score":0.9}\n```' });
    expect(output(await run({ llmProvider: 'mock', prompt: 'rate', jsonOutput: true }))).toMatchObject({ result: { sentiment: 'positive', score: 0.9 } });
    script = () => ({ content: 'I think it is positive' });
    expect(await run({ llmProvider: 'mock', prompt: 'rate', jsonOutput: true })).toMatchObject({ status: 'FAILED', output: { text: 'I think it is positive' } });
    script = undefined;
  });
});

describe('LLM_CHAT_COMPLETE', () => {
  it('sends the conversation with the stored prompt as its system message', async () => {
    const outcome = await new LlmChatCompleteExecutor({ resolver: resolver() }).execute(
      context({
        llmProvider: 'mock',
        promptName: 'support',
        promptVariables: { company: 'Acme' },
        messages: [
          { role: 'user', message: 'Where is my order?' },
          { role: 'assistant', message: 'Which one?' },
          { role: 'user', content: 'A-1' },
        ],
      })
    );
    expect(output(outcome)).toMatchObject({ result: 'echo: A-1' });
    expect(openai.requests.at(-1)?.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });
});

describe('embeddings and retrieval', () => {
  it('chunks on natural boundaries with overlap and never loses text', () => {
    const text = 'First paragraph about refunds.\n\nSecond paragraph about shipping times and carriers. It has two sentences.\n\nThird about returns.';
    const chunks = chunkText(text, 60, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 60)).toBe(true);
    for (const word of text.split(/\s+/)) expect(chunks.join(' ')).toContain(word);
    expect(chunkText('short', 1000, 100)).toEqual(['short']);
  });

  it('CHUNK_TEXT reports the chunks', async () => {
    expect(output(await new ChunkTextExecutor().execute(context({ text: 'a b c d e f', chunkSize: 4, chunkOverlap: 0 })))).toMatchObject({ count: 3 });
  });

  it('embeds one text as one vector and many as many', async () => {
    const executor = new GenerateEmbeddingsExecutor({ resolver: resolver() });
    const one = output(await executor.execute(context({ llmProvider: 'mock', model: 'mock-embed', text: 'hello' })));
    expect(one['result']).toHaveLength(64);
    const many = output(await executor.execute(context({ llmProvider: 'mock', model: 'mock-embed', text: ['a', 'b'] })));
    expect(many['result']).toHaveLength(2);
    expect(many['dimensions']).toBe(64);
  });

  it('indexes documents and finds the relevant one', async () => {
    const vectors = new MemoryVectors();
    const options = { resolver: resolver(), vectors };
    const index = new IndexTextExecutor(options);
    await index.execute(context({ llmProvider: 'mock', embeddingModel: 'mock-embed', index: 'handbook', docId: 'refunds', text: 'Refunds are issued within five days to the original card.', metadata: { team: 'billing' } }));
    await index.execute(context({ llmProvider: 'mock', embeddingModel: 'mock-embed', index: 'handbook', docId: 'shipping', text: 'Parcels ship with DHL and arrive in two days.' }));
    // Re-indexing a document replaces its chunks rather than duplicating them.
    await index.execute(context({ llmProvider: 'mock', embeddingModel: 'mock-embed', index: 'handbook', docId: 'shipping', text: 'Parcels ship with DHL and arrive in three days.' }));
    expect(vectors.records.size).toBe(2);

    const found = output(await new SearchIndexExecutor(options).execute(context({ llmProvider: 'mock', embeddingModel: 'mock-embed', index: 'handbook', query: 'when are refunds issued', topK: 1 })));
    expect(found['result']).toEqual([expect.objectContaining({ docId: 'refunds', metadata: { team: 'billing' } })]);
    expect(found['context']).toContain('Refunds are issued');

    expect(await new SearchIndexExecutor(options).execute(context({ llmProvider: 'mock', index: 'bad name!', query: 'x' }))).toMatchObject({ status: 'FAILED', terminal: true });
  });
});

describe('MCP', () => {
  it('lists and calls a server’s tools with the integration’s headers', async () => {
    const listed = output(await new ListMcpToolsExecutor({ resolver: resolver() }).execute(context({ mcpServer: 'orders' })));
    expect(listed['result'].map((t: { name: string }) => t.name)).toEqual(['lookup_order', 'explode']);

    const called = await new CallMcpToolExecutor({ resolver: resolver() }).execute(context({ mcpServer: 'orders', method: 'lookup_order', arguments: { query: 'A-7' } }));
    expect(output(called)).toMatchObject({ text: '{"order":"A-7","status":"shipped"}' });
  });

  // The tool answered; asking again with the same arguments gets the same answer.
  it('fails terminally when the tool reports an error', async () => {
    const outcome = await new CallMcpToolExecutor({ resolver: resolver() }).execute(context({ mcpServer: 'orders', method: 'explode' }));
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/warehouse offline/) });
  });

  it('does not reach a server whose headers are wrong', async () => {
    const wrong: AiResolver = { ...resolver(), mcp: async () => ({ name: 'orders', url: mcp.url, headers: { 'x-mcp-token': 'nope' } }) };
    expect(await new ListMcpToolsExecutor({ resolver: wrong }).execute(context({ mcpServer: 'orders' }))).toMatchObject({ status: 'FAILED' });
  });
});

describe('AGENT', () => {
  it('calls an MCP tool, reads its result and answers', async () => {
    script = undefined;
    const outcome = await new AgentExecutor({ resolver: resolver() }).execute(
      context({ llmProvider: 'mock', prompt: 'A-9', instructions: 'Help with orders.', tools: [{ type: 'mcp', mcpServer: 'orders', include: ['lookup_order'] }] })
    );
    expect(outcome.status).toBe('COMPLETED');
    expect(output(outcome)['result']).toContain('"status":"shipped"');
    expect(output(outcome)).toMatchObject({ stepCount: 2, usage: { totalTokens: 38 } });
    expect(output(outcome)['steps'][0]).toMatchObject({ toolCalls: [{ toolName: 'lookup_order', input: { query: 'A-9' } }], toolResults: [{ toolName: 'lookup_order', isError: false }] });
    expect(mcp.calls.at(-1)).toEqual({ name: 'lookup_order', args: { query: 'A-9' } });
  });

  it('runs a workflow tool as a child run, yielding until it finishes and starting it once', async () => {
    const started: { name: string; key: string; input: unknown }[] = [];
    let status = 'RUNNING';
    const options: AiExecutorOptions = {
      resolver: resolver(),
      workflows: {
        describe: async (_ns, name) => (name === 'refund_order' ? { description: 'Refunds an order', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } } : undefined),
        start: async (_ns, name, input, key) => {
          if (!started.some((s) => s.key === key)) started.push({ name, key, input });
          return 'child-1';
        },
        status: async () => ({ status, ...(status === 'COMPLETED' ? { output: { refunded: 42 } } : {}) }),
      },
    };
    const agent = new AgentExecutor(options);
    const input = { llmProvider: 'mock', prompt: 'refund A-3', tools: [{ type: 'workflow', name: 'refund_order' }] };

    const first = await agent.execute(context(input));
    expect(first).toMatchObject({ status: 'IN_PROGRESS', callbackAfterSeconds: 2 });
    const saved = output(first) as Record<string, JsonValue>;

    // Still running: yields again without another model call.
    const requestsBefore = openai.requests.length;
    const second = await agent.execute(context(input, saved));
    expect(second.status).toBe('IN_PROGRESS');
    expect(openai.requests.length).toBe(requestsBefore);

    status = 'COMPLETED';
    const third = await agent.execute(context(input, output(second) as Record<string, JsonValue>));
    expect(third.status).toBe('COMPLETED');
    expect(output(third)['result']).toContain('42');
    expect(started).toEqual([{ name: 'refund_order', key: expect.stringMatching(/^agent:task-1:call_/), input: { query: 'refund A-3' } }]);
  });

  it('gives up after maxSteps with the transcript, and tells the model about unknown tools', async () => {
    script = () => ({ toolCalls: [{ name: 'does_not_exist', arguments: {} }] });
    const outcome = await new AgentExecutor({ resolver: resolver() }).execute(context({ llmProvider: 'mock', prompt: 'loop', maxSteps: 2 }));
    script = undefined;
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/maxSteps \(2\)/) });
    expect(output(outcome)['steps']).toHaveLength(2);
    expect(output(outcome)['steps'][0]['toolResults']).toEqual([{ toolName: 'does_not_exist', isError: true }]);
  });

  it('refuses tool specs it cannot honour before calling the model', async () => {
    const before = openai.requests.length;
    expect(await new AgentExecutor({ resolver: resolver() }).execute(context({ llmProvider: 'mock', prompt: 'x', tools: [{ type: 'shell' }] }))).toMatchObject({ status: 'FAILED', terminal: true });
    expect(await new AgentExecutor({ resolver: resolver() }).execute(context({ llmProvider: 'mock', prompt: 'x', tools: [{ type: 'workflow', name: 'w' }] }))).toMatchObject({ status: 'FAILED', terminal: true });
    expect(openai.requests.length).toBe(before);
  });
});
