import {
  CompilationError,
  TaskType,
  ErrorCode,
  InvalidDefinitionError,
  NodeFlowError,
  isValidTag,
  mayReachTags,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type JsonValue,
  type ResourceAccess,
  type TaskDefinition as TaskDefinitionSpec,
  type WorkflowDefinition as WorkflowDefinitionSpec,
} from '@node-flow-dev/core';
import { compileBlueprint, loopConditionProblem, switchExpressionProblem, rateLimitFor, type Blueprint } from '@node-flow-dev/engine';
import { sql } from 'kysely';
import type { Db, Queryable } from './database.js';
import type { SchemaValidator } from './schema-validator.js';
import { isSchemaReference, type SchemaRegistryRepository } from './schema-registry.repository.js';
import { json } from './schema.js';
import { isUniqueViolation } from './pg-errors.js';
import type { BlueprintLoader, TaskDefLoader } from './evaluator.js';

/**
 * Workflow and task definition management.
 *
 * This is the cold path, and it uses the Sequelize models rather than raw SQL:
 * ordinary CRUD over small tables, read far more often than written, where
 * typed models and associations are worth more than control over the exact
 * statement. The decider and queues stay on raw SQL for the opposite reason.
 *
 * It also provides the production `BlueprintLoader` and `TaskDefLoader` the
 * evaluator needs — until now only test stubs existed.
 */

export interface RegisterWorkflowOptions {
  namespaceId: string;
  definition: unknown;
  createdBy?: string;
  /** Tags to set on this definition. Tags restrict access; see `mayReachTags`. */
  tags?: string[];
  /** The caller's grants, checked against the definition's existing tags. */
  access?: TagAccess;
}

/**
 * What a caller may reach.
 *
 * A value object rather than a bare array so it reads as a decision at every
 * call site, and so a future addition — deny lists, resource types — does not
 * change every signature.
 */
export interface TagAccess {
  tagGrants: string[];
  /**
   * The full decision, when the caller has one: scope and tags, or a resource
   * grant for this workflow. Without it, tags alone decide — the behaviour for
   * callers that have already checked the scope.
   */
  can?: (need: ResourceAccess, name: string, tags: string[]) => boolean;
}

/** Whether `access` allows `need` on a workflow with this name and these tags. */
export function reaches(access: TagAccess, need: ResourceAccess, name: string, tags: string[]): boolean {
  return access.can ? access.can(need, name, tags) : mayReachTags(access.tagGrants, tags);
}

export class MetadataRepository implements BlueprintLoader {
  /**
   * Compiled blueprints, keyed by namespace + name + version.
   *
   * Unbounded invalidation is not a concern: a definition version is immutable
   * once registered, so a cached entry can never go stale. That immutability is
   * exactly why versions are immutable in the first place.
   */
  private readonly blueprintCache = new Map<string, Blueprint>();

  /** Task definitions, keyed by namespace + name. Mutable, so this is evicted on write. */
  private readonly taskDefCache = new Map<string, TaskDefinitionSpec>();

  constructor(
    private readonly db: Db,
    /** Bounds the blueprint cache. 30,000-task blueprints are not small. */
    private readonly maxCachedBlueprints = 500,
    /**
     * Rejects an `inputSchema`/`outputSchema` that will never compile.
     *
     * Caught at registration rather than at execution: an uncompilable schema
     * is silently skipped by the validator, so without this check an operator
     * declares a contract, gets a 201, and the contract never applies.
     */
    private readonly schemas?: SchemaValidator,
    /** Resolves `{ name, version }` schema references to registered schemas. */
    private readonly registry?: SchemaRegistryRepository
  ) {}

  // ---------------------------------------------------------------- workflows

