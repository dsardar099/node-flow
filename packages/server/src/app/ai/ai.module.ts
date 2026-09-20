import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ErrorCode, Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import {
  INTEGRATION_KINDS,
  IntegrationRepository,
  PromptRepository,
  SecretRepository,
  VectorRepository,
  httpServiceResolver,
  readOpenApi,
  type Integration,
} from '@node-flow-dev/store';
import {
  HttpTaskExecutor,
  IndexTextExecutor,
  ListMcpToolsExecutor,
  LlmTextCompleteExecutor,
  SearchIndexExecutor,
  promptVariables,
  renderPrompt,
  urlBlockedReason,
  type AiExecutorOptions,
  type TaskOutcome,
} from '@node-flow-dev/tasks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { AI_EXECUTOR_OPTIONS } from '../database/database.module.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * AI: integrations, prompts and vector indexes.
 *
 * Integrations are administered — they hold where requests go and which secret
 * authorises them — while prompts and indexes are content that workflow
 * authors own, under `workflows:*` like the definitions that use them.
 *
 * The "test" routes run the same executors a task would, so a green test here
 * means a task configured the same way will work.
 */

const integrationSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  provider: z.string().min(1).max(50),
  description: z.string().max(1000).nullish(),
  baseUrl: z.string().max(2000).nullish(),
  apiKeySecret: z.string().max(200).nullish(),
  models: z.array(z.string().min(1).max(200)).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const promptSchema = z.object({
  template: z.string().min(1).max(100_000),
  description: z.string().max(1000).nullish(),
  models: z.array(z.string().min(1).max(200)).max(50).optional(),
});

const runSchema = z.object({
  llmProvider: z.string().min(1),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32_000).optional(),
});

const promptTestSchema = runSchema.extend({
  template: z.string().min(1).max(100_000).optional(),
  name: z.string().min(1).optional(),
  version: z.number().int().min(1).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  instructions: z.string().max(10_000).optional(),
});

const embedSchema = z.object({ llmProvider: z.string().min(1), embeddingModel: z.string().min(1).optional() });

