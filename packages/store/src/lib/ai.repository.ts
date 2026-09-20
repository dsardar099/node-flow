import { InvalidArgumentError, isWorkflowTerminal, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db } from './database.js';
import type { DecideQueueRepository } from './decide-queue.repository.js';
import type { MetadataRepository } from './metadata.repository.js';
import { json } from './schema.js';
import type { SchemaRegistryRepository } from './schema-registry.repository.js';
import type { SecretRepository } from './secret.repository.js';
import type { WorkflowRepository } from './workflow.repository.js';

/**
 * Integrations, prompts and vectors — the stored half of the AI tasks.
 *
 * The types the executors consume (`AiResolver`, `VectorStore`, `WorkflowTools`)
 * live in `tasks`, which `store` does not depend on; they are satisfied here
 * structurally.
 */

export const INTEGRATION_KINDS = ['LLM', 'MCP', 'HTTP'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
export const LLM_PROVIDER_IDS = ['openai', 'anthropic', 'google', 'openai_compatible'] as const;
export const MCP_PROVIDER_IDS = ['streamable_http'] as const;
/**
 * Remote HTTP services a workflow may call by name.
 *
 * `openapi` carries a document the server can read to list operations;
 * `rest` is a plain base URL for a service that publishes no spec.
 */
export const HTTP_PROVIDER_IDS = ['openapi', 'rest'] as const;

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export interface IntegrationInput {
  name: string;
  kind: IntegrationKind;
  provider: string;
  description?: string | null;
  baseUrl?: string | null;
  apiKeySecret?: string | null;
  models?: string[];
  /** MCP: `{ headers: { "X-Team": "ops" }, authHeader: "Authorization", authScheme: "Bearer" }`. */
  config?: Record<string, JsonValue>;
  enabled?: boolean;
}

export interface Integration extends Required<Omit<IntegrationInput, 'description' | 'baseUrl' | 'apiKeySecret'>> {
  id: string;
  description: string | null;
  baseUrl: string | null;
  apiKeySecret: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class IntegrationRepository {
  constructor(private readonly db: Db) {}

  async list(namespaceId: string, kind?: IntegrationKind): Promise<Integration[]> {
    let query = this.db.selectFrom('Integrations').selectAll().where('namespaceId', '=', namespaceId);
    if (kind) query = query.where('kind', '=', kind);
    return (await query.orderBy('name').execute()).map(toIntegration);
  }

  async get(namespaceId: string, name: string): Promise<Integration | undefined> {
    const row = await this.db.selectFrom('Integrations').selectAll().where('namespaceId', '=', namespaceId).where('name', '=', name).executeTakeFirst();
    return row ? toIntegration(row) : undefined;
  }

  /** Creates or replaces by name. */
  async put(namespaceId: string, input: IntegrationInput, by?: string): Promise<Integration> {
    const valid = validateIntegration(input);
    const values = {
      kind: valid.kind,
      provider: valid.provider,
      description: valid.description ?? null,
      baseUrl: valid.baseUrl ?? null,
      apiKeySecret: valid.apiKeySecret ?? null,
      models: valid.models ?? [],
      config: json(valid.config ?? {}),
      enabled: valid.enabled ?? true,
    };
    const row = await this.db
      .insertInto('Integrations')
      .values({ namespaceId, name: valid.name, createdBy: by ?? null, ...values })
      .onConflict((oc) => oc.columns(['namespaceId', 'name']).doUpdateSet({ ...values, updatedAt: sql<Date>`now()` }))
      .returningAll()
      .executeTakeFirstOrThrow();
    return toIntegration(row);
  }

  async delete(namespaceId: string, name: string): Promise<boolean> {
    const result = await this.db.deleteFrom('Integrations').where('namespaceId', '=', namespaceId).where('name', '=', name).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}

export function validateIntegration(input: IntegrationInput): IntegrationInput {
  if (!NAME.test(input.name ?? '')) throw new InvalidArgumentError('an integration name is lowercase letters, digits, ".", "_" or "-", up to 100 characters');
  if (!INTEGRATION_KINDS.includes(input.kind)) throw new InvalidArgumentError(`kind must be one of ${INTEGRATION_KINDS.join(', ')}`);
  const providers: readonly string[] =
    input.kind === 'LLM' ? LLM_PROVIDER_IDS : input.kind === 'MCP' ? MCP_PROVIDER_IDS : HTTP_PROVIDER_IDS;
  if (!providers.includes(input.provider)) throw new InvalidArgumentError(`a ${input.kind} provider must be one of ${providers.join(', ')}`);

  let baseUrl = input.baseUrl?.trim() || null;
  if (baseUrl) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new InvalidArgumentError('"baseUrl" is not a valid URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new InvalidArgumentError('"baseUrl" must be http or https');
    baseUrl = url.toString().replace(/\/$/, '');
  }
  if ((input.kind === 'MCP' || input.kind === 'HTTP' || input.provider === 'openai_compatible') && !baseUrl) {
    throw new InvalidArgumentError(
      input.kind === 'MCP'
        ? 'an MCP integration needs the server URL as "baseUrl"'
        : input.kind === 'HTTP'
          ? 'an HTTP service needs its base URL as "baseUrl"'
          : 'an OpenAI-compatible integration needs "baseUrl"'
    );
  }
  const models = [...new Set((input.models ?? []).map((m) => String(m).trim()).filter(Boolean))];
  if (input.kind === 'MCP' && models.length) throw new InvalidArgumentError('an MCP integration has no models');
  const config = input.config ?? {};
  const headers = config['headers'];
  if (headers !== undefined && (typeof headers !== 'object' || headers === null || Array.isArray(headers) || Object.values(headers).some((v) => typeof v !== 'string'))) {
    throw new InvalidArgumentError('"config.headers" must map header names to strings');
  }
  const secret = input.apiKeySecret?.trim() || null;
  return { ...input, baseUrl, models, config, apiKeySecret: secret, description: input.description?.trim() || null };
}

function toIntegration(row: Record<string, unknown>): Integration {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    kind: row['kind'] as IntegrationKind,
    provider: row['provider'] as string,
    description: (row['description'] as string | null) ?? null,
    baseUrl: (row['baseUrl'] as string | null) ?? null,
    apiKeySecret: (row['apiKeySecret'] as string | null) ?? null,
    models: (row['models'] as string[]) ?? [],
    config: (row['config'] as Record<string, JsonValue>) ?? {},
    enabled: row['enabled'] as boolean,
    createdBy: (row['createdBy'] as string | null) ?? null,
    createdAt: row['createdAt'] as Date,
    updatedAt: row['updatedAt'] as Date,
  };
}

// ------------------------------------------------------------------ prompts

export interface Prompt {
  name: string;
  version: number;
  description: string | null;
  template: string;
  variables: string[];
  models: string[];
  createdBy: string | null;
  createdAt: Date;
}

export class PromptRepository {
  constructor(private readonly db: Db) {}

  /** Saves a new version. Versions are immutable, like workflow definitions, so a run records exactly what it sent. */
  async save(namespaceId: string, input: { name: string; description?: string | null; template: string; models?: string[] }, by?: string): Promise<Prompt> {
    if (!NAME.test(input.name ?? '')) throw new InvalidArgumentError('a prompt name is lowercase letters, digits, ".", "_" or "-", up to 100 characters');
    if (typeof input.template !== 'string' || input.template.trim() === '') throw new InvalidArgumentError('a prompt needs a "template"');
    if (input.template.length > 100_000) throw new InvalidArgumentError('a prompt template is at most 100,000 characters');
    const variables = [...new Set([...input.template.matchAll(/\$\{\s*([\w.-]+)\s*\}/g)].map((m) => m[1].split('.')[0]))];

    return this.db.transaction().execute(async (tx) => {
      // Serialises concurrent saves of one prompt, so two never take the same number.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`prompt:${namespaceId}:${input.name}`}))`.execute(tx);
      const latest = await tx
        .selectFrom('Prompts')
        .select((eb) => eb.fn.max('version').as('version'))
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', input.name)
        .executeTakeFirst();
      const row = await tx
        .insertInto('Prompts')
        .values({
          namespaceId,
          name: input.name,
          version: Number(latest?.version ?? 0) + 1,
          description: input.description?.trim() || null,
          template: input.template,
          variables,
          models: [...new Set(input.models ?? [])],
          createdBy: by ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toPrompt(row);
    });
  }

  /** The latest version of each prompt, with how many versions it has. */
  async list(namespaceId: string): Promise<(Prompt & { versions: number })[]> {
    const rows = await this.db
      .selectFrom('Prompts as p')
      .selectAll('p')
      .select(sql<number>`(SELECT count(*)::int FROM "Prompts" v WHERE v."namespaceId" = p."namespaceId" AND v."name" = p."name")`.as('versions'))
      .where('p.namespaceId', '=', namespaceId)
      .where(({ eb, selectFrom }) =>
        eb('p.version', '=', selectFrom('Prompts as l').select((b) => b.fn.max('l.version').as('m')).whereRef('l.namespaceId', '=', 'p.namespaceId').whereRef('l.name', '=', 'p.name'))
      )
      .orderBy('p.name')
      .execute();
    return rows.map((row) => ({ ...toPrompt(row), versions: Number(row.versions) }));
  }

  async versions(namespaceId: string, name: string): Promise<Prompt[]> {
    const rows = await this.db.selectFrom('Prompts').selectAll().where('namespaceId', '=', namespaceId).where('name', '=', name).orderBy('version', 'desc').execute();
    return rows.map(toPrompt);
  }

  async get(namespaceId: string, name: string, version?: number): Promise<Prompt | undefined> {
    let query = this.db.selectFrom('Prompts').selectAll().where('namespaceId', '=', namespaceId).where('name', '=', name);
    query = version === undefined ? query.orderBy('version', 'desc').limit(1) : query.where('version', '=', version);
    const row = await query.executeTakeFirst();
    return row ? toPrompt(row) : undefined;
  }

  async delete(namespaceId: string, name: string): Promise<boolean> {
    const result = await this.db.deleteFrom('Prompts').where('namespaceId', '=', namespaceId).where('name', '=', name).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}

function toPrompt(row: Record<string, unknown>): Prompt {
  return {
    name: row['name'] as string,
    version: row['version'] as number,
    description: (row['description'] as string | null) ?? null,
    template: row['template'] as string,
    variables: (row['variables'] as string[]) ?? [],
    models: (row['models'] as string[]) ?? [],
    createdBy: (row['createdBy'] as string | null) ?? null,
    createdAt: row['createdAt'] as Date,
  };
}

// ------------------------------------------------------------------ vectors

export interface VectorIndexSummary {
  indexName: string;
  documents: number;
  chunks: number;
  dimensions: number;
  models: string[];
  updatedAt: Date;
}

export class VectorRepository {
  private native?: Promise<boolean>;

  constructor(private readonly db: Db) {}

  /** Whether pgvector is installed, checked once. */
  usesPgvector(): Promise<boolean> {
    this.native ??= sql<{ present: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS present`
      .execute(this.db)
      .then((r) => r.rows[0]?.present === true)
      .catch(() => false);
    return this.native;
  }

  /**
   * Replaces a document's chunks.
   *
   * Whole-document replacement, in one transaction: a document re-indexed with
   * fewer chunks must not keep its old tail, and a search mid-update must not
   * see half of each version.
   */
  async upsert(
    namespaceId: string,
    indexName: string,
    records: { docId: string; chunk: number; text: string; metadata: Record<string, JsonValue>; embedding: number[]; model?: string }[]
  ): Promise<number> {
    if (records.length === 0) return 0;
    const dimensions = records[0].embedding.length;
    if (records.some((r) => r.embedding.length !== dimensions || r.embedding.some((x) => !Number.isFinite(x)))) {
      throw new InvalidArgumentError('every embedding in one write must have the same dimensions and finite values');
    }
    return this.db.transaction().execute(async (tx) => {
      const existing = await tx.selectFrom('VectorDocuments').select('dimensions').where('namespaceId', '=', namespaceId).where('indexName', '=', indexName).limit(1).executeTakeFirst();
      if (existing && existing.dimensions !== dimensions) {
        throw new InvalidArgumentError(`index "${indexName}" holds ${existing.dimensions}-dimension embeddings; these have ${dimensions}. Use the same embedding model.`);
      }
      const docIds = [...new Set(records.map((r) => r.docId))];
      await tx.deleteFrom('VectorDocuments').where('namespaceId', '=', namespaceId).where('indexName', '=', indexName).where('docId', 'in', docIds).execute();
      await tx
        .insertInto('VectorDocuments')
        .values(
          records.map((r) => ({
            namespaceId,
            indexName,
            docId: r.docId,
            chunk: r.chunk,
            text: r.text,
            metadata: json(r.metadata),
            embedding: r.embedding,
            dimensions,
            model: r.model ?? null,
          }))
        )
        .execute();
      return records.length;
    });
  }

  async search(namespaceId: string, indexName: string, embedding: number[], topK: number, minScore?: number) {
    if (embedding.length === 0 || embedding.some((x) => !Number.isFinite(x))) throw new InvalidArgumentError('a query embedding must be finite numbers');
    const existing = await this.db.selectFrom('VectorDocuments').select('dimensions').where('namespaceId', '=', namespaceId).where('indexName', '=', indexName).limit(1).executeTakeFirst();
    if (!existing) return [];
    if (existing.dimensions !== embedding.length) {
      throw new InvalidArgumentError(`index "${indexName}" holds ${existing.dimensions}-dimension embeddings but the query has ${embedding.length}; search with the model it was built with`);
    }

    const literal = sql`${`{${embedding.join(',')}}`}::real[]`;
    const score = (await this.usesPgvector())
      ? sql<number>`1 - ("embedding"::vector <=> (${literal})::vector)`
      : sql<number>`nf_cosine_similarity("embedding", ${literal})`;

    const rows = await sql<{ docId: string; chunk: number; text: string; metadata: Record<string, JsonValue>; score: number }>`
      SELECT * FROM (
        SELECT "docId", "chunk", "text", "metadata", ${score} AS "score"
        FROM "VectorDocuments"
        WHERE "namespaceId" = ${namespaceId} AND "indexName" = ${indexName}
      ) scored
      WHERE "score" IS NOT NULL ${minScore === undefined ? sql`` : sql`AND "score" >= ${minScore}`}
      ORDER BY "score" DESC, "docId", "chunk"
      LIMIT ${Math.min(Math.max(Math.trunc(topK), 1), 100)}
    `.execute(this.db);
    return rows.rows.map((r) => ({ ...r, score: Number(r.score) }));
  }

  async indexes(namespaceId: string): Promise<VectorIndexSummary[]> {
    const rows = await this.db
      .selectFrom('VectorDocuments')
      .select((eb) => [
        'indexName',
        sql<number>`count(DISTINCT "docId")::int`.as('documents'),
        sql<number>`count(*)::int`.as('chunks'),
        eb.fn.max('dimensions').as('dimensions'),
        sql<string[]>`array_remove(array_agg(DISTINCT "model"), NULL)`.as('models'),
        eb.fn.max('createdAt').as('updatedAt'),
      ])
      .where('namespaceId', '=', namespaceId)
      .groupBy('indexName')
      .orderBy('indexName')
      .execute();
    return rows.map((r) => ({ indexName: r.indexName, documents: Number(r.documents), chunks: Number(r.chunks), dimensions: Number(r.dimensions), models: r.models, updatedAt: r.updatedAt as Date }));
  }

  async documents(namespaceId: string, indexName: string, limit = 100) {
    return this.db
      .selectFrom('VectorDocuments')
      .select(['docId', 'chunk', 'text', 'metadata', 'model', 'createdAt'])
      .where('namespaceId', '=', namespaceId)
      .where('indexName', '=', indexName)
      .orderBy('docId')
      .orderBy('chunk')
      .limit(Math.min(Math.max(limit, 1), 500))
      .execute();
  }

  async deleteDocument(namespaceId: string, indexName: string, docId: string): Promise<number> {
    const result = await this.db.deleteFrom('VectorDocuments').where('namespaceId', '=', namespaceId).where('indexName', '=', indexName).where('docId', '=', docId).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async deleteIndex(namespaceId: string, indexName: string): Promise<number> {
    const result = await this.db.deleteFrom('VectorDocuments').where('namespaceId', '=', namespaceId).where('indexName', '=', indexName).executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}

// ------------------------------------------------------------------ seams

/**
 * What the AI executors resolve at call time: the integration with its key
 * unsealed, and prompt text. A disabled integration is as good as absent.
 */
export function aiResolver(integrations: IntegrationRepository, prompts: PromptRepository, secrets: Pick<SecretRepository, 'resolve'>) {
  const secretValue = async (namespaceId: string, name: string | null): Promise<string | undefined> => {
    if (!name) return undefined;
    const value = (await secrets.resolve(namespaceId, [name]))[name];
    if (value === undefined) throw new InvalidArgumentError(`secret "${name}" does not exist`);
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  return {
    async llm(namespaceId: string, name: string) {
      const found = await integrations.get(namespaceId, name);
      if (!found || !found.enabled || found.kind !== 'LLM') return undefined;
      return {
        name: found.name,
        provider: found.provider as (typeof LLM_PROVIDER_IDS)[number],
        baseUrl: found.baseUrl ?? undefined,
        apiKey: await secretValue(namespaceId, found.apiKeySecret),
        models: found.models,
      };
    },
    async mcp(namespaceId: string, name: string) {
      const found = await integrations.get(namespaceId, name);
      if (!found || !found.enabled || found.kind !== 'MCP' || !found.baseUrl) return undefined;
      const headers = { ...((found.config['headers'] as Record<string, string> | undefined) ?? {}) };
      const key = await secretValue(namespaceId, found.apiKeySecret);
      if (key) {
        const header = typeof found.config['authHeader'] === 'string' ? found.config['authHeader'] : 'Authorization';
        const scheme = typeof found.config['authScheme'] === 'string' ? found.config['authScheme'] : 'Bearer';
        headers[header] = scheme ? `${scheme} ${key}` : key;
      }
      return { name: found.name, url: found.baseUrl, headers };
    },
    async prompt(namespaceId: string, name: string, version?: number) {
      const found = await prompts.get(namespaceId, name, version);
      return found ? { name: found.name, version: found.version, template: found.template } : undefined;
    },
  };
}

/**
 * Workflows as an agent's tools.
 *
 * A tool call starts a run like `START_WORKFLOW` does — idempotent on a key
 * from the agent task and the tool call, so a replayed agent step joins the run
 * it already started. Tags are not re-checked, for the reason event handlers
 * and schedules do not: the decision was made by whoever wrote the definition
 * naming the tool.
 */
export function workflowTools(workflows: WorkflowRepository, metadata: MetadataRepository, decide: DecideQueueRepository, schemas?: Pick<SchemaRegistryRepository, 'resolve'>) {
  const everything = { tagGrants: ['*'], can: () => true };
  return {
    async describe(namespaceId: string, name: string) {
      const definition = await metadata.getWorkflowDefinition(namespaceId, name, everything);
      if (!definition) return undefined;
      let inputSchema = definition.inputSchema && schemas ? await schemas.resolve(namespaceId, definition.inputSchema).catch(() => undefined) : (definition.inputSchema as JsonValue | undefined);
      if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
        // Declared input names are the next best thing to a schema.
        inputSchema = { type: 'object', properties: Object.fromEntries((definition.inputParameters ?? []).map((p) => [p, {}])) };
      }
      return { description: definition.description, inputSchema: inputSchema as Record<string, JsonValue> };
    },
    async start(namespaceId: string, name: string, input: Record<string, JsonValue>, idempotencyKey: string, parentWorkflowId: string) {
      const version = await metadata.latestVersion(namespaceId, name);
      if (version === undefined) throw new InvalidArgumentError(`no workflow definition "${name}"`);
      const started = await workflows.start({ namespaceId, defName: name, defVersion: version, input, idempotencyKey, correlationId: parentWorkflowId });
      if (!isWorkflowTerminal(started.status)) await decide.enqueue(namespaceId, started.id, 'started by an agent');
      return started.id;
    },
    async status(namespaceId: string, workflowId: string) {
      const run = await workflows.findById(workflowId);
      if (!run || run.namespaceId !== namespaceId) return undefined;
      const output = run.output?.kind === 'inline' ? (run.output.value as Record<string, JsonValue>) : undefined;
      return { status: run.status, output, reason: run.reasonForIncompletion ?? undefined };
    },
  };
}

/**
 * Remote HTTP services, resolved by the name an operator gave them.
 *
 * The same argument as the `JDBC` datasources and the MCP servers: a definition
 * carrying its own URL and key puts credentials into a stored, versioned,
 * rendered document, and lets any author point the server anywhere. Naming a
 * registered service keeps both out of the definition, and makes rotating a key
 * or moving a host one edit rather than a search across every workflow.
 *
 * Separate from `aiResolver` on purpose: a REST API is not an AI concern, and
 * folding it in would have the `HTTP` task depending on a type that exists to
 * describe models and prompts.
 */
export function httpServiceResolver(
  integrations: IntegrationRepository,
  secrets: Pick<SecretRepository, 'resolve'>
) {
  return {
    async httpService(namespaceId: string, name: string) {
      const found = await integrations.get(namespaceId, name);
      if (!found || !found.enabled || found.kind !== 'HTTP' || !found.baseUrl) return undefined;

      const headers = { ...((found.config['headers'] as Record<string, string> | undefined) ?? {}) };
      if (found.apiKeySecret) {
        const resolved = (await secrets.resolve(namespaceId, [found.apiKeySecret]))[found.apiKeySecret];
        if (resolved === undefined) throw new InvalidArgumentError(`secret "${found.apiKeySecret}" does not exist`);
        const key = typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
        const header = typeof found.config['authHeader'] === 'string' ? found.config['authHeader'] : 'Authorization';
        const scheme = typeof found.config['authScheme'] === 'string' ? found.config['authScheme'] : 'Bearer';
        headers[header] = scheme ? `${scheme} ${key}` : key;
      }

      return {
        name: found.name,
        baseUrl: found.baseUrl,
        headers,
        timeoutMs: typeof found.config['timeoutMs'] === 'number' ? found.config['timeoutMs'] : undefined,
      };
    },
  };
}