  /**
   * Validates, compiles and stores a workflow definition.
   *
   * Compiling at registration rather than at execution is what makes a bad
   * definition an HTTP 400 instead of a workflow that fails at 3am on the one
   * branch nobody exercised. Referential errors — a task referencing a name
   * that does not exist, a fork with no join — surface here.
   */
  async registerWorkflow(options: RegisterWorkflowOptions): Promise<{
    definition: WorkflowDefinitionSpec;
    blueprint: Blueprint;
  }> {
    for (const tag of options.tags ?? []) {
      if (!isValidTag(tag)) {
        throw new InvalidDefinitionError(
          `"${tag}" is not a usable tag: write it as key:value, lower-case key`,
          { tag }
        );
      }
    }

    // Registering a new version of an existing definition is an edit. If the
    // existing one is tagged, the caller must be able to reach it — otherwise
    // tagging something would protect it from being read and not from being
    // replaced, which is the more damaging of the two.
    if (options.access) {
      const existing = await this.tagsOf(options.namespaceId, nameOf(options.definition));
      if (
        existing
          ? !reaches(options.access, 'UPDATE', nameOf(options.definition), existing)
          : options.access.can && !options.access.can('UPDATE', nameOf(options.definition), options.tags ?? [])
      ) {
        throw new InvalidDefinitionError(
          'a workflow with this name exists and is not reachable with your tag grants',
          { name: nameOf(options.definition) }
        );
      }
    }

    const checked = checkDefinition(options.definition);
    if (!checked.valid) {
      const [first] = checked.issues;
      throw new InvalidDefinitionError(
        checked.stage === 'schema' ? schemaFailureMessage(checked.issues) : first.message,
        checked.stage === 'schema' ? { issues: checked.issues } : first.details
      );
    }

    const { definition, blueprint } = checked;

    const existing = await this.db
      .selectFrom('WorkflowDefinitions')
      .select('name')
      .where('namespaceId', '=', options.namespaceId)
      .where('name', '=', definition.name)
      .where('version', '=', definition.version)
      .executeTakeFirst();

    // Versions are immutable — the blueprint cache depends on it, and so does
    // every running instance pinned to this version.
    //
    // `CONFLICT`, not `INVALID_DEFINITION`: the definition may be perfectly
    // valid, and the two mean opposite things to a caller. A malformed
    // definition is never worth retrying and the fix is to change it; an
    // already-registered version usually means a deploy ran twice, where the
    // right response is to move on. Collapsing both into 400 leaves an SDK
    // string-matching the message to tell them apart.
    if (existing) throw versionExists(definition.name, definition.version);

    // Tags protect the workflow by name, so every version carries the same
    // ones. Unstated tags are inherited — a new version registered without
    // them must not quietly make the workflow public — and stated ones apply
    // to the earlier versions too, which would otherwise stay readable.
    const inherited = await this.tagsOf(options.namespaceId, definition.name);
    const tags = options.tags ?? inherited ?? [];

    try {
      await this.db.transaction().execute(async (tx) => {
        await tx
          .insertInto('WorkflowDefinitions')
          .values({
            namespaceId: options.namespaceId,
            name: definition.name,
            version: definition.version,
            definition: json(definition),
            blueprint: json(serialiseBlueprint(blueprint)),
            tags,
            createdBy: options.createdBy ?? null,
          })
          .execute();

        if (options.tags !== undefined) {
          await this.writeTags(tx, options.namespaceId, definition.name, tags);
        }
      });
    } catch (error) {
      // The check above is a courtesy, not the guard: two registrations of the
      // same version racing both pass it, and the primary key is what actually
      // holds. Translating the unique violation here is what makes the loser of
      // that race get the same 409 as the sequential case rather than a 500
      // that reads as "the server is broken".
      if (isUniqueViolation(error)) throw versionExists(definition.name, definition.version);
      throw error;
    }

    this.cacheBlueprint(this.key(options.namespaceId, definition.name, definition.version), blueprint);
    return { definition, blueprint };
  }

