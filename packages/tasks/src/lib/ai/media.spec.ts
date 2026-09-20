import type { JsonValue } from '@node-flow-dev/core';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskContext, TaskOutcome } from '../executor.js';
import type { AiResolver } from './ai.js';
import { AgentExecutor } from './agent.executor.js';
import { GuardedText, readGuardrails } from './guardrails.js';
import { LlmChatCompleteExecutor, LlmTextCompleteExecutor } from './llm.executor.js';
import { GenerateAudioExecutor, GenerateImageExecutor, GenerateVideoExecutor, htmlToText, ParseDocumentExecutor } from './media.executor.js';
import { ONE_PIXEL_PNG, startMockOpenAi, type MockOpenAi } from './testing.js';

let openai: MockOpenAi;
let files: Server;
let filesUrl: string;

/** A minimal, valid PDF with one page per text, built with correct xref offsets. */
function pdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const fontId = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

beforeAll(async () => {
  openai = await startMockOpenAi();
  files = createServer((req, res) => {
    if (req.url === '/handbook.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return void res.end(pdf(['Refund policy', 'Shipping times']));
    }
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end('<html><head><title>x</title><style>p{}</style></head><body><h1>Returns</h1><p>Within 30&nbsp;days &amp; free.</p><script>alert(1)</script><ul><li>Unused</li><li>Boxed</li></ul></body></html>');
    }
    if (req.url === '/to-internal') {
      res.writeHead(302, { location: 'http://127.0.0.1:1/secret' });
      return void res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
  filesUrl = `http://localhost:${(files.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await openai?.close();
  await new Promise<void>((resolve) => files?.close(() => resolve()));
});

const resolver = (): AiResolver => ({
  llm: async (_ns, name) => (name === 'mock' ? { name, provider: 'openai_compatible', baseUrl: openai.url, apiKey: 'k', models: [] } : undefined),
  mcp: async () => undefined,
  prompt: async () => undefined,
});

const context = (input: Record<string, unknown>): TaskContext => ({
  taskId: 't',
  workflowId: 'w',
  namespaceId: 'ns',
  input: input as Record<string, JsonValue>,
  signal: new AbortController().signal,
  heartbeat: async () => undefined,
  state: {},
});

const output = (outcome: TaskOutcome) => ('output' in outcome ? (outcome.output ?? {}) : {}) as Record<string, any>;

describe('guardrails', () => {
  it('redacts PII before it leaves, counting but never recording what it removed', () => {
    const guard = new GuardedText(readGuardrails({ redactPII: true }));
    const text = guard.input('Ada <ada@example.com> paid with 4111 1111 1111 1111, call +44 20 7946 0958, SSN 123-45-6789, order 1234567890123');
    expect(text).toBe('Ada <[EMAIL REDACTED]> paid with [CARD REDACTED], call [PHONE REDACTED], SSN [SSN REDACTED], order 1234567890123');
    expect(guard.report()).toEqual({ redacted: { email: 1, card: 1, phone: 1, ssn: 1 } });
  });

  it('redacts only the kinds asked for', () => {
    const guard = new GuardedText(readGuardrails({ redactPII: ['email'] }));
    expect(guard.input('a@b.io 123-45-6789')).toBe('[EMAIL REDACTED] 123-45-6789');
  });

  it('blocks terms as whole words or regular expressions, and caps size', () => {
    const guard = new GuardedText(readGuardrails({ blockedTerms: ['pass word', '/api[_-]?key/i'], maxInputCharacters: 50 }));
    expect(guard.input('a passwordless login')).toBe('a passwordless login');
    expect(() => guard.input('my Pass  Word is')).toThrow(/blocked term \(pass word\)/);
    expect(() => new GuardedText(readGuardrails({ blockedTerms: ['/api[_-]?key/i'] })).input('the API-KEY')).toThrow(/blocked term/);
    expect(() => guard.input('x'.repeat(60))).toThrow(/maxInputCharacters/);
    expect(() => readGuardrails({ redactPII: ['passport'] })).toThrow(/redactPII/);
  });

  it('sends the redacted prompt, and withholds an answer containing a blocked term', async () => {
    const executor = new LlmChatCompleteExecutor({ resolver: resolver() });
    const outcome = await executor.execute(
      context({ llmProvider: 'mock', model: 'm', messages: [{ role: 'user', content: 'refund ada@example.com' }], guardrails: { redactPII: true } })
    );
    expect(output(outcome)).toMatchObject({ result: 'echo: refund [EMAIL REDACTED]', guardrails: { redacted: { email: 1 } } });
    expect(JSON.stringify(openai.requests)).not.toContain('ada@example.com');

    const withheld = await new LlmTextCompleteExecutor({ resolver: resolver() }).execute(
      context({ llmProvider: 'mock', model: 'm', prompt: 'we guarantee delivery', guardrails: { blockedOutputTerms: ['guarantee'] } })
    );
    expect(withheld).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/withheld/) });
    expect(JSON.stringify(withheld)).not.toContain('echo:');
  });

  it('guards an agent’s opening prompt', async () => {
    const before = openai.requests.length;
    const outcome = await new AgentExecutor({ resolver: resolver() }).execute(
      context({ llmProvider: 'mock', model: 'm', prompt: 'reset my password please', guardrails: { blockedTerms: ['password'] } })
    );
    expect(outcome).toMatchObject({ status: 'FAILED', terminal: true });
    expect(openai.requests.length).toBe(before);
  });
});

describe('PARSE_DOCUMENT', () => {
  const allowLocal = { http: { allowedHosts: ['localhost'] } };

  it('turns HTML into readable text', () => {
    expect(htmlToText('<h1>Returns</h1><p>Within 30&nbsp;days &amp; free.</p><script>x()</script><ul><li>A</li><li>B</li></ul>')).toBe(
      'Returns\n\nWithin 30 days & free.\n\n• A\n\n• B'
    );
  });

  it('reads a PDF by URL, page by page', async () => {
    const outcome = await new ParseDocumentExecutor(allowLocal).execute(context({ url: `${filesUrl}/handbook.pdf` }));
    expect(output(outcome)).toMatchObject({ mediaType: 'application/pdf', pages: 2, result: 'Refund policy\n\nShipping times' });
  });

  it('reads HTML by URL and base64 content directly, and truncates on request', async () => {
    const page = output(await new ParseDocumentExecutor(allowLocal).execute(context({ url: `${filesUrl}/page`, maxCharacters: 7 })));
    expect(page).toMatchObject({ result: 'Returns', truncated: true, mediaType: 'text/html' });
    const inline = output(await new ParseDocumentExecutor().execute(context({ base64: Buffer.from('{"a":1}').toString('base64'), mediaType: 'application/json' })));
    expect(inline['result']).toBe('{\n  "a": 1\n}');
  });

  // The same SSRF guard as HTTP, on the first request and on every redirect.
  it('refuses private addresses, including behind a redirect, and unreadable types', async () => {
    expect(await new ParseDocumentExecutor().execute(context({ url: `${filesUrl}/page` }))).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/blocked/) });
    expect(await new ParseDocumentExecutor(allowLocal).execute(context({ url: `${filesUrl}/to-internal` }))).toMatchObject({ status: 'FAILED', reason: expect.stringMatching(/127\.0\.0\.1.*blocked/) });
    expect(await new ParseDocumentExecutor().execute(context({ url: 'file:///etc/passwd' }))).toMatchObject({ status: 'FAILED', reason: expect.stringMatching(/only http and https/) });
    expect(await new ParseDocumentExecutor().execute(context({ base64: 'AAAA', mediaType: 'image/png' }))).toMatchObject({ status: 'FAILED', reason: expect.stringMatching(/cannot read "image\/png"/) });
    expect(await new ParseDocumentExecutor().execute(context({ base64: Buffer.from('%PDF-1.4 garbage').toString('base64'), mediaType: 'application/pdf' }))).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/not a readable PDF/) });
  });
});

describe('media generation', () => {
  it('generates images as base64 with their media type', async () => {
    const outcome = await new GenerateImageExecutor({ resolver: resolver() }).execute(context({ llmProvider: 'mock', model: 'mock-image', prompt: 'a parcel', n: 2, size: '256x256' }));
    expect(output(outcome)).toMatchObject({ count: 2, images: [{ base64: ONE_PIXEL_PNG, mediaType: 'image/png' }, { base64: ONE_PIXEL_PNG }] });
    expect(await new GenerateImageExecutor({ resolver: resolver() }).execute(context({ llmProvider: 'mock', model: 'x', prompt: 'p', size: 'huge' }))).toMatchObject({ status: 'FAILED', terminal: true });
  });

  it('generates speech', async () => {
    const outcome = await new GenerateAudioExecutor({ resolver: resolver() }).execute(context({ llmProvider: 'mock', model: 'mock-tts', text: 'Your parcel has shipped', voice: 'alloy' }));
    expect(Buffer.from(output(outcome)['audio']['base64'], 'base64').toString()).toBe('ID3mock-audio');
    expect(openai.requests.at(-1)).toMatchObject({ model: 'speech', messages: [{ content: 'Your parcel has shipped' }] });
  });
});

describe('video generation', () => {
  /**
   * A provider that takes two checks to finish, which is the whole point of the
   * task: the first pass must hand back a handle and let go of its slot rather
   * than waiting.
   */
  const fakeVideo = (options: { pendingChecks: number; onStart?: (call: Record<string, any>) => void }) => {
    let checks = 0;
    const model = {
      specificationVersion: 'v4' as const,
      provider: 'fake',
      modelId: 'veo-fake',
      maxVideosPerCall: 1,
      doStart: async (call: Record<string, any>) => {
        options.onStart?.(call);
        return { operation: { jobId: 'job-1' }, warnings: [], response: { timestamp: new Date(), modelId: 'veo-fake', headers: undefined } };
      },
      doStatus: async ({ operation }: { operation: any }) => {
        expect(operation).toEqual({ jobId: 'job-1' });
        if (checks++ < options.pendingChecks) {
          return { status: 'pending' as const, response: { timestamp: new Date(), modelId: 'veo-fake', headers: undefined } };
        }
        return {
          status: 'completed' as const,
          videos: [{ type: 'binary' as const, data: new Uint8Array([0, 1, 2, 3]), mediaType: 'video/mp4' }],
          warnings: [],
          response: { timestamp: new Date(), modelId: 'veo-fake', headers: undefined },
        };
      },
    };
    return { model, calls: () => checks };
  };

  const models = (video: any) => ({
    language: () => { throw new Error('not used'); },
    embedding: () => { throw new Error('not used'); },
    image: () => { throw new Error('not used'); },
    speech: () => { throw new Error('not used'); },
    video: () => video,
  }) as any;

  it('starts the job, yields while it runs, and completes when the provider is done', async () => {
    let started: Record<string, any> | undefined;
    const fake = fakeVideo({ pendingChecks: 1, onStart: (call) => (started = call) });
    const executor = new GenerateVideoExecutor({ resolver: resolver(), models: models(fake.model) });

    const input = { llmProvider: 'mock', model: 'veo-fake', prompt: 'a parcel arriving', aspectRatio: '16:9', durationSeconds: 4, pollIntervalSeconds: 2 };
    const first = await executor.execute(context(input));
    expect(first).toMatchObject({ status: 'IN_PROGRESS', callbackAfterSeconds: 2 });
    expect(output(first)['video']['operation']).toEqual({ jobId: 'job-1' });
    expect(started).toMatchObject({ aspectRatio: '16:9', duration: 4 });

    // The next pass knows nothing except what was persisted.
    const resume = { ...context(input), state: output(first) };
    const second = await executor.execute(resume);
    expect(second).toMatchObject({ status: 'IN_PROGRESS' });
    expect(output(second)['video']['polls']).toBe(1);

    const third = await executor.execute({ ...context(input), state: output(second) });
    expect(third.status).toBe('COMPLETED');
    expect(output(third)).toMatchObject({ count: 1, videos: [{ base64: Buffer.from([0, 1, 2, 3]).toString('base64'), mediaType: 'video/mp4' }] });
  });

  it('gives up on a job that never finishes, and refuses a provider with no video models', async () => {
    const fake = fakeVideo({ pendingChecks: 100 });
    const executor = new GenerateVideoExecutor({ resolver: resolver(), models: models(fake.model) });
    const input = { llmProvider: 'mock', model: 'veo-fake', prompt: 'a parcel', maxWaitSeconds: 60 };

    const first = await executor.execute(context(input));
    const stale = { ...(output(first)['video'] as Record<string, any>), startedAt: new Date(Date.now() - 120_000).toISOString() };
    const timedOut = await executor.execute({ ...context(input), state: { video: stale } });
    expect(timedOut).toMatchObject({ status: 'FAILED', reason: expect.stringMatching(/still generating after 12\ds/) });
    expect(output(timedOut)['generation']).toBe('timed_out');

    // The default factory only builds a video model where one exists.
    const openaiOnly = await new GenerateVideoExecutor({ resolver: resolver() }).execute(context(input));
    expect(openaiOnly).toMatchObject({ status: 'FAILED', terminal: true, reason: expect.stringMatching(/needs a Google integration/) });
  });
});