const indexSchema = embedSchema.extend({
  docId: z.string().min(1).max(500),
  text: z.string().min(1).max(1_000_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  chunkSize: z.number().int().min(50).max(20_000).optional(),
  chunkOverlap: z.number().int().min(0).max(5_000).optional(),
});

const searchSchema = embedSchema.extend({
  query: z.string().min(1).max(10_000),
  topK: z.number().int().min(1).max(100).optional(),
  minScore: z.number().min(-1).max(1).optional(),
});

function context(principal: Principal, input: Record<string, unknown>) {
  return {
    taskId: `api-${randomUUID()}`,
    workflowId: '',
    namespaceId: principal.namespaceId,
    input: input as Record<string, JsonValue>,
    signal: AbortSignal.timeout(60_000),
    heartbeat: async () => undefined,
    state: {},
  };
}

/** A task outcome as an API answer: the output on success, the reason otherwise — never a 500 for a provider's error. */
function answer(outcome: TaskOutcome, startedAt: number) {
  const latencyMs = Date.now() - startedAt;
  if (outcome.status === 'COMPLETED') return { ok: true, latencyMs, output: outcome.output ?? {} };
  if (outcome.status === 'FAILED') return { ok: false, latencyMs, reason: outcome.reason, ...(outcome.output ? { output: outcome.output } : {}) };
  return { ok: false, latencyMs, reason: 'the task did not finish in one call' };
}

const MASK = '••••';

const notFound = (what: string, name: string) => new NotFoundException({ error: ErrorCode.NOT_FOUND, message: `no ${what} "${name}"` });

@Controller('ns/:ns/integrations')
export class IntegrationController {
  constructor(
    private readonly integrations: IntegrationRepository,
    private readonly secrets: SecretRepository,
    @Inject(AI_EXECUTOR_OPTIONS) private readonly ai: AiExecutorOptions,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /** Readable by workflow authors, who pick an integration by name; never carries a key. */
  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List integrations', tags: ['ai'], query: z.object({ kind: z.enum(INTEGRATION_KINDS).optional() }) })
  async list(@CurrentPrincipal() principal: Principal, @Query('kind') kind?: (typeof INTEGRATION_KINDS)[number]) {
    const all = await this.integrations.list(principal.namespaceId, kind);
    const known = new Set((await this.secrets.list(principal.namespaceId)).map((s) => s.name));
    return { integrations: all.map((i) => present(i, known)) };
  }

  @Get(':name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Fetch an integration', tags: ['ai'] })
  async get(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const found = await this.integrations.get(principal.namespaceId, name);
    if (!found) throw notFound('integration', name);
    const known = new Set((await this.secrets.list(principal.namespaceId)).map((s) => s.name));
    return present(found, known);
  }

  @Audited('integration', 'update')
  @Put(':name')
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Create or replace an integration', tags: ['ai'], body: integrationSchema })
  async put(@CurrentPrincipal() principal: Principal, @Param('name') name: string, @Body(zodBody(integrationSchema)) body: z.infer<typeof integrationSchema>) {
    const config = { ...((body.config ?? {}) as Record<string, JsonValue>) };
    const headers = config['headers'];
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      // A form round-trips the masked values it was shown; those mean "unchanged".
      const previous = ((await this.integrations.get(principal.namespaceId, name))?.config['headers'] ?? {}) as Record<string, string>;
      config['headers'] = Object.fromEntries(
        Object.entries(headers).flatMap(([key, value]) => (value === MASK ? (key in previous ? [[key, previous[key]]] : []) : [[key, value]]))
      );
    }
    const saved = await this.integrations.put(principal.namespaceId, { ...body, name, config }, principal.name);
    const known = new Set((await this.secrets.list(principal.namespaceId)).map((s) => s.name));
    return present(saved, known);
  }

  @Audited('integration', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Delete an integration', tags: ['ai'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    if (!(await this.integrations.delete(principal.namespaceId, name))) throw notFound('integration', name);
  }

  /** Makes one tiny request: a completion for an LLM, a tool listing for an MCP server. */
  @Post(':name/test')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Check an integration works', tags: ['ai'], body: z.object({ model: z.string().optional() }) })
  async test(@CurrentPrincipal() principal: Principal, @Param('name') name: string, @Body() body: { model?: string } = {}) {
    const found = await this.integrations.get(principal.namespaceId, name);
    if (!found) throw notFound('integration', name);
    const startedAt = Date.now();
    if (found.kind === 'MCP') {
      return answer(await new ListMcpToolsExecutor(this.ai).execute(context(principal, { mcpServer: name })), startedAt);
    }
    if (found.kind === 'HTTP') {
      // A HEAD on the base URL: enough to say "this host answers and the
      // network allows it" without assuming any path exists.
      const outcome = await new HttpTaskExecutor({
        allowPrivateAddresses: this.config.NODE_FLOW_HTTP_ALLOW_PRIVATE,
        allowedHosts: this.config.NODE_FLOW_HTTP_ALLOWED_HOSTS,
        services: httpServiceResolver(this.integrations, this.secrets),
      }).execute(context(principal, { service: name, method: 'HEAD', path: '/' }));
      return answer(outcome, startedAt);
    }

    return answer(
      await new LlmTextCompleteExecutor(this.ai).execute(
        context(principal, { llmProvider: name, model: body?.model, prompt: 'Reply with the single word OK.', maxTokens: 16 })
      ),
      startedAt
    );
  }

  /**
   * What the service says it offers.
   *
   * Discovery, not enforcement: the document describes the remote service, and
   * a stale one must never block a call that works. The editor uses it to offer
   * paths and parameters instead of asking an author to remember them.
   */
  @Get(':name/operations')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({
    summary: 'List the operations an HTTP service publishes',
    description: 'Reads the integration’s OpenAPI document, inline or by URL.',
    tags: ['ai'],
  })
  async operations(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const found = await this.integrations.get(principal.namespaceId, name);
    if (!found) throw notFound('integration', name);
    if (found.kind !== 'HTTP') {
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: `"${name}" is a ${found.kind} integration; only HTTP services publish operations`,
      });
    }

    const inline = found.config['openapi'];
    if (inline !== undefined && inline !== null) return readOpenApi(inline);

    const url = found.config['openapiUrl'];
    if (typeof url !== 'string' || url === '') {
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: `service "${name}" has no "openapiUrl" and no inline "openapi" document`,
      });
    }

    return readOpenApi(await this.fetchDocument(url, principal.namespaceId, found.name));
  }

  /**
   * Fetches the document through the same SSRF guard a task would get.
   *
   * The URL comes from an administrator rather than a definition, but an
   * administrator is not a reason to let the server fetch `169.254.169.254`
   * and hand the result back over the API.
   */
  private async fetchDocument(url: string, namespaceId: string, service: string): Promise<unknown> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException({ error: ErrorCode.INVALID_ARGUMENT, message: `"${url}" is not a valid URL` });
    }

    const blocked = await urlBlockedReason(parsed, {
      allowPrivateAddresses: this.config.NODE_FLOW_HTTP_ALLOW_PRIVATE,
      allowedHosts: this.config.NODE_FLOW_HTTP_ALLOWED_HOSTS,
    });
    if (blocked) throw new BadRequestException({ error: ErrorCode.INVALID_ARGUMENT, message: `fetching the document ${blocked}` });

    // The service's own headers, so a document behind the same key as the API
    // can be read without configuring the credential twice.
    const resolved = await httpServiceResolver(this.integrations, this.secrets).httpService(namespaceId, service);

    const response = await fetch(parsed, {
      headers: { accept: 'application/json', ...(resolved?.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    }).catch((error: Error) => {
      throw new BadRequestException({ error: ErrorCode.INVALID_ARGUMENT, message: `could not fetch the document: ${error.message}` });
    });

    if (!response.ok) {
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: `fetching the document returned ${response.status}`,
      });
    }

    return response.json().catch(() => {
      // YAML is the other half of OpenAPI in the wild, and a parser for it is a
      // dependency this does not need — saying so beats a confusing failure.
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: 'the document is not JSON; node-flow reads JSON OpenAPI documents, so point "openapiUrl" at the JSON form',
      });
    });
  }
}

