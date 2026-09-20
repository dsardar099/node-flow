import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { embedMany, generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';
import type { TaskContext, TaskExecutor, TaskOutcome } from '../executor.js';
import {
  AiTaskError,
  asRecord,
  defaultModels,
  failure,
  numberInput,
  promptText,
  requireLlm,
  type AiExecutorOptions,
  type ResolvedLlmIntegration,
} from './ai.js';
import { chatMessages } from './llm.executor.js';
import { GuardedText, readGuardrails } from './guardrails.js';
import { connectMcp, mcpText, type McpConnector, type McpSession } from './mcp.js';

/**
 * `AGENT` — a model that works towards a goal by calling tools.
 *
 * Tools are things node-flow already knows how to run:
 *  - `{ "type": "mcp", "mcpServer": "github", "include": ["search_issues"] }`,
 *    the tools of an MCP integration;
 *  - `{ "type": "workflow", "name": "refund_order" }`, a workflow definition,
 *    run as a child execution with its own history, retries and permissions;
 *  - `{ "type": "index", "index": "handbook" }`, retrieval over a vector index.
 *
 * ## Why the loop is ours and not the SDK's
 *
 * The SDK can run a tool loop in memory, and a crash would lose it. Here the
 * conversation lives in the task's state, so progress survives a restart. A
 * workflow tool is started with an idempotency key derived from the tool call,
 * so a replayed step never starts it twice. While that child runs, the task
 * **yields** (`IN_PROGRESS`) instead of holding an execution slot: an agent
 * waiting an hour on a human approval costs nothing.
 *
 * `maxSteps` bounds the model calls. Running out fails the task with the
 * transcript attached, rather than completing with a half-finished answer
 * that looks like a real one.
 */

interface AgentTool {
  /** The name the model sees: safe characters, unique within the agent. */
  exposed: string;
  kind: 'mcp' | 'workflow' | 'index';
  /** The MCP tool, workflow or index it maps to. */
  target: string;
  mcpServer?: string;
  description?: string;
  inputSchema: Record<string, JsonValue>;
  topK?: number;
}

interface PendingCall {
  toolCallId: string;
  toolName: string;
  input: Record<string, JsonValue>;
}

interface AgentState {
  messages: ModelMessage[];
  steps: StepRecord[];
  /** Tool calls from the current step not yet answered. */
  pending: PendingCall[];
  /** Results gathered for the current step so far. */
  results: ToolResult[];
  /** A workflow tool whose child run has not finished. */
  waiting?: { toolCallId: string; toolName: string; workflowId: string };
  usage: { inputTokens: number; outputTokens: number };
}

interface ToolResult {
  toolCallId: string;
  toolName: string;
  value: JsonValue;
  isError: boolean;
}

interface StepRecord {
  step: number;
  text: string;
  toolCalls: { toolName: string; input: JsonValue }[];
  toolResults?: { toolName: string; isError: boolean; workflowId?: string }[];
}

const TOOL_NAME = /[^a-zA-Z0-9_-]/g;
const POLL_SECONDS = 2;

export class AgentExecutor implements TaskExecutor {
  readonly type = TaskType.AGENT;

  constructor(
    private readonly options: AiExecutorOptions = {},
    private readonly connect: McpConnector = connectMcp
  ) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const sessions = new Map<string, McpSession>();
    let state: AgentState | undefined;
    try {
      const { integration, model } = await requireLlm(this.options, context.namespaceId, context.input);
      const maxSteps = Math.min(Math.max(Math.trunc(numberInput(context.input, 'maxSteps') ?? 10), 1), 50);
      const guard = new GuardedText(readGuardrails(context.input['guardrails']));
      const { text: rawInstructions } = await promptText(this.options, context.namespaceId, context.input, 'instructions');
      const instructions = rawInstructions === undefined ? undefined : guard.input(rawInstructions);
      const tools = await this.tools(context, sessions);
      state = this.restore(context, guard);

      if (state.waiting) {
        const settled = await this.settleWorkflow(context, state);
        if (!settled) return this.yieldFor(state);
      }

      while (true) {
        // Answer the calls the model made before starting another step.
        while (state.pending.length > 0) {
          const call = state.pending[0];
          const spec = tools.find((t) => t.exposed === call.toolName);
          const outcome = spec
            ? await this.runTool(context, integration, spec, call, sessions)
            : { value: `unknown tool "${call.toolName}"`, isError: true };
          if (outcome.workflowId) {
            state.waiting = { toolCallId: call.toolCallId, toolName: call.toolName, workflowId: outcome.workflowId };
            state.pending.shift();
            return this.yieldFor(state);
          }
          state.results.push({ toolCallId: call.toolCallId, toolName: call.toolName, value: outcome.value, isError: outcome.isError });
          state.pending.shift();
        }
        if (state.results.length > 0) this.closeStep(state);

        if (state.steps.length >= maxSteps) {
          return {
            status: 'FAILED',
            reason: `the agent did not finish within maxSteps (${maxSteps})`,
            terminal: true,
            output: this.output(state),
          };
        }

        const result = await generateText({
          model: (this.options.models ?? defaultModels).language(integration, model),
          ...(instructions ? { system: instructions } : {}),
          messages: state.messages,
          tools: toolSet(tools),
          temperature: numberInput(context.input, 'temperature'),
          abortSignal: context.signal,
          maxRetries: 0,
        });
        state.usage.inputTokens += result.usage.inputTokens ?? 0;
        state.usage.outputTokens += result.usage.outputTokens ?? 0;
        state.messages.push(...(result.responseMessages as ModelMessage[]));
        state.steps.push({
          step: state.steps.length + 1,
          text: result.text,
          toolCalls: result.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input as JsonValue })),
        });
        await context.heartbeat();

        if (result.toolCalls.length === 0) {
          guard.output(result.text);
          return {
            status: 'COMPLETED',
            output: { result: result.text, finishReason: result.finishReason, model, ...this.output(state), ...(guard.report() ? { guardrails: guard.report() as JsonValue } : {}) },
          };
        }
        state.pending = result.toolCalls.map((c) => ({ toolCallId: c.toolCallId, toolName: c.toolName, input: asRecord(c.input as JsonValue) }));
      }
    } catch (error) {
      const outcome = failure(error);
      return state ? { ...outcome, output: this.output(state) } : outcome;
    } finally {
      await Promise.allSettled([...sessions.values()].map((s) => s.close()));
    }
  }

  private restore(context: TaskContext, guard: GuardedText): AgentState {
    const saved = context.state['agent'];
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved as unknown as AgentState;

    // Guarded once, when the conversation starts; later passes resume what was already checked.
    const messages = chatMessages(context.input['messages']).map((m) => (typeof m.content === 'string' ? ({ ...m, content: guard.input(m.content) } as ModelMessage) : m));
    const prompt = context.input['prompt'];
    if (typeof prompt === 'string' && prompt !== '') messages.push({ role: 'user', content: guard.input(prompt) });
    if (messages.length === 0) throw new AiTaskError('AGENT requires "prompt" or "messages"', true);
    return { messages, steps: [], pending: [], results: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private yieldFor(state: AgentState): TaskOutcome {
    return {
      status: 'IN_PROGRESS',
      callbackAfterSeconds: POLL_SECONDS,
      output: { agent: state as unknown as JsonValue, ...this.output(state) },
    };
  }

  /** True once the awaited child run has finished and its result is recorded. */
  private async settleWorkflow(context: TaskContext, state: AgentState): Promise<boolean> {
    const waiting = state.waiting;
    if (!waiting || !this.options.workflows) return true;
    const run = await this.options.workflows.status(context.namespaceId, waiting.workflowId);
    if (!run) {
      state.results.push({ toolCallId: waiting.toolCallId, toolName: waiting.toolName, value: 'the workflow run no longer exists', isError: true });
    } else if (['RUNNING', 'PAUSED'].includes(run.status)) {
      return false;
    } else {
      const ok = run.status === 'COMPLETED';
      state.results.push({
        toolCallId: waiting.toolCallId,
        toolName: waiting.toolName,
        value: ok ? (run.output ?? {}) : `workflow ended ${run.status}${run.reason ? `: ${run.reason}` : ''}`,
        isError: !ok,
      });
    }
    state.waiting = undefined;
    return true;
  }

  private closeStep(state: AgentState): void {
    state.messages.push({
      role: 'tool',
      content: state.results.map((r) => ({
        type: 'tool-result' as const,
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        output: r.isError ? { type: 'error-text' as const, value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value) } : { type: 'json' as const, value: r.value },
      })),
    });
    const last = state.steps.at(-1);
    if (last) last.toolResults = state.results.map((r) => ({ toolName: r.toolName, isError: r.isError }));
    state.results = [];
  }

  private output(state: AgentState): Record<string, JsonValue> {
    return {
      steps: state.steps as unknown as JsonValue,
      stepCount: state.steps.length,
      usage: { inputTokens: state.usage.inputTokens, outputTokens: state.usage.outputTokens, totalTokens: state.usage.inputTokens + state.usage.outputTokens },
    };
  }

  private async tools(context: TaskContext, sessions: Map<string, McpSession>): Promise<AgentTool[]> {
    const specs = context.input['tools'];
    if (specs !== undefined && !Array.isArray(specs)) throw new AiTaskError('"tools" must be a list', true);
    const tools: AgentTool[] = [];
    const add = (candidate: AgentTool) => {
      let exposed = candidate.exposed.replace(TOOL_NAME, '_').slice(0, 64) || 'tool';
      for (let n = 2; tools.some((t) => t.exposed === exposed); n++) exposed = `${exposed.slice(0, 60)}_${n}`;
      tools.push({ ...candidate, exposed });
    };

    for (const raw of specs ?? []) {
      const spec = asRecord(raw);
      switch (spec['type']) {
        case 'mcp': {
          const server = spec['mcpServer'];
          if (typeof server !== 'string') throw new AiTaskError('an mcp tool needs "mcpServer"', true);
          const session = await this.session(context, server, sessions);
          const include = Array.isArray(spec['include']) ? spec['include'].map(String) : undefined;
          for (const t of await session.listTools()) {
            if (include && !include.includes(t.name)) continue;
            add({ exposed: t.name, kind: 'mcp', target: t.name, mcpServer: server, description: t.description, inputSchema: t.inputSchema });
          }
          break;
        }
        case 'workflow': {
          const name = spec['name'];
          if (typeof name !== 'string' || name === '') throw new AiTaskError('a workflow tool needs "name"', true);
          if (!this.options.workflows) throw new AiTaskError('workflow tools are not available on this server', true);
          const described = await this.options.workflows.describe(context.namespaceId, name);
          if (!described) throw new AiTaskError(`workflow tool "${name}" names no workflow definition`, true);
          add({
            exposed: typeof spec['toolName'] === 'string' ? spec['toolName'] : name,
            kind: 'workflow',
            target: name,
            description: typeof spec['description'] === 'string' ? spec['description'] : (described.description ?? `Runs the ${name} workflow`),
            inputSchema: described.inputSchema ?? { type: 'object', properties: {} },
          });
          break;
        }
        case 'index': {
          const index = spec['index'];
          if (typeof index !== 'string' || index === '') throw new AiTaskError('an index tool needs "index"', true);
          add({
            exposed: typeof spec['toolName'] === 'string' ? spec['toolName'] : `search_${index}`,
            kind: 'index',
            target: index,
            description: typeof spec['description'] === 'string' ? spec['description'] : `Searches the ${index} knowledge base and returns the most relevant passages`,
            inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for' } }, required: ['query'] },
            topK: typeof spec['topK'] === 'number' ? spec['topK'] : 5,
          });
          break;
        }
        default:
          throw new AiTaskError(`unknown tool type "${String(spec['type'])}"; use mcp, workflow or index`, true);
      }
    }
    return tools;
  }

  private async session(context: TaskContext, server: string, sessions: Map<string, McpSession>): Promise<McpSession> {
    const open = sessions.get(server);
    if (open) return open;
    if (!this.options.resolver) throw new AiTaskError('MCP tools are not available on this server', true);
    const integration = await this.options.resolver.mcp(context.namespaceId, server);
    if (!integration) throw new AiTaskError(`no enabled MCP integration "${server}"`, true);
    const session = await this.connect(integration, context.signal);
    sessions.set(server, session);
    return session;
  }

  private async runTool(
    context: TaskContext,
    integration: ResolvedLlmIntegration,
    spec: AgentTool,
    call: PendingCall,
    sessions: Map<string, McpSession>
  ): Promise<{ value: JsonValue; isError: boolean; workflowId?: string }> {
    try {
      switch (spec.kind) {
        case 'mcp': {
          const session = await this.session(context, spec.mcpServer as string, sessions);
          const result = await session.callTool(spec.target, call.input);
          return { value: result.structured ?? parseMaybe(mcpText(result.content)) ?? result.content, isError: result.isError };
        }
        case 'workflow': {
          const workflows = this.options.workflows as NonNullable<AiExecutorOptions['workflows']>;
          const workflowId = await workflows.start(context.namespaceId, spec.target, call.input, `agent:${context.taskId}:${call.toolCallId}`, context.workflowId);
          return { workflowId, value: null, isError: false };
        }
        case 'index': {
          if (!this.options.vectors) return { value: 'vector indexes are not available', isError: true };
          const query = call.input['query'];
          if (typeof query !== 'string' || !query) return { value: 'a "query" is required', isError: true };
          const embeddingModel = typeof context.input['embeddingModel'] === 'string' ? context.input['embeddingModel'] : undefined;
          if (!embeddingModel) return { value: 'this agent has no "embeddingModel" configured for search', isError: true };
          const { embeddings } = await embedMany({
            model: (this.options.models ?? defaultModels).embedding(integration, embeddingModel),
            values: [query],
            abortSignal: context.signal,
            maxRetries: 0,
          });
          const matches = await this.options.vectors.search(context.namespaceId, spec.target, embeddings[0], spec.topK ?? 5);
          return { value: matches.map((m) => ({ text: m.text, score: m.score, docId: m.docId, metadata: m.metadata })) as unknown as JsonValue, isError: false };
        }
      }
    } catch (error) {
      // A failing tool is information for the model, which may try another way;
      // it fails the task only if the model gives up.
      return { value: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

function toolSet(tools: AgentTool[]): ToolSet {
  return Object.fromEntries(
    tools.map((t) => [t.exposed, tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema as never) })])
  );
}

/** Tool text that is JSON goes back to the model as JSON, not as a quoted string of it. */
function parseMaybe(text: string): JsonValue | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}
