import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TaskContext, TaskExecutor, TaskOutcome } from '../executor.js';
import { AiTaskError, asRecord, failure, type AiExecutorOptions, type ResolvedMcpIntegration } from './ai.js';

/**
 * MCP client tasks: `LIST_MCP_TOOLS` and `CALL_MCP_TOOL`, plus the connection
 * helper the `AGENT` task shares.
 *
 * The server is an integration — its URL and the secret-backed headers it needs
 * are configured by an administrator and named by the task — for the same
 * reason every other endpoint a task reaches is: the definition is user input.
 * Streamable HTTP only; a stdio server would mean spawning processes chosen by
 * workflow authors on the node-flow host.
 */

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, JsonValue>;
}

export interface McpSession {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, JsonValue>): Promise<{ content: JsonValue; isError: boolean; structured?: JsonValue }>;
  close(): Promise<void>;
}

export async function connectMcp(integration: ResolvedMcpIntegration, signal?: AbortSignal): Promise<McpSession> {
  const client = new Client({ name: 'node-flow', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(integration.url), {
    requestInit: { headers: integration.headers, signal },
  });
  await client.connect(transport);
  return {
    async listTools() {
      const tools: McpToolInfo[] = [];
      let cursor: string | undefined;
      // Paged, and bounded: a server listing tools forever must not hang the task.
      for (let page = 0; page < 20; page++) {
        const result = await client.listTools(cursor ? { cursor } : undefined, { signal });
        for (const tool of result.tools) {
          tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Record<string, JsonValue> });
        }
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      return tools;
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal });
      return {
        content: (result.content ?? null) as JsonValue,
        isError: result.isError === true,
        ...(result.structuredContent ? { structured: result.structuredContent as JsonValue } : {}),
      };
    },
    close: () => client.close(),
  };
}

export type McpConnector = typeof connectMcp;

async function requireMcp(options: AiExecutorOptions, namespaceId: string, input: Record<string, JsonValue>) {
  if (!options.resolver) throw new AiTaskError('MCP tasks are not available on this server', true);
  const name = input['mcpServer'] ?? input['integration'];
  if (typeof name !== 'string' || name === '') throw new AiTaskError('requires "mcpServer", the name of an MCP integration', true);
  const integration = await options.resolver.mcp(namespaceId, name);
  if (!integration) throw new AiTaskError(`no enabled MCP integration "${name}"`, true);
  return integration;
}

/** Text parts of a tool result joined, which is what a next task usually wants. */
export function mcpText(content: JsonValue): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && !Array.isArray(part) && part['type'] === 'text' ? String(part['text'] ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

export class ListMcpToolsExecutor implements TaskExecutor {
  readonly type = TaskType.LIST_MCP_TOOLS;
  constructor(
    private readonly options: AiExecutorOptions = {},
    private readonly connect: McpConnector = connectMcp
  ) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    let session: McpSession | undefined;
    try {
      session = await this.connect(await requireMcp(this.options, context.namespaceId, context.input), context.signal);
      const tools = await session.listTools();
      return { status: 'COMPLETED', output: { result: tools as unknown as JsonValue, count: tools.length } };
    } catch (error) {
      return failure(error);
    } finally {
      await session?.close().catch(() => undefined);
    }
  }
}

export class CallMcpToolExecutor implements TaskExecutor {
  readonly type = TaskType.CALL_MCP_TOOL;
  constructor(
    private readonly options: AiExecutorOptions = {},
    private readonly connect: McpConnector = connectMcp
  ) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    let session: McpSession | undefined;
    try {
      const integration = await requireMcp(this.options, context.namespaceId, context.input);
      const method = context.input['method'] ?? context.input['tool'];
      if (typeof method !== 'string' || method === '') throw new AiTaskError('CALL_MCP_TOOL requires "method", the tool name', true);
      session = await this.connect(integration, context.signal);
      const result = await session.callTool(method, asRecord(context.input['arguments']));
      const output = { content: result.content, text: mcpText(result.content), ...(result.structured ? { result: result.structured } : {}) };
      // A tool reporting an error is the tool's answer, not a transport fault:
      // retrying the same arguments will give the same answer.
      if (result.isError) return { status: 'FAILED', reason: `tool "${method}" returned an error: ${output.text || 'no detail'}`, terminal: true, output };
      return { status: 'COMPLETED', output };
    } catch (error) {
      return failure(error);
    } finally {
      await session?.close().catch(() => undefined);
    }
  }
}