  /**
   * Deletes one version of a workflow definition.
   *
   * Refused while any execution pinned to that version is still running, and
   * the reason is structural rather than cautious: a running execution does not
   * carry its definition, it reloads it from this row whenever a process needs
   * the blueprint. Deleting the row would leave that execution unable to be
   * evaluated — stuck, with no error an operator could act on. Finished
   * executions are unaffected; they keep their history and never evaluate again.
   */
  async deleteWorkflowVersion(
    namespaceId: string,
    name: string,
    version: number,
    access: TagAccess
  ): Promise<'deleted' | 'not_found' | 'in_use'> {
    const tags = await this.tagsOf(namespaceId, name);
    if (tags === undefined || !reaches(access, 'DELETE', name, tags)) return 'not_found';

    return this.db.transaction().execute(async (tx) => {
      const live = await tx
        .selectFrom('WorkflowExecutions')
        .select('id')
        .where('namespaceId', '=', namespaceId)
        .where('defName', '=', name)
        .where('defVersion', '=', version)
        .where('status', 'in', ['RUNNING', 'PAUSED'])
        .limit(1)
        .executeTakeFirst();
      if (live) return 'in_use' as const;

      const deleted = await tx
        .deleteFrom('WorkflowDefinitions')
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .where('version', '=', version)
        .executeTakeFirst();

      this.blueprintCache.delete(this.key(namespaceId, name, version));
      return Number(deleted.numDeletedRows) > 0 ? ('deleted' as const) : ('not_found' as const);
    });
  }

  /** The latest registered version of a workflow, or undefined. */
  async latestVersion(namespaceId: string, name: string): Promise<number | undefined> {
    const row = await this.db
      .selectFrom('WorkflowDefinitions')
      .select('version')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    return row?.version;
  }

  /**
   * One definition, if the caller may reach it.
   *
   * An unreachable definition is reported as absent rather than forbidden:
   * distinguishing them tells a caller that a workflow with that name exists in
   * a space they cannot see, which is the same disclosure the namespace check
   * exists to prevent.
   */
  async getWorkflowDefinition(
    namespaceId: string,
    name: string,
    access: TagAccess,
    version?: number
  ): Promise<WorkflowDefinitionSpec | undefined> {
    const row = await this.findDefinitionRow(namespaceId, name, version);
    if (!row) return undefined;
    if (!reaches(access, 'READ', name, row.tags ?? [])) return undefined;

    return row.definition as unknown as WorkflowDefinitionSpec;
  }

  /**
   * Whether a definition exists, ignoring tags.
   *
   * For **system** paths — a schedule firing, an event handler starting a
   * workflow. Those run as the engine rather than as a person: the access
   * decision was made when the schedule or handler was created, and re-applying
   * the creator's tag grants at fire time would break the moment they left the
   * team. They need to know the definition is there, not who may see it.
   */
  async definitionExists(
    namespaceId: string,
    name: string,
    version: number
  ): Promise<boolean> {
    // Truthiness, not `!== undefined`: `findDefinitionRow` returns `null` for
    // a miss, so the identity check was always true and a missing definition
    // was never detected. Two tests caught it immediately, which is the only
    // reason it is not in a release.
    return Boolean(await this.findDefinitionRow(namespaceId, name, version));
  }

  /**
   * Replaces a workflow's tags, on every version.
   *
   * The caller must reach the workflow as it is tagged *now*; what they tag it
   * with afterwards is theirs to choose, including tags that lock them out.
   */
  async setTags(
    namespaceId: string,
    name: string,
    tags: string[],
    access: TagAccess
  ): Promise<'updated' | 'not_found'> {
    for (const tag of tags) {
      if (!isValidTag(tag)) {
        throw new InvalidDefinitionError(`"${tag}" is not a usable tag: write it as key:value, lower-case key`, { tag });
      }
    }
    const current = await this.tagsOf(namespaceId, name);
    if (current === undefined || !reaches(access, 'UPDATE', name, current)) return 'not_found';

    await this.writeTags(this.db, namespaceId, name, [...new Set(tags)]);
    return 'updated';
  }

  /**
   * Workflows the caller's grants cannot reach.
   *
   * For filtering things that belong to a workflow — its executions — where
   * the query cannot join on tags itself. Only tagged workflows can appear, so
   * this stays small however many untagged definitions exist.
   */
  async unreachableWorkflowNames(namespaceId: string, access: TagAccess): Promise<string[]> {
    const rows = await this.db
      .selectFrom('WorkflowDefinitions')
      .select(['name', 'tags'])
      .distinctOn('name')
      .where('namespaceId', '=', namespaceId)
      // With a full policy an untagged workflow can be out of reach too — for
      // someone who holds grants rather than the scope — so every name counts.
      .$if(!access.can, (q) => q.where(sql<boolean>`cardinality(tags) > 0`))
      .orderBy('name')
      .orderBy('version', 'desc')
      .execute();
    return rows.filter((row) => !reaches(access, 'READ', row.name, row.tags ?? [])).map((row) => row.name);
  }

