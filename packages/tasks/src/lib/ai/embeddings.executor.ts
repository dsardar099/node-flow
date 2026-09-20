import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { embedMany } from 'ai';
import type { TaskContext, TaskExecutor, TaskOutcome } from '../executor.js';
import { AiTaskError, asRecord, defaultModels, failure, numberInput, requireLlm, usageOf, type AiExecutorOptions } from './ai.js';

/**
 * Embeddings and retrieval: `LLM_GENERATE_EMBEDDINGS`, `CHUNK_TEXT`,
 * `LLM_INDEX_TEXT` and `LLM_SEARCH_INDEX`.
 *
 * Vectors live in Postgres, in named indexes per namespace, so retrieval needs
 * nothing else running. The embedding model is the integration's, and an index
 * searched with a different model than it was built with is refused by
 * dimension rather than returning nonsense scores.
 */

const MAX_TEXT = 1_000_000;

async function embed(options: AiExecutorOptions, context: TaskContext, values: string[]) {
  const { integration, model } = await requireLlm(options, context.namespaceId, {
    ...context.input,
    model: context.input['embeddingModel'] ?? context.input['model'] ?? null,
  });
  const result = await embedMany({
    model: (options.models ?? defaultModels).embedding(integration, model),
    values,
    abortSignal: context.signal,
    maxRetries: 0,
  });
  return { embeddings: result.embeddings, model, usage: usageOf(result.usage as never) };
}

function textsOf(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v !== '');
  return [];
}

export class GenerateEmbeddingsExecutor implements TaskExecutor {
  readonly type = TaskType.LLM_GENERATE_EMBEDDINGS;
  constructor(private readonly options: AiExecutorOptions = {}) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    try {
      const texts = textsOf(context.input['text'] ?? context.input['texts']);
      if (texts.length === 0) throw new AiTaskError('LLM_GENERATE_EMBEDDINGS requires "text" (a string or a list of strings)', true);
      const { embeddings, model, usage } = await embed(this.options, context, texts);
      return {
        status: 'COMPLETED',
        output: {
          // One text in, one vector out — the shape a single-text caller expects.
          result: typeof context.input['text'] === 'string' ? embeddings[0] : embeddings,
          dimensions: embeddings[0]?.length ?? 0,
          model,
          usage,
        },
      };
    } catch (error) {
      return failure(error);
    }
  }
}

/**
 * Splits text into overlapping chunks, preferring paragraph, then sentence,
 * then word boundaries, so a chunk does not end mid-word when it need not.
 */
export function chunkText(text: string, size = 1000, overlap = 100): string[] {
  if (size < 1) throw new AiTaskError('"chunkSize" must be at least 1', true);
  const step = Math.max(1, size - Math.min(Math.max(overlap, 0), size - 1));
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = [window.lastIndexOf('\n\n'), lastSentenceEnd(window), window.lastIndexOf(' ')].find((i) => i > size * 0.5);
      if (cut !== undefined) end = start + cut + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - (size - step), start + 1);
  }
  return chunks;
}

function lastSentenceEnd(text: string): number {
  const matches = [...text.matchAll(/[.!?](\s)/g)];
  const last = matches.at(-1);
  return last?.index ?? -1;
}

function chunkOptions(input: Record<string, JsonValue>) {
  return { size: numberInput(input, 'chunkSize') ?? 1000, overlap: numberInput(input, 'chunkOverlap') ?? 100 };
}

export class ChunkTextExecutor implements TaskExecutor {
  readonly type = TaskType.CHUNK_TEXT;

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const text = context.input['text'];
    if (typeof text !== 'string') return { status: 'FAILED', reason: 'CHUNK_TEXT requires a string "text"', terminal: true };
    if (text.length > MAX_TEXT) return { status: 'FAILED', reason: `CHUNK_TEXT accepts up to ${MAX_TEXT} characters`, terminal: true };
    try {
      const { size, overlap } = chunkOptions(context.input);
      const chunks = chunkText(text, size, overlap);
      return { status: 'COMPLETED', output: { result: chunks, count: chunks.length } };
    } catch (error) {
      return failure(error);
    }
  }
}

function indexName(input: Record<string, JsonValue>): string {
  const index = input['index'];
  if (typeof index !== 'string' || !/^[\w.-]{1,100}$/.test(index)) {
    throw new AiTaskError('requires "index": letters, digits, ".", "_" or "-", up to 100 characters', true);
  }
  return index;
}

export class IndexTextExecutor implements TaskExecutor {
  readonly type = TaskType.LLM_INDEX_TEXT;
  constructor(private readonly options: AiExecutorOptions = {}) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    try {
      if (!this.options.vectors) throw new AiTaskError('vector indexes are not available on this server', true);
      const index = indexName(context.input);
      const docId = context.input['docId'];
      if (typeof docId !== 'string' || docId === '') throw new AiTaskError('LLM_INDEX_TEXT requires "docId"', true);
      const text = context.input['text'];
      if (typeof text !== 'string' || text.trim() === '') throw new AiTaskError('LLM_INDEX_TEXT requires "text"', true);
      if (text.length > MAX_TEXT) throw new AiTaskError(`LLM_INDEX_TEXT accepts up to ${MAX_TEXT} characters`, true);

      const { size, overlap } = chunkOptions(context.input);
      const chunks = chunkText(text, size, overlap);
      const { embeddings, model, usage } = await embed(this.options, context, chunks);
      const metadata = asRecord(context.input['metadata']);
      const stored = await this.options.vectors.upsert(
        context.namespaceId,
        index,
        chunks.map((chunk, i) => ({ docId, chunk: i, text: chunk, metadata, embedding: embeddings[i], model }))
      );
      return { status: 'COMPLETED', output: { index, docId, chunks: stored, dimensions: embeddings[0]?.length ?? 0, model, usage } };
    } catch (error) {
      return failure(error);
    }
  }
}

export class SearchIndexExecutor implements TaskExecutor {
  readonly type = TaskType.LLM_SEARCH_INDEX;
  constructor(private readonly options: AiExecutorOptions = {}) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    try {
      if (!this.options.vectors) throw new AiTaskError('vector indexes are not available on this server', true);
      const index = indexName(context.input);
      const query = context.input['query'];
      if (typeof query !== 'string' || query.trim() === '') throw new AiTaskError('LLM_SEARCH_INDEX requires "query"', true);
      const topK = Math.min(Math.max(Math.trunc(numberInput(context.input, 'topK') ?? 5), 1), 100);

      const { embeddings, model } = await embed(this.options, context, [query]);
      const matches = await this.options.vectors.search(context.namespaceId, index, embeddings[0], topK, numberInput(context.input, 'minScore'));
      return {
        status: 'COMPLETED',
        output: {
          result: matches as unknown as JsonValue,
          // The usual next step pastes the matches into a prompt.
          context: matches.map((m) => m.text).join('\n\n'),
          count: matches.length,
          model,
        },
      };
    } catch (error) {
      return failure(error);
    }
  }
}
