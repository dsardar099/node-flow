import { TaskType, type JsonValue } from '@node-flow-dev/core';
import { experimental_getVideoStatus as getVideoStatus, experimental_startVideo as startVideo, generateImage, generateSpeech } from 'ai';
import type { TaskContext, TaskExecutor, TaskOutcome } from '../executor.js';
import { urlBlockedReason } from '../http.executor.js';
import { AiTaskError, defaultModels, failure, numberInput, promptText, requireLlm, type AiExecutorOptions, type VideoModel } from './ai.js';
import { GuardedText, readGuardrails } from './guardrails.js';

/**
 * `PARSE_DOCUMENT`, `GENERATE_IMAGE`, `GENERATE_AUDIO` and `GENERATE_VIDEO`.
 *
 * Generated files come back as base64 with their media type. Large ones are
 * moved to blob storage by the ordinary payload offload, so a run's history
 * holds a reference, not megabytes of image, and the next task still reads
 * `${image.output.images[0].base64}` as usual.
 */

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Text from an HTML page: scripts and styles dropped, blocks kept as line breaks, entities decoded. */
export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, '');
  const blocks = withoutNoise
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote|table|ul|ol)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return blocks
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, code: string) => {
      if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
      return entities[code.toLowerCase()] ?? match;
    })
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Parsed = { text: string; pages?: number };

async function parseBytes(bytes: Uint8Array, mediaType: string): Promise<Parsed> {
  const type = mediaType.split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    // pdf.js refuses a Node Buffer, which is a Uint8Array subclass; it wants the plain type.
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(pdf, { mergePages: false });
      return { text: text.map((page) => page.trim()).join('\n\n'), pages: totalPages };
    } catch (error) {
      // A corrupt file stays corrupt; retrying it only spends attempts.
      throw new AiTaskError(`not a readable PDF: ${(error as Error).message}`, true);
    }
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  if (type === 'text/html' || type === 'application/xhtml+xml') return { text: htmlToText(text) };
  if (type === 'application/json') {
    try {
      return { text: JSON.stringify(JSON.parse(text), null, 2) };
    } catch {
      return { text };
    }
  }
  if (type.startsWith('text/') || type === 'application/xml' || type === 'application/markdown' || type === '') return { text };
  throw new AiTaskError(`PARSE_DOCUMENT cannot read "${type}"; it reads PDF, HTML, JSON and text`, true);
}

function guessType(url: string, declared: string | null): string {
  if (declared && !declared.startsWith('application/octet-stream')) return declared;
  if (/\.pdf($|\?)/i.test(url)) return 'application/pdf';
  if (/\.html?($|\?)/i.test(url)) return 'text/html';
  if (/\.json($|\?)/i.test(url)) return 'application/json';
  return declared ?? 'text/plain';
}

export class ParseDocumentExecutor implements TaskExecutor {
  readonly type = TaskType.PARSE_DOCUMENT;

  constructor(
    private readonly options: AiExecutorOptions = {},
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    try {
      const input = context.input;
      let parsed: Parsed;
      let mediaType: string;
      let source: Record<string, JsonValue>;

      if (typeof input['base64'] === 'string') {
        mediaType = typeof input['mediaType'] === 'string' ? input['mediaType'] : 'application/octet-stream';
        const bytes = Buffer.from(input['base64'], 'base64');
        if (bytes.length > MAX_DOCUMENT_BYTES) throw new AiTaskError(`PARSE_DOCUMENT reads documents up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`, true);
        parsed = await parseBytes(bytes, mediaType);
        source = { bytes: bytes.length };
      } else if (typeof input['url'] === 'string' && input['url'] !== '') {
        const fetched = await this.fetchDocument(input['url'], context.signal);
        mediaType = guessType(fetched.url, fetched.mediaType);
        parsed = await parseBytes(fetched.bytes, mediaType);
        source = { url: fetched.url, bytes: fetched.bytes.length };
      } else {
        throw new AiTaskError('PARSE_DOCUMENT requires "url", or "base64" with "mediaType"', true);
      }

      const maxCharacters = numberInput(input, 'maxCharacters');
      const truncated = maxCharacters !== undefined && parsed.text.length > maxCharacters;
      const text = truncated ? parsed.text.slice(0, maxCharacters) : parsed.text;
      return {
        status: 'COMPLETED',
        output: {
          result: text,
          mediaType: mediaType.split(';')[0],
          characters: text.length,
          ...(parsed.pages !== undefined ? { pages: parsed.pages } : {}),
          ...(truncated ? { truncated: true } : {}),
          source,
        },
      };
    } catch (error) {
      return failure(error);
    }
  }