  /** Every tag in use, with the workflows carrying it. For the tags dashboard. */
  async tagUsage(namespaceId: string): Promise<{ tag: string; workflows: string[] }[]> {
    const result = await sql<{ tag: string; workflows: string[] }>`
      SELECT tag, array_agg(DISTINCT name ORDER BY name) AS workflows
      FROM "WorkflowDefinitions", unnest(tags) AS tag
      WHERE "namespaceId" = ${namespaceId}
      GROUP BY tag
      ORDER BY tag
    `.execute(this.db);
    return result.rows;
  }

  private async writeTags(executor: Queryable, namespaceId: string, name: string, tags: string[]): Promise<void> {
    await executor
      .updateTable('WorkflowDefinitions')
      .set({ tags })
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .execute();
  }

  /**
   * The tags on a definition, whatever the caller may reach.
   *
   * For the places that have to make the access decision themselves — starting
   * an execution, registering a new version over an existing one.
   */
  async tagsOf(namespaceId: string, name: string): Promise<string[] | undefined> {
    const row = await this.db
      .selectFrom('WorkflowDefinitions')
      .select('tags')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .orderBy('version', 'desc')
      .executeTakeFirst();

    return row?.tags;
  }

  /**
   * Lists registered workflows, newest version of each first.
   *
   * `access` is **required**, not optional. An optional access parameter is the
   * shape that has silently disabled a check in this codebase more than once:
   * a caller that forgets it gets full visibility and no error. Required means
   * the compiler asks the question at every call site.
   *
   * Filtered in the query rather than after it — a definition you cannot reach
   * should not appear in a list and then vanish when opened.
   */
  async listWorkflows(
    namespaceId: string,
    access: TagAccess
  ): Promise<WorkflowListing[]> {
    const rows = await this.db
      .selectFrom('WorkflowDefinitions')
      .select(['name', 'version', 'tags', 'createdAt', 'createdBy'])
      // From inside the stored JSON rather than the whole document: a list of
      // a hundred definitions should not ship a hundred task graphs.
      .select(sql<string | null>`"definition"->>'description'`.as('description'))
      .select(sql<string | null>`"definition"->>'ownerEmail'`.as('ownerEmail'))
      .where('namespaceId', '=', namespaceId)
      .orderBy('name')
      .orderBy('version', 'desc')
      .execute();

    // Normalised, not just defended against: the declared return type says
    // `string[]`, and handing back a null under that type pushes the guard onto
    // every caller — one of which is a UI that would throw rendering it.
    return rows
      .map((row) => ({ ...row, tags: row.tags ?? [] }))
      .filter((row) => reaches(access, 'READ', row.name, row.tags));
  }

  /**
   * `BlueprintLoader`: the compiled graph the decider evaluates against.
   *
   * Recompiles from the stored definition rather than trusting the stored
   * blueprint JSON. The blueprint holds `Map`s and class-shaped nodes that do
   * not survive a JSON round trip, and recompiling is cheap and happens once
   * per version per process thanks to the cache. The stored copy stays useful
   * for tooling that wants the graph without a compiler.
   */
  async load(namespaceId: string, defName: string, defVersion: number): Promise<Blueprint> {
    const key = this.key(namespaceId, defName, defVersion);
    const cached = this.blueprintCache.get(key);
    if (cached) return cached;

    const row = await this.findDefinitionRow(namespaceId, defName, defVersion);
    if (!row) {
      throw new InvalidDefinitionError(
        `no workflow definition "${defName}" version ${defVersion} in this namespace`,
        { name: defName, version: defVersion }
      );
    }

    const blueprint = compileBlueprint(
      workflowDefinitionSchema.parse(row.definition)
    );
    this.cacheBlueprint(key, blueprint);
    return blueprint;
  }

  // ---------------------------------------------------------------- task defs

  /** Creates or updates a task definition. Unlike workflows, these are mutable. */
  async upsertTaskDefinition(
    namespaceId: string,
    input: unknown,
    tx?: Queryable
  ): Promise<TaskDefinitionSpec> {
    const parsed = taskDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidDefinitionError('task definition failed validation', {
        issues: parsed.error.issues,
      });
    }

