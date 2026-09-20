import { generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';
import type { JsonValue } from '@node-flow-dev/core';
import { AiTaskError, defaultModels, requireLlm, type AiExecutorOptions } from './ai.js';

/**
 * The assistant: a model with read access to this namespace, and no hands.
 *
 * What makes an orchestration copilot useful is context — "why did run X fail",
 * "which workflow sends the refund email", "draft me one that polls an API".
 * What makes one dangerous is the same context plus the ability to act on it.
 *
 * So the tools here are **read-only, with one exception that is still not an
 * action**: `propose_workflow` validates a draft definition and hands it back.
 * Nothing registers, starts, retries or terminates anything. A model that can
 * terminate a production run on a misread is not a feature, and "we prompted it
 * not to" is not a control. Acting stays where it already is: a person, a
 * scoped API key, an audit entry.
 *
 * The caller's own permissions are applied by the functions passed in, not by
 * this loop — so the assistant can never see a workflow its user could not open
 * for themselves. That is enforced at the seam rather than by instruction,
 * because an instruction is a suggestion to a model.
 */

export interface AssistantContext {
  /** Workflow names and descriptions the caller may read. */
  listWorkflows(): Promise<{ name: string; description?: string | null; tags: string[] }[]>;
  /** One definition, as JSON, or undefined when it does not exist or is not theirs. */
  getWorkflow(name: string): Promise<JsonValue | undefined>;
  /** Recent executions matching a status and/or workflow name. */
  searchExecutions(query: { status?: string; workflow?: string; limit?: number }): Promise<JsonValue>;
  /** One execution with its tasks, for "why did this fail". */
  getExecution(workflowId: string): Promise<JsonValue | undefined>;
  /** Runs the same check registration runs. Never saves. */
  validateDefinition(definition: JsonValue): Promise<JsonValue>;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantAnswer {
  text: string;
  /** What it looked at, in order, so an answer can be checked rather than believed. */
  steps: { tool: string; input: JsonValue; summary: string }[];
  /** A definition it proposed, if it proposed one. Never registered. */
  proposal?: { definition: JsonValue; valid: boolean; issues?: JsonValue };
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM = `You help people build and debug workflows in node-flow, a workflow orchestrator.

Workflows are JSON: a list of tasks, each with "name", "taskReferenceName" and "type".
A task reads another task's output with \${ref.output.field}, and the workflow's input with \${workflow.input.field}.
Useful types: SIMPLE (a worker task), HTTP, INLINE, JSON_JQ_TRANSFORM, SWITCH, FORK_JOIN with JOIN, DO_WHILE, SUB_WORKFLOW, HUMAN, WAIT.

Use the tools to look things up rather than guessing: you can list and read workflows, search executions, read one execution, and validate a draft definition.
When you propose a workflow, call validate_definition first and fix what it reports.
You cannot start, retry, terminate or register anything — say so plainly if asked, and describe what the person should do instead.
Be concise. When you state a fact about this installation, it should be one a tool told you.`;

const MAX_STEPS = 8;

export async function askAssistant(
  options: AiExecutorOptions,
  context: AssistantContext,
  request: { namespaceId: string; llmProvider: string; model?: string; messages: AssistantTurn[] }
): Promise<AssistantAnswer> {
  const { integration, model } = await requireLlm(options, request.namespaceId, {
    llmProvider: request.llmProvider,
    ...(request.model ? { model: request.model } : {}),
  } as Record<string, JsonValue>);

  const steps: AssistantAnswer['steps'] = [];
  let proposal: AssistantAnswer['proposal'];

  const tools: ToolSet = {
    list_workflows: tool({
      description: 'List the workflows in this namespace with their descriptions and tags.',
      inputSchema: jsonSchema({ type: 'object', properties: {} } as never),
      execute: async () => record('list_workflows', {}, await context.listWorkflows()),
    }),
    get_workflow: tool({
      description: 'Read one workflow definition as JSON.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { name: { type: 'string', description: 'The workflow name' } },
        required: ['name'],
      } as never),
      execute: async ({ name }: { name: string }) =>
        record('get_workflow', { name }, (await context.getWorkflow(name)) ?? { error: `no workflow "${name}"` }),
    }),
    search_executions: tool({
      description: 'Find recent runs, optionally filtered by status (RUNNING, COMPLETED, FAILED, TIMED_OUT) or workflow name.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          status: { type: 'string' },
          workflow: { type: 'string' },
          limit: { type: 'number' },
        },
      } as never),
      execute: async (query: { status?: string; workflow?: string; limit?: number }) =>
        record('search_executions', query as JsonValue, await context.searchExecutions(query)),
    }),
    get_execution: tool({
      description: 'Read one execution with its tasks, to explain what happened in it.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { workflowId: { type: 'string' } },
        required: ['workflowId'],
      } as never),
      execute: async ({ workflowId }: { workflowId: string }) =>
        record(
          'get_execution',
          { workflowId },
          (await context.getExecution(workflowId)) ?? { error: `no execution ${workflowId}` }
        ),
    }),
    validate_definition: tool({
      description: 'Check a draft workflow definition. Returns whether it is valid and what is wrong. Saves nothing.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { definition: { type: 'object' } },
        required: ['definition'],
      } as never),
      execute: async ({ definition }: { definition: JsonValue }) => {
        const verdict = (await context.validateDefinition(definition)) as { valid?: boolean; issues?: JsonValue };
        // Remembered so the UI can offer "open this in the editor" without
        // parsing a definition back out of prose.
        proposal = { definition, valid: verdict?.valid === true, ...(verdict?.issues ? { issues: verdict.issues } : {}) };
        return record('validate_definition', { definition }, verdict as JsonValue);
      },
    }),
  };

  function record(name: string, input: JsonValue, result: unknown): JsonValue {
    const value = result as JsonValue;
    steps.push({ tool: name, input, summary: summarise(value) });
    return value;
  }

  const messages: ModelMessage[] = request.messages.map((turn) => ({ role: turn.role, content: turn.content }));
  if (messages.length === 0) throw new AiTaskError('the assistant needs at least one message', true);

  const result = await generateText({
    model: (options.models ?? defaultModels).language(integration, model),
    system: SYSTEM,
    messages,
    tools,
    // Bounded: a loop that can call tools forever is a way to spend a token
    // budget on a question nobody will wait for the answer to.
    stopWhen: ({ steps: taken }) => taken.length >= MAX_STEPS,
    maxRetries: 1,
  });

  return {
    text: result.text,
    steps,
    ...(proposal ? { proposal } : {}),
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    },
  };
}

/** A short description of a tool result, for the trace rather than the model. */
function summarise(value: JsonValue): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if ('error' in value) return String((value as Record<string, unknown>)['error']);
    if ('valid' in value) return (value as Record<string, unknown>)['valid'] === true ? 'valid' : 'not valid';
    return keys.slice(0, 4).join(', ');
  }
  return String(value).slice(0, 80);
}