  /**
   * Fetches with the same SSRF guard as `HTTP`, checked on every redirect hop,
   * since a public URL redirecting to an internal one is the usual bypass.
   */
  private async fetchDocument(raw: string, signal: AbortSignal) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AiTaskError(`"${raw}" is not a valid absolute URL`, true);
    }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const blocked = await urlBlockedReason(url, this.options.http);
      if (blocked) throw new AiTaskError(`request ${blocked}`, true);
      const response = await this.fetchImpl(url, { redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        url = new URL(response.headers.get('location') as string, url);
        continue;
      }
      if (!response.ok) {
        throw new AiTaskError(`fetching the document returned ${response.status}`, response.status >= 400 && response.status < 500 && response.status !== 429);
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > MAX_DOCUMENT_BYTES) throw new AiTaskError(`the document is over ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`, true);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_DOCUMENT_BYTES) {
          await reader.cancel();
          throw new AiTaskError(`the document is over ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`, true);
        }
        chunks.push(value);
      }
      return { url: url.toString(), mediaType: response.headers.get('content-type'), bytes: Buffer.concat(chunks) };
    }
    throw new AiTaskError(`the document redirected more than ${MAX_REDIRECTS} times`, true);
  }
}

export class GenerateImageExecutor implements TaskExecutor {
  readonly type = TaskType.GENERATE_IMAGE;
  constructor(private readonly options: AiExecutorOptions = {}) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    try {
      const { integration, model } = await requireLlm(this.options, context.namespaceId, context.input);
      const { text } = await promptText(this.options, context.namespaceId, context.input);
      if (!text) throw new AiTaskError('GENERATE_IMAGE requires "prompt" or "promptName"', true);
      const guard = new GuardedText(readGuardrails(context.input['guardrails']));
      const size = context.input['size'];
      if (size !== undefined && (typeof size !== 'string' || !/^\d+x\d+$/.test(size))) throw new AiTaskError('"size" is WIDTHxHEIGHT, such as 1024x1024', true);
      const n = Math.min(Math.max(Math.trunc(numberInput(context.input, 'n') ?? 1), 1), 4);

      const result = await generateImage({
        model: (this.options.models ?? defaultModels).image(integration, model),
        prompt: guard.input(text),
        n,
        ...(size ? { size: size as `${number}x${number}` } : {}),
        abortSignal: context.signal,
        maxRetries: 0,
      });
      return {
        status: 'COMPLETED',
        output: {
          images: result.images.map((image) => ({ base64: image.base64, mediaType: image.mediaType })),
          count: result.images.length,
          model,
          ...(guard.report() ? { guardrails: guard.report() as JsonValue } : {}),
        },
      };
    } catch (error) {
      return failure(error);
    }
  }
}

export class GenerateAudioExecutor implements TaskExecutor {
  readonly type = TaskType.GENERATE_AUDIO;
  constructor(private readonly options: AiExecutorOptions = {}) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    try {
      const { integration, model } = await requireLlm(this.options, context.namespaceId, context.input);
      const text = context.input['text'];
      if (typeof text !== 'string' || text.trim() === '') throw new AiTaskError('GENERATE_AUDIO requires "text"', true);
      if (text.length > 10_000) throw new AiTaskError('GENERATE_AUDIO reads up to 10,000 characters', true);
      const guard = new GuardedText(readGuardrails(context.input['guardrails']));
      const voice = typeof context.input['voice'] === 'string' ? context.input['voice'] : undefined;
      const outputFormat = typeof context.input['format'] === 'string' ? context.input['format'] : undefined;

      const result = await generateSpeech({
        model: (this.options.models ?? defaultModels).speech(integration, model),
        text: guard.input(text),
        ...(voice ? { voice } : {}),
        ...(outputFormat ? { outputFormat } : {}),
        abortSignal: context.signal,
        maxRetries: 0,
      });
      return {
        status: 'COMPLETED',
        output: { audio: { base64: result.audio.base64, mediaType: result.audio.mediaType }, model, ...(guard.report() ? { guardrails: guard.report() as JsonValue } : {}) },
      };
    } catch (error) {
      return failure(error);
    }
  }
}

/** How often a running generation is checked, and how long it may take before the task gives up. */
const VIDEO_POLL_SECONDS = 15;
const VIDEO_DEADLINE_SECONDS = 30 * 60;

/**
 * `GENERATE_VIDEO`.
 *
 * Unlike an image or a sentence of speech, a video takes minutes, so the
 * provider's API is start-then-poll rather than one request. The task follows
 * that shape: the first pass starts the job and **yields** (`IN_PROGRESS`),
 * keeping only the provider's opaque operation handle in task state; later
 * passes check it. Holding an open HTTP request for ten minutes would tie up a
 * worker slot, and would lose the job entirely on a restart — the handle on the
 * task row survives both, and the generation keeps running on the provider's
 * side regardless of what happens here.
 *
 * The deadline is the task's own, not the provider's: a job that never reports
 * completion must fail rather than poll forever.
 */