    const spec = parsed.data;

    // A schema that will not compile is skipped by the validator at execution
    // time, so accepting one here would hand the operator a 201 for a contract
    // that silently never applies — the precise failure this check exists to
    // prevent.
    for (const target of ['inputSchema', 'outputSchema'] as const) {
      // A reference must point at a registered schema *now*: accepting one that
      // does not resolve saves a contract that can never be checked.
      if (isSchemaReference(spec[target])) {
        if (!this.registry) {
          throw new InvalidDefinitionError(`${target} references a registered schema, but no registry is configured`, {
            taskDefName: spec.name,
            target,
          });
        }
        await this.registry.resolve(namespaceId, spec[target]).catch((error: Error) => {
          throw new InvalidDefinitionError(`${target}: ${error.message}`, { taskDefName: spec.name, target });
        });
        continue;
      }
      if (this.schemas && !this.schemas.isCompilable(spec[target])) {
        throw new InvalidDefinitionError(`${target} is not a valid JSON Schema`, {
          taskDefName: spec.name,
          target,
        });
      }
    }

    // Columns are mapped explicitly rather than spread from the parsed schema.
    // Spreading looks tidier but couples the storage layout to the DSL: the
    // schema carries fields the table does not have, and any future addition
    // would break every insert. Sequelize hid that by silently discarding
    // unknown attributes — which is how the two drifted apart unnoticed.
    const row = {
      description: spec.description ?? null,
      inputKeys: json(spec.inputKeys),
      outputKeys: json(spec.outputKeys),
      inputSchema: spec.inputSchema === undefined ? null : json(spec.inputSchema),
      outputSchema: spec.outputSchema === undefined ? null : json(spec.outputSchema),
      secretOutputFields: spec.secretOutputFields ?? [],
      ownerEmail: spec.ownerEmail ?? null,
      retryCount: spec.retryCount,
      retryLogic: spec.retryLogic,
      retryDelaySeconds: spec.retryDelaySeconds,
      backoffScaleFactor: spec.backoffScaleFactor,
      maxRetryDelaySeconds: spec.maxRetryDelaySeconds,
      jitter: spec.jitter,
      retryBudget: spec.retryBudget,
      nonRetryableErrors: json(spec.nonRetryableErrors),
      timeoutSeconds: spec.timeoutSeconds,
      scheduleToStartTimeout: spec.scheduleToStartTimeout,
      startToCloseTimeout: spec.startToCloseTimeout,
      heartbeatTimeout: spec.heartbeatTimeout,
      responseTimeoutSeconds: spec.responseTimeoutSeconds,
      pollTimeoutSeconds: spec.pollTimeoutSeconds,
      timeoutPolicy: spec.timeoutPolicy,
      concurrentExecLimit: spec.concurrentExecLimit,
      rateLimitPerFrequency: spec.rateLimitPerFrequency,
      rateLimitFrequencySeconds: spec.rateLimitFrequencySeconds,
      semaphores: json(spec.semaphores),
    };

    await (tx ?? this.db)
      .insertInto('TaskDefinitions')
      .values({ namespaceId, name: spec.name, ...row })
      .onConflict((oc) =>
        oc.columns(['namespaceId', 'name']).doUpdateSet({ ...row, updatedAt: sql<Date>`now()` })
      )
      .execute();

