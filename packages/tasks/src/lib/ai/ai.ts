import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { JsonValue } from '@node-flow-dev/core';
import type { EmbeddingModel, ImageModel, LanguageModel, SpeechModel } from 'ai';

/**
 * Video generation is still experimental in the AI SDK, and only a provider
 * that actually runs a long job exposes one. `VideoModel` is not re-exported
 * from `ai` under a stable name, so it is taken from the model the provider
 * hands back — the seam stays typed without pinning an experimental alias.
 */
export type VideoModel = ReturnType<ReturnType<typeof createGoogle>['video']>;

/**
 * The seams between the AI tasks and the rest of node-flow.
 *
 * `tasks` cannot import the store, so everything an AI task needs from it —
 * which provider an integration names, the key its secret holds, a prompt's
 * text, where vectors live, how to start a workflow — arrives through these.
 * They also make every executor testable without a database.
 */

export const LLM_PROVIDERS = ['openai', 'anthropic', 'google', 'openai_compatible'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export interface ResolvedLlmIntegration {
  name: string;
  provider: LlmProvider;
  baseUrl?: string;
  /** Resolved from the integration's secret at call time; never stored on a task. */
  apiKey?: string;
  /** Models the integration allows. Empty allows any. */
  models: string[];
}

export interface ResolvedMcpIntegration {
  name: string;
  url: string;
  headers: Record<string, string>;
}

export interface ResolvedPrompt {
  name: string;
  version: number;
  template: string;
}

export interface AiResolver {
  llm(namespaceId: string, name: string): Promise<ResolvedLlmIntegration | undefined>;
  mcp(namespaceId: string, name: string): Promise<ResolvedMcpIntegration | undefined>;
  prompt(namespaceId: string, name: string, version?: number): Promise<ResolvedPrompt | undefined>;
}

export interface VectorRecord {
  docId: string;
  chunk: number;
  text: string;
  metadata: Record<string, JsonValue>;
  embedding: number[];
  model?: string;
}

export interface VectorMatch {
  docId: string;
  chunk: number;
  text: string;
  metadata: Record<string, JsonValue>;
  score: number;
}

export interface VectorStore {
  upsert(namespaceId: string, indexName: string, records: VectorRecord[]): Promise<number>;
  search(namespaceId: string, indexName: string, embedding: number[], topK: number, minScore?: number): Promise<VectorMatch[]>;
}

/** Workflows an agent may call as tools. */
export interface WorkflowTools {
  /** The definition's description and input shape, or undefined when it does not exist. */
  describe(namespaceId: string, name: string): Promise<{ description?: string; inputSchema?: Record<string, JsonValue> } | undefined>;
  /** Starts a child run; idempotent on `idempotencyKey`, so a retried agent step starts it once. */
  start(namespaceId: string, name: string, input: Record<string, JsonValue>, idempotencyKey: string, parentWorkflowId: string): Promise<string>;
  status(namespaceId: string, workflowId: string): Promise<{ status: string; output?: Record<string, JsonValue>; reason?: string } | undefined>;
}

/** What the AI executors are built with. Absent seams disable the tasks that need them, loudly. */
export interface AiExecutorOptions {
  /** The HTTP guard settings, applied to any URL a task fetches (a document to parse). */
  http?: { allowPrivateAddresses?: boolean; allowedHosts?: string[] };
  resolver?: AiResolver;
  vectors?: VectorStore;
  workflows?: WorkflowTools;
  /** Replaces model construction — for tests, and for installs wrapping a gateway. */
  models?: ModelFactory;
}

export interface ModelFactory {
  language(integration: ResolvedLlmIntegration, model: string): LanguageModel;
  embedding(integration: ResolvedLlmIntegration, model: string): EmbeddingModel;
  image(integration: ResolvedLlmIntegration, model: string): ImageModel;
  speech(integration: ResolvedLlmIntegration, model: string): SpeechModel;
  video(integration: ResolvedLlmIntegration, model: string): VideoModel;
}

export const defaultModels: ModelFactory = {
  language(integration, model) {
    const { apiKey, baseUrl } = integration;
    switch (integration.provider) {
      case 'openai':
        return createOpenAI({ apiKey, baseURL: baseUrl })(model);
      case 'anthropic':
        return createAnthropic({ apiKey, baseURL: baseUrl })(model);
      case 'google':
        return createGoogle({ apiKey, baseURL: baseUrl })(model);
      case 'openai_compatible':
        return createOpenAICompatible({ name: integration.name, apiKey, baseURL: requireBaseUrl(integration) }).chatModel(model);
    }
  },
  embedding(integration, model) {
    const { apiKey, baseUrl } = integration;
    switch (integration.provider) {
      case 'openai':
        return createOpenAI({ apiKey, baseURL: baseUrl }).embedding(model);
      case 'google':
        return createGoogle({ apiKey, baseURL: baseUrl }).embedding(model);
      case 'openai_compatible':
        return createOpenAICompatible({ name: integration.name, apiKey, baseURL: requireBaseUrl(integration) }).embeddingModel(model);
      case 'anthropic':
        throw new AiTaskError(`"${integration.name}" is an Anthropic integration, and Anthropic offers no embedding models`, true);
    }
  },
  image(integration, model) {
    const { apiKey, baseUrl } = integration;
    switch (integration.provider) {
      case 'openai':
        return createOpenAI({ apiKey, baseURL: baseUrl }).image(model);
      case 'google':
        return createGoogle({ apiKey, baseURL: baseUrl }).image(model);
      case 'openai_compatible':
        return createOpenAICompatible({ name: integration.name, apiKey, baseURL: requireBaseUrl(integration) }).imageModel(model);
      case 'anthropic':
        throw new AiTaskError(`"${integration.name}" is an Anthropic integration, and Anthropic offers no image models`, true);
    }
  },
  speech(integration, model) {
    const { apiKey, baseUrl } = integration;
    switch (integration.provider) {
      case 'openai':
        return createOpenAI({ apiKey, baseURL: baseUrl }).speech(model);
      case 'google':
        return createGoogle({ apiKey, baseURL: baseUrl }).speech(model);
      case 'openai_compatible':
        // Speech is not part of the OpenAI-compatible surface the SDK models; the
        // OpenAI client pointed at the server speaks the same /audio/speech route.
        return createOpenAI({ apiKey, baseURL: requireBaseUrl(integration) }).speech(model);
      case 'anthropic':
        throw new AiTaskError(`"${integration.name}" is an Anthropic integration, and Anthropic offers no speech models`, true);
    }
  },
  video(integration, model) {
    const { apiKey, baseUrl } = integration;
    // Video is a start-and-poll API rather than one request, so it exists only
    // where a provider models it that way. Google is the one of ours that does;
    // naming the others plainly beats a generic "unsupported model" from deeper
    // inside the SDK.
    if (integration.provider !== 'google') {
      throw new AiTaskError(`"${integration.name}" is a ${integration.provider} integration; GENERATE_VIDEO needs a Google integration`, true);
    }
    return createGoogle({ apiKey, baseURL: baseUrl }).video(model);
  },
};

function requireBaseUrl(integration: ResolvedLlmIntegration): string {
  if (!integration.baseUrl) throw new AiTaskError(`integration "${integration.name}" needs a base URL`, true);
  return integration.baseUrl;
}

/** A failure with an answer to "would retrying help?". */
export class AiTaskError extends Error {
  constructor(
    message: string,
    readonly terminal = false
  ) {
    super(message);
  }
}

/** Loads an LLM integration and checks the model is one it allows. */
export async function requireLlm(
  options: AiExecutorOptions,
  namespaceId: string,
  input: Record<string, JsonValue>
): Promise<{ integration: ResolvedLlmIntegration; model: string }> {
  if (!options.resolver) throw new AiTaskError('AI tasks are not available on this server', true);
  const name = input['llmProvider'] ?? input['integration'];
  if (typeof name !== 'string' || name === '') throw new AiTaskError('requires "llmProvider", the name of an LLM integration', true);
  const integration = await options.resolver.llm(namespaceId, name);
  if (!integration) throw new AiTaskError(`no enabled LLM integration "${name}"`, true);
  const model = typeof input['model'] === 'string' && input['model'] !== '' ? input['model'] : integration.models[0];
  if (!model) throw new AiTaskError(`requires "model": integration "${name}" names no default`, true);
  if (integration.models.length > 0 && !integration.models.includes(model)) {
    throw new AiTaskError(`model "${model}" is not enabled on integration "${name}"; allowed: ${integration.models.join(', ')}`, true);
  }
  return { integration, model };
}

/**
 * Fills `${name}` placeholders from variables.
 *
 * A missing variable is an error rather than an empty string: a prompt that
 * silently lost its subject still gets an answer, and a confidently wrong one.
 * Values that are not strings are written as JSON.
 */
export function renderPrompt(template: string, variables: Record<string, JsonValue>): string {
  const missing: string[] = [];
  const text = template.replace(/\$\{\s*([\w.-]+)\s*\}/g, (_, key: string) => {
    const value = key.split('.').reduce<JsonValue | undefined>(
      (current, part) => (current && typeof current === 'object' && !Array.isArray(current) ? current[part] : undefined),
      variables
    );
    if (value === undefined) {
      missing.push(key);
      return '';
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
  if (missing.length > 0) throw new AiTaskError(`prompt variables missing: ${[...new Set(missing)].join(', ')}`, true);
  return text;
}

/** The distinct `${name}` placeholders in a template, in order. */
export function promptVariables(template: string): string[] {
  return [...new Set([...template.matchAll(/\$\{\s*([\w.-]+)\s*\}/g)].map((m) => m[1].split('.')[0]))];
}

/** Resolves the text a task sends: an inline `prompt`, or a stored `promptName` with variables. */
export async function promptText(options: AiExecutorOptions, namespaceId: string, input: Record<string, JsonValue>, inlineKey = 'prompt'): Promise<{ text?: string; promptVersion?: number }> {
  const variables = asRecord(input['promptVariables']);
  if (typeof input['promptName'] === 'string' && input['promptName'] !== '') {
    if (!options.resolver) throw new AiTaskError('AI tasks are not available on this server', true);
    const version = typeof input['promptVersion'] === 'number' ? input['promptVersion'] : undefined;
    const prompt = await options.resolver.prompt(namespaceId, input['promptName'], version);
    if (!prompt) throw new AiTaskError(`no prompt "${input['promptName']}"${version ? ` version ${version}` : ''}`, true);
    return { text: renderPrompt(prompt.template, variables), promptVersion: prompt.version };
  }
  const inline = input[inlineKey];
  if (typeof inline === 'string' && inline !== '') return { text: Object.keys(variables).length ? renderPrompt(inline, variables) : inline };
  return {};
}

export function asRecord(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function numberInput(input: Record<string, JsonValue>, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Token counts as plain JSON, for task output. */
export function usageOf(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined): Record<string, JsonValue> {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  };
}

/**
 * Classifies a provider error.
 *
 * Authentication and bad requests do not heal on retry; rate limits, timeouts
 * and 5xx do. An unknown error is treated as transient, because retrying a
 * permanent failure costs a little while giving up on a transient one loses work.
 */
export function failure(error: unknown): { status: 'FAILED'; reason: string; terminal: boolean } {
  if (error instanceof AiTaskError) return { status: 'FAILED', reason: error.message, terminal: error.terminal };
  const status = (error as { statusCode?: number })?.statusCode;
  const message = error instanceof Error ? error.message : String(error);
  const terminal = typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
  return { status: 'FAILED', reason: status ? `provider returned ${status}: ${message}` : message, terminal };
}