export class GenerateVideoExecutor implements TaskExecutor {
  readonly type = TaskType.GENERATE_VIDEO;
  constructor(private readonly options: AiExecutorOptions = {}) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    try {
      const { integration, model } = await requireLlm(this.options, context.namespaceId, context.input);
      const videoModel = (this.options.models ?? defaultModels).video(integration, model);
      const started = context.state['video'];
      const resumed = started && typeof started === 'object' && !Array.isArray(started) ? (started as Record<string, JsonValue>) : undefined;

      if (!resumed) return await this.start(context, videoModel, model);
      return await this.check(context, videoModel, model, resumed);
    } catch (error) {
      return failure(error);
    }
  }

  private async start(context: TaskContext, model: VideoModel, modelName: string): Promise<TaskOutcome> {
    const input = context.input;
    const { text } = await promptText(this.options, context.namespaceId, input);
    if (!text) throw new AiTaskError('GENERATE_VIDEO requires "prompt" or "promptName"', true);
    const guard = new GuardedText(readGuardrails(input['guardrails']));

    const aspectRatio = input['aspectRatio'];
    if (aspectRatio !== undefined && (typeof aspectRatio !== 'string' || !/^(\d+:\d+|adaptive)$/.test(aspectRatio))) {
      throw new AiTaskError('"aspectRatio" is WIDTH:HEIGHT, such as 16:9, or "adaptive"', true);
    }
    const resolution = input['resolution'];
    if (resolution !== undefined && (typeof resolution !== 'string' || !/^\d+x\d+$/.test(resolution))) {
      throw new AiTaskError('"resolution" is WIDTHxHEIGHT, such as 1280x720', true);
    }
    const n = Math.min(Math.max(Math.trunc(numberInput(input, 'n') ?? 1), 1), 4);
    const durationSeconds = numberInput(input, 'durationSeconds');
    const fps = numberInput(input, 'fps');
    const seed = numberInput(input, 'seed');

    const { operation, warnings } = await startVideo({
      model,
      prompt: guard.input(text),
      n,
      ...(aspectRatio ? { aspectRatio: aspectRatio as `${number}:${number}` | 'adaptive' } : {}),
      ...(resolution ? { resolution: resolution as `${number}x${number}` } : {}),
      ...(durationSeconds !== undefined ? { duration: durationSeconds } : {}),
      ...(fps !== undefined ? { fps } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(typeof input['generateAudio'] === 'boolean' ? { generateAudio: input['generateAudio'] } : {}),
      abortSignal: context.signal,
      maxRetries: 0,
    });

    const state: Record<string, JsonValue> = {
      operation: operation as JsonValue,
      startedAt: new Date().toISOString(),
      polls: 0,
      deadlineSeconds: Math.max(Math.trunc(numberInput(input, 'maxWaitSeconds') ?? VIDEO_DEADLINE_SECONDS), VIDEO_POLL_SECONDS),
      ...(guard.report() ? { guardrails: guard.report() as JsonValue } : {}),
    };
    return {
      status: 'IN_PROGRESS',
      callbackAfterSeconds: Math.min(this.interval(context), state['deadlineSeconds'] as number),
      output: { video: state, generation: 'pending', model: modelName, ...(warnings.length > 0 ? { warnings: warnings.map((warning) => JSON.parse(JSON.stringify(warning)) as JsonValue) } : {}) },
    };
  }

  private async check(context: TaskContext, model: VideoModel, modelName: string, state: Record<string, JsonValue>): Promise<TaskOutcome> {
    const result = await getVideoStatus(model, { operation: state['operation'], abortSignal: context.signal, maxRetries: 0 });

    if (result.status === 'completed') {
      return {
        status: 'COMPLETED',
        output: {
          videos: result.videos.map((video) => videoJson(video)),
          count: result.videos.length,
          model: modelName,
          startedAt: state['startedAt'],
          ...(state['guardrails'] !== undefined ? { guardrails: state['guardrails'] } : {}),
        },
      };
    }

    const startedAt = Date.parse(String(state['startedAt']));
    const deadline = typeof state['deadlineSeconds'] === 'number' ? state['deadlineSeconds'] : VIDEO_DEADLINE_SECONDS;
    const waited = Math.round((Date.now() - startedAt) / 1000);
    if (Number.isFinite(startedAt) && waited >= deadline) {
      // Not terminal: the failure is "it took too long", and a retry gets a
      // fresh generation, which is a reasonable thing for a retry policy to try.
      return { status: 'FAILED', reason: `the video was still generating after ${waited}s`, output: { video: state, generation: 'timed_out' } };
    }

    const polls = (typeof state['polls'] === 'number' ? state['polls'] : 0) + 1;
    return {
      status: 'IN_PROGRESS',
      callbackAfterSeconds: this.interval(context),
      output: { video: { ...state, polls }, generation: 'pending', model: modelName },
    };
  }

  private interval(context: TaskContext): number {
    return Math.max(Math.trunc(numberInput(context.input, 'pollIntervalSeconds') ?? VIDEO_POLL_SECONDS), 1);
  }
}

/** A generated video as ordinary task output: a URL when the provider hosts it, base64 when it hands over bytes. */
function videoJson(video: { type: 'url'; url: string; mediaType: string } | { type: 'base64'; data: string; mediaType: string } | { type: 'binary'; data: Uint8Array; mediaType: string }): JsonValue {
  if (video.type === 'url') return { url: video.url, mediaType: video.mediaType };
  const base64 = video.type === 'base64' ? video.data : Buffer.from(video.data).toString('base64');
  return { base64, mediaType: video.mediaType };
}