    // Mutable, so the cached copy is now wrong.
    this.taskDefCache.delete(`${namespaceId}:${spec.name}`);
    return spec;
  }

  /**
   * `TaskDefLoader`: retry and timeout policy for the tasks in one evaluation.
   *
   * Names with no stored definition are simply absent from the result, and the
   * decider falls back to schema defaults. A task running under default retry
   * policy is much better than an evaluation that throws because someone
   * dispatched work before registering its definition.
   */
  async loadTaskDefs(
    namespaceId: string,
    names: string[]
  ): Promise<Map<string, TaskDefinitionSpec>> {
    const result = new Map<string, TaskDefinitionSpec>();
    const missing: string[] = [];

    for (const name of names) {
      const cached = this.taskDefCache.get(`${namespaceId}:${name}`);
      if (cached) result.set(name, cached);
      else missing.push(name);
    }

    if (missing.length > 0) {
      const rows = await this.db
        .selectFrom('TaskDefinitions')
        .selectAll()
        .where('namespaceId', '=', namespaceId)
        .where('name', 'in', missing)
        .execute();

      for (const row of rows) {
        const spec = taskDefinitionSchema.parse(stripNulls(row));
        this.taskDefCache.set(`${namespaceId}:${row.name}`, spec);
        result.set(row.name, spec);
      }
    }

    return this.registry ? this.withResolvedSchemas(namespaceId, result) : result;
  }

  /**
   * Replaces schema references with the schemas they name.
   *
   * Done per load rather than cached with the definition: a reference to the
   * latest version must follow new registrations, and the registry caches that
   * lookup itself. A reference that no longer resolves leaves the definition
   * with no schema *and* logs nothing here — the validator treats it as absent
   * — so registration refuses dangling references and deleting a referenced
   * version is the operator's explicit choice.
   */
  private async withResolvedSchemas(
    namespaceId: string,
    specs: Map<string, TaskDefinitionSpec>
  ): Promise<Map<string, TaskDefinitionSpec>> {
    const out = new Map<string, TaskDefinitionSpec>();
    for (const [name, spec] of specs) {
      if (!isSchemaReference(spec.inputSchema) && !isSchemaReference(spec.outputSchema)) {
        out.set(name, spec);
        continue;
      }
      const resolveOrDrop = (value: unknown) =>
        this.registry!.resolve(namespaceId, value).catch(() => undefined);
      out.set(name, {
        ...spec,
        inputSchema: (await resolveOrDrop(spec.inputSchema)) as TaskDefinitionSpec['inputSchema'],
        outputSchema: (await resolveOrDrop(spec.outputSchema)) as TaskDefinitionSpec['outputSchema'],
      });
    }
    return out;
  }

  async listTaskDefinitions(namespaceId: string): Promise<TaskDefinitionSpec[]> {
    const rows = await this.db
      .selectFrom('TaskDefinitions')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .orderBy('name')
      .execute();
    return rows.map((r) => taskDefinitionSchema.parse(stripNulls(r)));
  }

  async getTaskDefinition(namespaceId: string, name: string): Promise<TaskDefinitionSpec | undefined> {
    const row = await this.db
      .selectFrom('TaskDefinitions')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .executeTakeFirst();
    return row ? taskDefinitionSchema.parse(stripNulls(row)) : undefined;
  }

  /**
   * Deletes a task definition — refused while work of that type is queued or
   * running.
   *
   * Tasks keep running without a definition (the decider falls back to default
   * policy), so this is not about correctness of the engine. It is about the
   * operator: deleting the definition under a live task silently changes its
   * retry and timeout behaviour mid-flight, which nobody deleting a definition
   * means to do. The queue is the check rather than `TaskExecutions` because it
   * holds exactly the live tasks and is indexed by name; a domain-routed task
   * sits on `name:domain`.
   */
  async deleteTaskDefinition(namespaceId: string, name: string): Promise<'deleted' | 'not_found' | 'in_use'> {
    return this.db.transaction().execute(async (tx) => {
      const live = await tx
        .selectFrom('TaskQueues')
        .select('id')
        .where('namespaceId', '=', namespaceId)
        .where((eb) => eb.or([eb('queueName', '=', name), eb('queueName', 'like', `${escapeLike(name)}:%`)]))
        .limit(1)
        .executeTakeFirst();
      if (live) return 'in_use' as const;

      const deleted = await tx
        .deleteFrom('TaskDefinitions')
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', name)
        .executeTakeFirst();

      this.taskDefCache.delete(`${namespaceId}:${name}`);
      return Number(deleted.numDeletedRows) > 0 ? ('deleted' as const) : ('not_found' as const);
    });
  }

  /**
   * Adapter for the evaluator's `TaskDefLoader`.
   *
   * A separate object rather than a second `load` method on this class: both
   * loader interfaces name their method `load`, with different signatures, so
   * one class cannot satisfy both directly.
   */
  get taskDefLoader(): TaskDefLoader {
    return { load: (namespaceId, names) => this.loadTaskDefs(namespaceId, names) };
  }

  /**
   * Whether another execution of this definition may start.
   *
   * Checked at start rather than at dispatch: rejecting a workflow before it
   * exists is far kinder than admitting it and then stalling every task, which
   * looks identical to a broken worker pool.
   */
  async canStartAnother(
    namespaceId: string,
    defName: string,
    defVersion: number,
    running: number
  ): Promise<boolean> {
    const blueprint = await this.load(namespaceId, defName, defVersion);
    if (blueprint.maxConcurrentExecutions <= 0) return true;
    return running < blueprint.maxConcurrentExecutions;
  }

  /** The rate-limit bucket a start of this version with this input belongs to. */
  async rateLimitFor(
    namespaceId: string,
    defName: string,
    defVersion: number,
    input: Record<string, JsonValue> | undefined
  ): Promise<{ key: string; limit: number } | undefined> {
    const blueprint = await this.load(namespaceId, defName, defVersion).catch(() => undefined);
    return blueprint ? rateLimitFor(blueprint, input) : undefined;
  }

  /** Drops cached blueprints and task definitions. For tests and hot-reload. */
  clearCaches(): void {
    this.blueprintCache.clear();
    this.taskDefCache.clear();
  }

  // ------------------------------------------------------------------ helpers

  private async findDefinitionRow(namespaceId: string, name: string, version?: number) {
    let query = this.db
      .selectFrom('WorkflowDefinitions')
      .selectAll()
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name);

    if (version !== undefined) query = query.where('version', '=', version);
    else query = query.orderBy('version', 'desc');

    return (await query.executeTakeFirst()) ?? null;
  }

  private key(namespaceId: string, name: string, version: number): string {
    return `${namespaceId}:${name}:${version}`;
  }

  private cacheBlueprint(key: string, blueprint: Blueprint): void {
    // Crude LRU: entries are immutable, so evicting the oldest insertion is
    // sufficient and avoids tracking access order on a hot read path.
    if (this.blueprintCache.size >= this.maxCachedBlueprints) {
      const oldest = this.blueprintCache.keys().next().value;
      if (oldest !== undefined) this.blueprintCache.delete(oldest);
    }
    this.blueprintCache.set(key, blueprint);
  }
}

