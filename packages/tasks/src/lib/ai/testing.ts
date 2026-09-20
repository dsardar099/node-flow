import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-ins for an LLM provider and an MCP server, speaking the real wire
 * protocols over real HTTP — so a test goes through the provider SDK and the
 * MCP client exactly as production does, and the same fixtures serve an
 * end-to-end run of the server without a paid API key.
 */

/** A 1x1 transparent PNG, the smallest real image. */
export const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export interface ChatRequest {
  model: string;
  messages: { role: string; content: unknown; tool_calls?: { id: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }[];
  tools?: { type: 'function'; function: { name: string; description?: string; parameters?: unknown } }[];
}

export interface ChatReply {
  content?: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
}

export interface MockOpenAi {
  url: string;
  requests: ChatRequest[];
  embeddingRequests: { model: string; input: string[] }[];
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

/**
 * A deterministic embedding: words hashed into 64 buckets, normalised. Texts
 * sharing words score close, which is enough to make retrieval tests meaningful.
 */
export function mockEmbedding(text: string, dimensions = 64): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hash = 2166136261;
    for (const ch of word) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    vector[Math.abs(hash) % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

/**
 * The default policy: with tools and no tool result yet, call the first tool
 * with the user's words as `query`; after a result, answer with it; otherwise
 * echo. Enough for an agent to take one real step.
 */
export function defaultReply(request: ChatRequest): ChatReply {
  const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
  const userText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
  const toolResults = request.messages.filter((m) => m.role === 'tool');
  if (request.tools?.length && toolResults.length === 0) {
    return { toolCalls: [{ name: request.tools[0].function.name, arguments: { query: userText } }] };
  }
  if (toolResults.length > 0) {
    const last = toolResults.at(-1);
    return { content: `Based on ${request.tools?.[0]?.function.name ?? 'the tool'}: ${typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)}` };
  }
  return { content: `echo: ${userText}` };
}

export async function startMockOpenAi(reply: (request: ChatRequest) => ChatReply = defaultReply, port = 0): Promise<MockOpenAi> {
  const requests: ChatRequest[] = [];
  const embeddingRequests: { model: string; input: string[] }[] = [];
  let calls = 0;

  const server: HttpServer = createServer(async (req, res) => {
    try {
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.headers.authorization === 'Bearer bad-key') return send(401, { error: { message: 'Incorrect API key provided' } });

      if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
        const request = (await body(req)) as ChatRequest;
        requests.push(request);
        const answer = reply(request);
        const toolCalls = (answer.toolCalls ?? []).map((call, i) => ({
          id: `call_${++calls}_${i}`,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }));
        return send(200, {
          id: `chatcmpl-${calls}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: answer.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
              finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
        });
      }

      if (req.method === 'POST' && req.url?.endsWith('/embeddings')) {
        const request = (await body(req)) as { model: string; input: string | string[] };
        const input = Array.isArray(request.input) ? request.input : [request.input];
        embeddingRequests.push({ model: request.model, input });
        return send(200, {
          object: 'list',
          model: request.model,
          data: input.map((text, index) => ({ object: 'embedding', index, embedding: mockEmbedding(text) })),
          usage: { prompt_tokens: input.length, total_tokens: input.length },
        });
      }

      if (req.method === 'POST' && req.url?.endsWith('/images/generations')) {
        const request = (await body(req)) as { prompt: string; n?: number };
        requests.push({ model: 'image', messages: [{ role: 'user', content: request.prompt }] });
        return send(200, { created: 1, data: Array.from({ length: request.n ?? 1 }, () => ({ b64_json: ONE_PIXEL_PNG })) });
      }

      if (req.method === 'POST' && req.url?.endsWith('/audio/speech')) {
        const request = (await body(req)) as { input: string };
        requests.push({ model: 'speech', messages: [{ role: 'user', content: request.input }] });
        res.writeHead(200, { 'content-type': 'audio/mpeg' });
        res.end(Buffer.from('ID3mock-audio'));
        return;
      }

      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        return send(200, { object: 'list', data: [{ id: 'mock-chat', object: 'model' }, { id: 'mock-embed', object: 'model' }] });
      }
      send(404, { error: { message: `no route ${req.method} ${req.url}` } });
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: bound } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${bound}/v1`,
    requests,
    embeddingRequests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export interface MockMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  handler(args: Record<string, unknown>): unknown;
}

/** A stateless streamable-HTTP MCP server; `requiredHeader` makes it check one. */
export async function startMockMcp(tools: MockMcpTool[], requiredHeader?: [string, string], port = 0): Promise<{ url: string; calls: { name: string; args: unknown }[]; close(): Promise<void> }> {
  const calls: { name: string; args: unknown }[] = [];
  const http = createServer(async (req, res) => {
    if (requiredHeader && req.headers[requiredHeader[0].toLowerCase()] !== requiredHeader[1]) {
      res.writeHead(401);
      res.end('unauthorised');
      return;
    }
    const server = new Server({ name: 'mock-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as never })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = tools.find((t) => t.name === request.params.name);
      calls.push({ name: request.params.name, args: request.params.arguments });
      if (!tool) return { content: [{ type: 'text', text: `no tool ${request.params.name}` }], isError: true };
      try {
        const result = await tool.handler(request.params.arguments ?? {});
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: (error as Error).message }], isError: true };
      }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    const parsed = req.method === 'POST' ? await body(req) : undefined;
    await transport.handleRequest(req, res, parsed);
  });
  await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve));
  const { port: bound } = http.address() as AddressInfo;
  return { url: `http://127.0.0.1:${bound}/mcp`, calls, close: () => new Promise((resolve) => http.close(() => resolve())) };
}