function present(integration: Integration, knownSecrets: Set<string>) {
  const { id: _id, ...rest } = integration;
  const headers = (integration.config['headers'] ?? {}) as Record<string, string>;
  return {
    ...rest,
    // Header values can be credentials someone pasted; the names are what a reader needs.
    config: { ...integration.config, headers: Object.fromEntries(Object.keys(headers).map((k) => [k, MASK])) },
    // "Configured but broken" is the first question when a task fails with an auth error.
    apiKeySecretExists: integration.apiKeySecret ? knownSecrets.has(integration.apiKeySecret) : null,
  };
}

@Controller('ns/:ns/prompts')
export class PromptController {
  constructor(
    private readonly prompts: PromptRepository,
    @Inject(AI_EXECUTOR_OPTIONS) private readonly ai: AiExecutorOptions
  ) {}

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List prompts (latest versions)', tags: ['ai'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { prompts: await this.prompts.list(principal.namespaceId) };
  }

  @Get(':name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Every version of a prompt, newest first', tags: ['ai'] })
  async versions(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const versions = await this.prompts.versions(principal.namespaceId, name);
    if (versions.length === 0) throw notFound('prompt', name);
    return { name, versions };
  }

  @Audited('prompt', 'update')
  @Post(':name')
  @HttpCode(201)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Save a new version of a prompt', tags: ['ai'], body: promptSchema })
  async save(@CurrentPrincipal() principal: Principal, @Param('name') name: string, @Body(zodBody(promptSchema)) body: z.infer<typeof promptSchema>) {
    return this.prompts.save(principal.namespaceId, { ...body, name }, principal.name);
  }

  @Audited('prompt', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete a prompt and all its versions', tags: ['ai'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    if (!(await this.prompts.delete(principal.namespaceId, name))) throw notFound('prompt', name);
  }

  /** Renders a template (saved or draft) with variables and sends it, without saving anything. */
  @Post('-/test')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Run a prompt against a model', tags: ['ai'], body: promptTestSchema })
  async test(@CurrentPrincipal() principal: Principal, @Body(zodBody(promptTestSchema)) body: z.infer<typeof promptTestSchema>) {
    let template = body.template;
    if (!template && body.name) {
      const saved = await this.prompts.get(principal.namespaceId, body.name, body.version);
      if (!saved) throw notFound('prompt', body.name);
      template = saved.template;
    }
    if (!template) return { ok: false, latencyMs: 0, reason: 'give a "template" or the "name" of a saved prompt' };
    const variables = (body.variables ?? {}) as Record<string, JsonValue>;
    let rendered: string;
    try {
      rendered = renderPrompt(template, variables);
    } catch (error) {
      return { ok: false, latencyMs: 0, reason: (error as Error).message, variables: promptVariables(template) };
    }
    const startedAt = Date.now();
    const outcome = await new LlmTextCompleteExecutor(this.ai).execute(
      context(principal, { llmProvider: body.llmProvider, model: body.model, prompt: rendered, instructions: body.instructions, temperature: body.temperature, maxTokens: body.maxTokens })
    );
    return { ...answer(outcome, startedAt), rendered };
  }
}