/**
 * Drops null-valued keys before schema validation.
 *
 * SQL represents "absent" as `NULL`; Zod's `.optional()` accepts only
 * `undefined`, so a nullable column read straight back fails validation with
 * "expected string, received null". Keeping the schemas strict is right —
 * `null` genuinely *is* invalid in a user-submitted definition — so the
 * representation gap is closed here, at the storage boundary, rather than by
 * loosening the domain contract everywhere.
 */
function stripNulls(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

/** Flattens a blueprint's Maps so it survives storage as JSONB. */
function serialiseBlueprint(blueprint: Blueprint): Record<string, JsonValue> {
  return {
    name: blueprint.name,
    version: blueprint.version,
    entryRef: blueprint.entryRef,
    allStaticRefs: blueprint.allStaticRefs,
    size: blueprint.size,
    nodes: Object.fromEntries(
      [...blueprint.nodes.entries()].map(([ref, node]) => [
        ref,
        {
          ref: node.ref,
          name: node.name,
          type: node.type,
          next: node.next,
          staticRefs: node.staticRefs,
          location: { ...node.location } as unknown as JsonValue,
          forkBranchHeads: node.forkBranchHeads ?? null,
          forkBranchTips: node.forkBranchTips ?? null,
          joinRef: node.joinRef ?? null,
          joinOn: node.joinOn ?? null,
          caseHeads: node.caseHeads ?? null,
          defaultHead: node.defaultHead ?? null,
          loopHead: node.loopHead ?? null,
        },
      ])
    ),
  } as Record<string, JsonValue>;
}

/**
 * The one error for "this version is already registered".
 *
 * Shared by the pre-check and the unique-violation path so the two cannot drift
 * — a caller that loses the race must not get a differently worded answer from
 * one that arrives second.
 */
function versionExists(name: string, version: number): NodeFlowError {
  return new NodeFlowError(
    ErrorCode.CONFLICT,
    `workflow "${name}" version ${version} already exists; register a new version instead`,
    { name, version }
  );
}

/** The name out of an unvalidated definition, for the pre-validation check. */
function nameOf(definition: unknown): string {
  return typeof definition === 'object' && definition !== null && 'name' in definition
    ? String((definition as { name: unknown }).name)
    : '';
}

export interface WorkflowListing {
  name: string;
  version: number;
  tags: string[];
  description: string | null;
  ownerEmail: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface DefinitionIssue {
  message: string;
  /**
   * Where in the definition, as the path of keys and indices from its root —
   * `['tasks', 2, 'decisionCases', 'approved', 0, 'name']`. Present for schema
   * issues; the editor addresses nodes by exactly this path, which is why it is
   * passed through rather than flattened into the message.
   */
  path?: (string | number)[];
  /** The task at fault, for compile issues — which locate by ref, not path. */
  taskReferenceName?: string;
  details?: Record<string, unknown>;
}

export type DefinitionCheck =
  | { valid: true; definition: WorkflowDefinitionSpec; blueprint: Blueprint }
  | { valid: false; stage: 'schema' | 'compile'; issues: DefinitionIssue[] };

/**
 * Validates and compiles a definition without storing it.
 *
 * The one implementation behind both registration and the editor's dry run.
 * That is the whole reason it is a function rather than two call sites: an
 * editor that says "valid" about something registration then refuses is worse
 * than no validation at all, because it teaches people to stop trusting it.
 *
 * Schema issues all come back at once; compilation stops at the first, because
 * the compiler throws. That asymmetry is real and is reported as `stage` rather
 * than papered over.
 */
/**
 * A schema failure, said out loud.
 *
 * The message used to be the bare sentence "workflow definition failed
 * validation", with the offending paths attached as structured detail. That is
 * fine for a client that reads the whole error body and useless for every
 * client that does not — which includes Conductor's own SDKs, whose error
 * handler reads `message` and nothing else. A registration failure against a
 * sixty-workflow project then named neither the workflow nor the field, and the
 * only way forward was to bisect by hand.
 *
 * The first three paths, because one is usually enough and a hundred is a wall
 * of text; the count says how many more there are.
 */
function schemaFailureMessage(issues: DefinitionIssue[]): string {
  const named = issues
    .slice(0, 3)
    .map((issue) =>
      issue.path && issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message
    );

  const more = issues.length - named.length;
  return `workflow definition failed validation — ${named.join('; ')}${more > 0 ? ` (and ${more} more)` : ''}`;
}

export function checkDefinition(input: unknown): DefinitionCheck {
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      stage: 'schema',
      issues: parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.filter(
          (segment): segment is string | number => typeof segment !== 'symbol'
        ),
      })),
    };
  }

  try {
    const blueprint = compileBlueprint(parsed.data);

    // Rules for *new* definitions only, which is why they are here and not in
    // the compiler: stored definitions are recompiled on load, and tightening
    // the compiler would stop existing workflows from loading.
    for (const node of blueprint.nodes.values()) {
      const problem =
        node.task.type === TaskType.DO_WHILE
          ? loopConditionProblem(node.task.loopCondition)
          : node.task.type === TaskType.SWITCH
            ? switchExpressionProblem(node.task)
            : undefined;
      if (problem) {
        return {
          valid: false,
          stage: 'compile',
          issues: [
            {
              message: `${node.task.type} "${node.ref}": ${problem}`,
              taskReferenceName: node.ref,
              details: { taskReferenceName: node.ref },
            },
          ],
        };
      }
    }

    return { valid: true, definition: parsed.data, blueprint };
  } catch (error) {
    // Both of the compiler's error types, not one. `CompilationError` is rarer
    // — a definition that compiles to nothing executable — and catching only
    // `InvalidDefinitionError` turned it into a 500 from an endpoint whose whole
    // job is to report such things as a verdict.
    if (!(error instanceof InvalidDefinitionError) && !(error instanceof CompilationError)) {
      throw error;
    }

    const details = (error.details ?? {}) as Record<string, unknown>;
    return {
      valid: false,
      stage: 'compile',
      issues: [
        {
          message: error.message,
          taskReferenceName:
            typeof details['taskReferenceName'] === 'string'
              ? details['taskReferenceName']
              : undefined,
          details,
        },
      ],
    };
  }
}

/** Escapes `LIKE` wildcards, so a name containing `_` or `%` matches only itself. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
