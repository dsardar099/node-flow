import { TaskExecutorRegistry } from './executor.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { HttpTaskExecutor, type HttpExecutorOptions } from './http.executor.js';
import { HttpPollTaskExecutor } from './http-poll.executor.js';
import { InlineTaskExecutor, type InlineExecutorOptions } from './inline.executor.js';
import { JqTaskExecutor, type JqExecutorOptions } from './jq.executor.js';
import { EmailTaskExecutor, type EmailExecutorOptions } from './email.executor.js';
import { SignedJwtTaskExecutor } from './jwt.executor.js';
import { SqlTaskExecutor, type SqlExecutorOptions } from './sql.executor.js';
import { GrpcTaskExecutor, type GrpcExecutorOptions } from './grpc.executor.js';
import { UpdateSecretTaskExecutor, type SecretWriter } from './update-secret.executor.js';
import { WebhookTaskExecutor } from './webhook.executor.js';
import type { AiExecutorOptions } from './ai/ai.js';
import { AgentExecutor } from './ai/agent.executor.js';
import { ChunkTextExecutor, GenerateEmbeddingsExecutor, IndexTextExecutor, SearchIndexExecutor } from './ai/embeddings.executor.js';
import { LlmChatCompleteExecutor, LlmTextCompleteExecutor } from './ai/llm.executor.js';
import { CallMcpToolExecutor, ListMcpToolsExecutor } from './ai/mcp.js';
import { GenerateAudioExecutor, GenerateImageExecutor, GenerateVideoExecutor, ParseDocumentExecutor } from './ai/media.executor.js';
import {
  BusinessRuleTaskExecutor,
  NoopTaskExecutor,
  UpdateTaskExecutor,
} from './simple.executors.js';

/**
 * The executors an install runs by default.
 *
 * A function rather than a shared singleton: two of these in one process — a
 * test and the application, say — must not fight over one mutable registry, and
 * a caller adding its own executor should not affect anyone else's.
 *
 * `WAIT` and `WAIT_FOR_WEBHOOK` are deliberately absent. Neither is *executed*
 * by anything — one ends when a clock says so, the other when a third party
 * calls back — so occupying an execution slot for the duration would be
 * wasteful and would cap concurrent waits at the pool size. They are handled by
 * the timer and callback machinery instead.
 */
export function defaultExecutors(
  options: {
    http?: HttpExecutorOptions;
    inline?: InlineExecutorOptions;
    jq?: JqExecutorOptions;
    sql?: SqlExecutorOptions;
    grpc?: GrpcExecutorOptions;
    /** Absent disables `UPDATE_SECRET`, which then fails loudly rather than silently. */
    secrets?: SecretWriter;
    /** SMTP transports for `EMAIL`. Absent, the task fails saying so rather than pretending to send. */
    email?: EmailExecutorOptions;
    /** Integrations, prompts, vectors and workflow tools. Absent, the AI tasks fail loudly. */
    ai?: AiExecutorOptions;
    /**
     * Shared by every task that leaves the process, so a host known to be down
     * is known to all of them. One breaker rather than one each: `HTTP` and
     * `HTTP_POLL` calling the same dying API should reach the same conclusion,
     * and they cannot if each keeps its own tally.
     */
    breaker?: CircuitBreaker;
  } = {}
) {
  const breaker = options.breaker;
  return new TaskExecutorRegistry()
    .register(new HttpTaskExecutor({ ...options.http, breaker }))
    // Same HTTP settings, so the SSRF guard covers the polled URL too.
    .register(new HttpPollTaskExecutor({ ...options.http, breaker, sandbox: options.inline }))
    .register(new InlineTaskExecutor(options.inline))
    .register(new JqTaskExecutor(options.jq))
    .register(new SignedJwtTaskExecutor())
    .register(new EmailTaskExecutor(options.email))
    .register(new SqlTaskExecutor(options.sql))
    .register(new GrpcTaskExecutor({ ...options.grpc, breaker }))
    .register(new UpdateSecretTaskExecutor(options.secrets))
    // Shares the HTTP settings: a webhook URL is user-supplied like any other,
    // so the SSRF guard has to apply to it too.
    .register(new WebhookTaskExecutor(options.http))
    .register(new NoopTaskExecutor())
    .register(new UpdateTaskExecutor())
    .register(new BusinessRuleTaskExecutor())
    .register(new LlmTextCompleteExecutor(options.ai))
    .register(new LlmChatCompleteExecutor(options.ai))
    .register(new GenerateEmbeddingsExecutor(options.ai))
    .register(new ChunkTextExecutor())
    .register(new IndexTextExecutor(options.ai))
    .register(new SearchIndexExecutor(options.ai))
    .register(new ListMcpToolsExecutor(options.ai))
    .register(new CallMcpToolExecutor(options.ai))
    .register(new AgentExecutor(options.ai))
    // Document fetching obeys the HTTP guard, so it takes the HTTP settings too.
    .register(new ParseDocumentExecutor({ ...options.ai, http: options.ai?.http ?? options.http }))
    .register(new GenerateImageExecutor(options.ai))
    .register(new GenerateAudioExecutor(options.ai))
    .register(new GenerateVideoExecutor(options.ai));
}
