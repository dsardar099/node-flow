import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { generateText, type ModelMessage } from 'ai';
import type { TaskContext, TaskExecutor, TaskOutcome } from '../executor.js';
import {
  AiTaskError,
  defaultModels,
  failure,
  numberInput,
  promptText,
  requireLlm,
  usageOf,
  type AiExecutorOptions,
} from './ai.js';
import { GuardedText, readGuardrails } from './guardrails.js';

/**
 * `LLM_TEXT_COMPLETE` and `LLM_CHAT_COMPLETE`.
 *
 * One model call per execution. The provider, its key and the models allowed
 * come from a named integration, so a definition names `llmProvider` and never
 * carries an endpoint or a credential. Retries, timeouts and rate limits are the
 * task definition's, like any system task — which is how a flaky provider is
 * handled without every workflow re-implementing backoff.
 *
 * `jsonOutput: true` parses the answer and fails the task when it is not JSON,
 * because the next task reading `${ask.output.result.field}` would otherwise get
 * nothing and carry on.
 */

abstract class LlmExecutor implements TaskExecutor {
  abstract readonly type: TaskType;

  constructor(protected readonly options: AiExecutorOptions = {}) {}

  protected abstract messages(context: TaskContext): Promise<{ system?: string; prompt?: string; messages?: ModelMessage[]; promptVersion?: number }>;

  async execute(context: TaskContext): Promise<TaskOutcome> {
    try {
      const { integration, model } = await requireLlm(this.options, context.namespaceId, context.input);
      const raw = await this.messages(context);
      const input = context.input;
      // Everything bound for the model passes the guardrails first, including the system prompt.
      const guard = new GuardedText(readGuardrails(input['guardrails']));
      const system = raw.system === undefined ? undefined : guard.input(raw.system);
      const prompt = raw.prompt === undefined ? undefined : guard.input(raw.prompt);
      const messages = raw.messages?.map((m) => (typeof m.content === 'string' ? ({ ...m, content: guard.input(m.content) } as ModelMessage) : m));
      const promptVersion = raw.promptVersion;
      const stop = input['stopWords'];

      const result = await generateText({
        model: (this.options.models ?? defaultModels).language(integration, model),
        ...(system ? { system } : {}),
        ...(messages ? { messages } : { prompt: prompt ?? '' }),
        temperature: numberInput(input, 'temperature'),
        topP: numberInput(input, 'topP'),
        maxOutputTokens: numberInput(input, 'maxTokens'),
        stopSequences: Array.isArray(stop) ? stop.filter((s): s is string => typeof s === 'string') : undefined,
        abortSignal: context.signal,
        // The task's own retry policy governs retries; the SDK retrying inside
        // one attempt would multiply them and hide the attempts from the history.
        maxRetries: 0,
      });
      guard.output(result.text);

      let value: JsonValue = result.text;
      if (input['jsonOutput'] === true) {
        try {
          value = JSON.parse(stripFence(result.text)) as JsonValue;
        } catch {
          return {
            status: 'FAILED',
            reason: 'jsonOutput was requested but the model did not answer with JSON',
            output: { text: result.text },
          };
        }
      }

      return {
        status: 'COMPLETED',
        output: {
          result: value,
          finishReason: result.finishReason,
          model,
          llmProvider: integration.name,
          usage: usageOf(result.usage),
          ...(promptVersion !== undefined ? { promptVersion } : {}),
          ...(guard.report() ? { guardrails: guard.report() as JsonValue } : {}),
        },
      };
    } catch (error) {
      return failure(error);
    }
  }
}

export class LlmTextCompleteExecutor extends LlmExecutor {
  readonly type = TaskType.LLM_TEXT_COMPLETE;

  protected async messages(context: TaskContext) {
    const { text, promptVersion } = await promptText(this.options, context.namespaceId, context.input);
    if (!text) throw new AiTaskError('LLM_TEXT_COMPLETE requires "prompt" or "promptName"', true);
    const instructions = context.input['instructions'];
    return { prompt: text, promptVersion, system: typeof instructions === 'string' && instructions ? instructions : undefined };
  }
}

export class LlmChatCompleteExecutor extends LlmExecutor {
  readonly type = TaskType.LLM_CHAT_COMPLETE;

  protected async messages(context: TaskContext) {
    // A stored prompt, or `instructions`, becomes the system message.
    const { text, promptVersion } = await promptText(this.options, context.namespaceId, context.input, 'instructions');
    const messages = chatMessages(context.input['messages']);
    if (messages.length === 0) throw new AiTaskError('LLM_CHAT_COMPLETE requires "messages": [{ "role": "user", "message": "..." }]', true);
    return { system: text, messages, promptVersion };
  }
}

/** Accepts Conductor's `{ role, message }` and the common `{ role, content }`. */
export function chatMessages(value: JsonValue | undefined): ModelMessage[] {
  if (!Array.isArray(value)) return [];
  const out: ModelMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const role = String(item['role'] ?? 'user').toLowerCase();
    const raw = item['message'] ?? item['content'];
    const content = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
    if (role === 'assistant' || role === 'model') out.push({ role: 'assistant', content });
    else if (role === 'system') out.push({ role: 'system', content });
    else out.push({ role: 'user', content });
  }
  return out;
}

/** Models wrap JSON in a markdown fence more often than not. */
function stripFence(text: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return match ? match[1] : text.trim();
}
