import { All, Controller, Module, Req, Res } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import { MetadataRepository, SchemaRegistryRepository } from '@node-flow-dev/store';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { EXECUTION_SCOPES, mayUse } from '../common/access-policy.js';
import { ExecutionController } from '../execution/execution.module.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Workflows as MCP tools.
 *
 * An agent anywhere — Claude, an IDE, another node-flow `AGENT` — connects to
 * `/v1/ns/{ns}/mcp` with an API key and sees every workflow tagged `mcp:tool`
 * that the key may execute. Calling one starts it through the ordinary
 * execution path — the same scopes, grants, input schema, quotas and
 * concurrency limits as `POST /executions` — and waits for the result.
 *
 * Opt-in by tag because a workflow is not a tool by default: "refund an order"
 * becoming callable by any agent holding a key should be somebody's decision.
 *
 * A run that outlasts the wait returns its id rather than blocking the agent,
 * and `get_execution` fetches the result later.
 */

export const MCP_TOOL_TAG = 'mcp:tool';
const WAIT_SECONDS = 30;
const START_SCOPES = { ...EXECUTION_SCOPES, EXECUTE: Scope.EXECUTIONS_START };

interface RawRequest {
  raw: IncomingMessage;
  body?: unknown;
}

interface RawReply {
  raw: ServerResponse;
  hijack(): void;
}

@Controller('ns/:ns/mcp')
export class McpGatewayController {
  constructor(
    private readonly metadata: MetadataRepository,
    private readonly schemas: SchemaRegistryRepository,
    private readonly modules: ModuleRef
  ) {}

  @All()
  @RequireScopes(Scope.EXECUTIONS_START)
  @ApiRoute({
    summary: 'MCP server exposing workflows as tools',
    description: 'Streamable HTTP (JSON responses). Workflows tagged `mcp:tool` that the caller may execute are listed as tools.',
    tags: ['mcp'],
  })
  async handle(@CurrentPrincipal() principal: Principal, @Req() request: RawRequest, @Res() reply: RawReply) {
    const server = new Server({ name: 'node-flow', version: '1.0.0' }, { capabilities: { tools: {} } });
    const tools = await this.tools(principal);

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        ...tools.map((t) => ({ name: t.tool, description: t.description, inputSchema: t.inputSchema as never })),
        {
          name: 'get_execution',
          description: 'Fetches the status and output of a workflow run started by another tool call that was still running.',
          inputSchema: { type: 'object' as const, properties: { workflowId: { type: 'string' } }, required: ['workflowId'] },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const executions = this.modules.get(ExecutionController, { strict: false });
      const args = (call.params.arguments ?? {}) as Record<string, JsonValue>;
      try {
        if (call.params.name === 'get_execution') {
          const found = await executions.status(principal, String(args['workflowId'] ?? ''));
          const detail = found.status === 'RUNNING' || found.status === 'PAUSED' ? undefined : await executions.get(principal, found.workflowId);
          return result({ workflowId: found.workflowId, status: found.status, output: (detail?.output as JsonValue) ?? null, reason: found.reasonForIncompletion ?? null });
        }
        const target = tools.find((t) => t.tool === call.params.name);
        if (!target) return { content: [{ type: 'text' as const, text: `no tool "${call.params.name}"` }], isError: true };
        const outcome = await executions.execute(principal, target.workflow, { input: args, waitForSeconds: WAIT_SECONDS } as never);
        if (!outcome.reached) {
          return result({ workflowId: outcome.workflowId, status: outcome.status, note: 'still running; call get_execution with this workflowId for the result' });
        }
        return result(
          { workflowId: outcome.workflowId, status: outcome.status, output: (outcome.output as JsonValue) ?? null, reason: outcome.reasonForIncompletion ?? null },
          outcome.status !== 'COMPLETED'
        );
      } catch (error) {
        // A refused start — bad input, a limit — is the tool's answer, not a protocol error.
        const response = (error as { getResponse?: () => unknown }).getResponse?.();
        const message = (response as { message?: string })?.message ?? (error as Error).message;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  }

  /** The workflows this caller may run as tools, with names an MCP client accepts. */
  private async tools(principal: Principal) {
    const everything = { tagGrants: ['*'], can: () => true };
    const latest = new Map<string, { name: string; description: string | null; tags: string[] }>();
    for (const row of await this.metadata.listWorkflows(principal.namespaceId, everything)) {
      if (!latest.has(row.name)) latest.set(row.name, { name: row.name, description: row.description ?? null, tags: row.tags });
    }
    const out: { tool: string; workflow: string; description: string; inputSchema: Record<string, JsonValue> }[] = [];
    for (const workflow of latest.values()) {
      if (!workflow.tags.includes(MCP_TOOL_TAG)) continue;
      if (!mayUse(principal, 'EXECUTE', { name: workflow.name, tags: workflow.tags }, START_SCOPES)) continue;
      const definition = await this.metadata.getWorkflowDefinition(principal.namespaceId, workflow.name, everything);
      let schema = definition?.inputSchema ? await this.schemas.resolve(principal.namespaceId, definition.inputSchema).catch(() => undefined) : undefined;
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        schema = { type: 'object', properties: Object.fromEntries((definition?.inputParameters ?? []).map((p) => [p, {}])) };
      }
      let tool = workflow.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      for (let n = 2; out.some((t) => t.tool === tool) || tool === 'get_execution'; n++) tool = `${tool.slice(0, 60)}_${n}`;
      out.push({ tool, workflow: workflow.name, description: workflow.description ?? `Runs the ${workflow.name} workflow`, inputSchema: schema as Record<string, JsonValue> });
    }
    return out;
  }
}

function result(value: Record<string, JsonValue>, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value, isError };
}

@Module({ controllers: [McpGatewayController] })
export class McpGatewayModule {}