@Controller('ns/:ns/vector-indexes')
export class VectorIndexController {
  constructor(
    private readonly vectors: VectorRepository,
    @Inject(AI_EXECUTOR_OPTIONS) private readonly ai: AiExecutorOptions
  ) {}

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List vector indexes', tags: ['ai'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { indexes: await this.vectors.indexes(principal.namespaceId), pgvector: await this.vectors.usesPgvector() };
  }

  @Get(':index/documents')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Chunks in an index', tags: ['ai'] })
  async documents(@CurrentPrincipal() principal: Principal, @Param('index') index: string) {
    return { index, chunks: await this.vectors.documents(principal.namespaceId, index, 200) };
  }

  @Post(':index/documents')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Chunk, embed and store a document', tags: ['ai'], body: indexSchema })
  async add(@CurrentPrincipal() principal: Principal, @Param('index') index: string, @Body(zodBody(indexSchema)) body: z.infer<typeof indexSchema>) {
    const startedAt = Date.now();
    return answer(await new IndexTextExecutor(this.ai).execute(context(principal, { ...body, index })), startedAt);
  }

  @Post(':index/search')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'Search an index', tags: ['ai'], body: searchSchema })
  async search(@CurrentPrincipal() principal: Principal, @Param('index') index: string, @Body(zodBody(searchSchema)) body: z.infer<typeof searchSchema>) {
    const startedAt = Date.now();
    return answer(await new SearchIndexExecutor(this.ai).execute(context(principal, { ...body, index })), startedAt);
  }

  @Delete(':index/documents/:docId')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Remove a document from an index', tags: ['ai'] })
  async removeDocument(@CurrentPrincipal() principal: Principal, @Param('index') index: string, @Param('docId') docId: string) {
    if ((await this.vectors.deleteDocument(principal.namespaceId, index, docId)) === 0) throw notFound('document', docId);
  }

  @Delete(':index')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete an index', tags: ['ai'] })
  async removeIndex(@CurrentPrincipal() principal: Principal, @Param('index') index: string) {
    if ((await this.vectors.deleteIndex(principal.namespaceId, index)) === 0) throw notFound('index', index);
  }
}

@Module({ controllers: [IntegrationController, PromptController, VectorIndexController] })
export class AiModule {}
