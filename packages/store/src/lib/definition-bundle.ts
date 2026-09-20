import {
  InvalidArgumentError,
  TaskType,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type JsonValue,
  type TaskDefinition,
  type WorkflowTask,
} from '@node-flow-dev/core';
import { checkDefinition, reaches, type MetadataRepository, type TagAccess } from './metadata.repository.js';

/**
 * Workflows and task definitions as one portable JSON file.
 *
 * Export follows what a workflow needs to run somewhere else — the task
 * definitions its worker tasks use, the sub-workflows, started workflows and
 * failure workflow it names — so an exported bundle imports into an empty
 * namespace and works. Tag-protected workflows the caller cannot reach are left
 * out, as they are from every other listing.
 *
 * Import validates the **whole** bundle before writing any of it: a file with
 * one broken definition in forty imports nothing and says which one, rather
 * than leaving a namespace half-migrated. Workflow versions are immutable, so a
 * version that already exists is `unchanged` when identical and a conflict when
 * not — skipped, or registered as the next version, as asked.
 */

export const BUNDLE_FORMAT = 'node-flow.definitions';
export const BUNDLE_FORMAT_VERSION = 1;

type Definition = Record<string, JsonValue>;

export interface DefinitionBundle {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  workflows: Definition[];
  taskDefinitions: Definition[];
}

export interface ExportOptions {
  /** Workflow names; everything reachable when omitted. */
  workflows?: string[];
  /** `latest` (default) or every registered version. */
  versions?: 'latest' | 'all';
  /** Follow sub-workflow, start-workflow and failure-workflow references. Default true. */
  includeDependencies?: boolean;
}

export type ImportAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'new-version' | 'invalid';

export interface ImportItem {
  kind: 'workflow' | 'taskDefinition';
  name: string;
  version?: number;
  /** For `new-version`: the version it was registered as. */
  importedAs?: number;
  action: ImportAction;
  message?: string;
}

export interface ImportOptions {
  /** A workflow version that exists with different content: skip it, or register it as the next version. */
  workflowConflicts?: 'skip' | 'new-version';
  /** A task definition that exists with different settings: keep the existing one, or overwrite it. */
  taskDefinitionConflicts?: 'skip' | 'overwrite';
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
}

export interface ImportReport {
  dryRun: boolean;
  /** False when anything in the bundle is invalid; nothing is written then. */
  applied: boolean;
  items: ImportItem[];
  summary: Record<ImportAction, number>;
}

const MAX_ITEMS = 1000;

export async function exportDefinitions(
  metadata: MetadataRepository,
  namespaceId: string,
  access: TagAccess,
  options: ExportOptions = {}
): Promise<DefinitionBundle> {
  const listing = await metadata.listWorkflows(namespaceId, access);
  const versionsByName = new Map<string, number[]>();
  for (const row of listing) versionsByName.set(row.name, [...(versionsByName.get(row.name) ?? []), row.version]);

  const wanted = options.workflows ?? [...versionsByName.keys()];
  for (const name of wanted) {
    if (!versionsByName.has(name)) throw new InvalidArgumentError(`no workflow "${name}" to export`);
  }

  const workflows = new Map<string, Definition>();
  const queue: { name: string; version?: number }[] = wanted.map((name) => ({ name }));
  const followed = new Set<string>();

  while (queue.length > 0) {
    const next = queue.shift() as { name: string; version?: number };
    const available = versionsByName.get(next.name);
    // A dependency the caller cannot reach, or that does not exist, is left out;
    // importing without it still works wherever it already exists.
    if (!available) continue;
    const versions =
      next.version !== undefined
        ? available.filter((v) => v === next.version)
        : options.versions === 'all' && wanted.includes(next.name)
          ? available
          : [Math.max(...available)];

    for (const version of versions) {
      const key = `${next.name}@${version}`;
      if (workflows.has(key)) continue;
      const definition = await metadata.getWorkflowDefinition(namespaceId, next.name, access, version);
      if (!definition) continue;
      const tags = (await metadata.tagsOf(namespaceId, next.name)) ?? [];
      workflows.set(key, { ...(definition as unknown as Definition), tags });

      if (options.includeDependencies !== false) {
        for (const dependency of workflowDependencies(definition as unknown as Definition)) {
          const depKey = `${dependency.name}@${dependency.version ?? 'latest'}`;
          if (followed.has(depKey)) continue;
          followed.add(depKey);
          queue.push(dependency);
        }
      }
    }
  }

  const workerTasks = new Set<string>();
  for (const definition of workflows.values()) for (const name of workerTaskNames(definition)) workerTasks.add(name);
  const taskDefinitions = (await metadata.listTaskDefinitions(namespaceId)).filter(
    (def) => options.workflows === undefined || workerTasks.has(def.name)
  );

  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    workflows: [...workflows.values()].sort(byNameThenVersion),
    taskDefinitions: taskDefinitions.map((def) => def as unknown as Definition),
  };
}

export async function importDefinitions(
  metadata: MetadataRepository,
  namespaceId: string,
  access: TagAccess,
  bundle: unknown,
  options: ImportOptions & {
    createdBy?: string;
    /** Called before each new workflow version is written — the quota check. */
    beforeCreate?: () => Promise<void>;
  } = {}
): Promise<ImportReport> {
  const parsed = readBundle(bundle);
  const items: ImportItem[] = [];
  const dryRun = options.dryRun ?? false;

  // ---- plan: everything is checked before anything is written.
  const taskPlan: { spec: TaskDefinition; item: ImportItem }[] = [];
  for (const [index, raw] of parsed.taskDefinitions.entries()) {
    const result = taskDefinitionSchema.safeParse(raw);
    const name = typeof raw['name'] === 'string' ? raw['name'] : `taskDefinitions[${index}]`;
    if (!result.success) {
      items.push({ kind: 'taskDefinition', name, action: 'invalid', message: result.error.issues[0]?.message ?? 'invalid' });
      continue;
    }
    const existing = await metadata.getTaskDefinition(namespaceId, result.data.name);
    const item: ImportItem = { kind: 'taskDefinition', name: result.data.name, action: 'created' };
    if (existing) {
      if (stable(existing) === stable(result.data)) item.action = 'unchanged';
      else if ((options.taskDefinitionConflicts ?? 'skip') === 'overwrite') item.action = 'updated';
      else {
        item.action = 'skipped';
        item.message = 'a task definition with this name exists with different settings';
      }
    }
    items.push(item);
    taskPlan.push({ spec: result.data, item });
  }

  const workflowPlan: { definition: Definition; tags: string[]; item: ImportItem }[] = [];
  // Imported in version order, so "register as the next version" numbers
  // several conflicting versions of one workflow in the order they were written.
  const nextVersion = new Map<string, number>();
  // A bumped version must not take a number the bundle itself declares later:
  // bumping a conflicting v1 to v2 while the bundle also brings a v2 collides.
  for (const raw of parsed.workflows) {
    if (typeof raw['name'] === 'string' && typeof raw['version'] === 'number') {
      nextVersion.set(raw['name'], Math.max(nextVersion.get(raw['name']) ?? 0, raw['version']));
    }
  }
  for (const [index, raw] of [...parsed.workflows].sort(byNameThenVersion).entries()) {
    const name = typeof raw['name'] === 'string' ? raw['name'] : `workflows[${index}]`;
    const checked = checkDefinition(raw);
    if (!checked.valid) {
      items.push({ kind: 'workflow', name, action: 'invalid', message: checked.issues[0]?.message ?? 'invalid definition' });
      continue;
    }
    const definition = checked.definition;
    const tags = Array.isArray(raw['tags']) ? (raw['tags'] as string[]) : [];
    const item: ImportItem = { kind: 'workflow', name: definition.name, version: definition.version, action: 'created' };

    const existingTags = await metadata.tagsOf(namespaceId, definition.name);
    if (
      existingTags
        ? !reaches(access, 'UPDATE', definition.name, existingTags)
        : access.can && !access.can('UPDATE', definition.name, tags)
    ) {
      items.push({ ...item, action: 'invalid', message: 'a workflow with this name exists and is not reachable with your tag grants' });
      continue;
    }

    const existing = await metadata.getWorkflowDefinition(namespaceId, definition.name, access, definition.version);
    if (existing) {
      if (comparable(existing as unknown as Definition) === comparable(definition as unknown as Definition)) {
        item.action = 'unchanged';
      } else if ((options.workflowConflicts ?? 'skip') === 'new-version') {
        const latest = Math.max(nextVersion.get(definition.name) ?? 0, (await metadata.latestVersion(namespaceId, definition.name)) ?? 0);
        item.action = 'new-version';
        item.importedAs = latest + 1;
        nextVersion.set(definition.name, latest + 1);
      } else {
        item.action = 'skipped';
        item.message = `version ${definition.version} exists with different content`;
      }
    } else {
      nextVersion.set(definition.name, Math.max(nextVersion.get(definition.name) ?? 0, definition.version));
    }
    items.push(item);
    workflowPlan.push({ definition: definition as unknown as Definition, tags, item });
  }

  const invalid = items.some((item) => item.action === 'invalid');
  if (dryRun || invalid) return report(items, dryRun, false);

  // ---- apply: task definitions first, so the workflows that use them compile against them.
  for (const { spec, item } of taskPlan) {
    if (item.action === 'created' || item.action === 'updated') await metadata.upsertTaskDefinition(namespaceId, spec);
  }
  for (const { definition, tags, item } of workflowPlan) {
    if (item.action !== 'created' && item.action !== 'new-version') continue;
    await options.beforeCreate?.();
    await metadata.registerWorkflow({
      namespaceId,
      definition: item.action === 'new-version' ? { ...definition, version: item.importedAs as number } : definition,
      createdBy: options.createdBy,
      // Only tags the bundle states. An empty list would strip the protection
      // from an existing tagged workflow; unstated, its tags are inherited.
      tags: tags.length ? tags : undefined,
      access,
    });
  }
  return report(items, false, true);
}

function readBundle(bundle: unknown): { workflows: Definition[]; taskDefinitions: Definition[] } {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    throw new InvalidArgumentError('an import is a JSON object with "workflows" and "taskDefinitions"');
  }
  const record = bundle as Record<string, unknown>;
  if (record['format'] !== undefined && record['format'] !== BUNDLE_FORMAT) {
    throw new InvalidArgumentError(`"${String(record['format'])}" is not a node-flow definitions bundle`);
  }
  if (typeof record['formatVersion'] === 'number' && record['formatVersion'] > BUNDLE_FORMAT_VERSION) {
    throw new InvalidArgumentError(`this bundle is format version ${record['formatVersion']}; this server reads up to ${BUNDLE_FORMAT_VERSION}`);
  }
  const list = (key: string): Definition[] => {
    const value = record[key];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'object' || entry === null || Array.isArray(entry))) {
      throw new InvalidArgumentError(`"${key}" must be a list of objects`);
    }
    return value as Definition[];
  };
  const workflows = list('workflows');
  const taskDefinitions = list('taskDefinitions');
  if (workflows.length + taskDefinitions.length === 0) throw new InvalidArgumentError('the bundle has no workflows or task definitions');
  if (workflows.length + taskDefinitions.length > MAX_ITEMS) throw new InvalidArgumentError(`a bundle can hold at most ${MAX_ITEMS} definitions`);
  return { workflows, taskDefinitions };
}

function report(items: ImportItem[], dryRun: boolean, applied: boolean): ImportReport {
  const summary = { created: 0, updated: 0, unchanged: 0, skipped: 0, 'new-version': 0, invalid: 0 };
  for (const item of items) summary[item.action] += 1;
  return { dryRun, applied, items, summary };
}

/** Every task in a definition, however deeply nested. */
function walk(tasks: unknown, visit: (task: WorkflowTask) => void): void {
  if (!Array.isArray(tasks)) return;
  for (const task of tasks as WorkflowTask[]) {
    if (!task || typeof task !== 'object') continue;
    visit(task);
    for (const branch of Object.values(task.decisionCases ?? {})) walk(branch, visit);
    walk(task.defaultCase, visit);
    for (const branch of task.forkTasks ?? []) walk(branch, visit);
    walk(task.loopOver, visit);
    if (task.compensateWith && typeof task.compensateWith === 'object') walk([task.compensateWith], visit);
  }
}

function workerTaskNames(definition: Definition): string[] {
  const names: string[] = [];
  walk(definition['tasks'], (task) => {
    if (task.type === TaskType.SIMPLE) names.push(task.name);
    if (typeof task.compensateWith === 'string') names.push(task.compensateWith);
  });
  return names;
}

function workflowDependencies(definition: Definition): { name: string; version?: number }[] {
  const found: { name: string; version?: number }[] = [];
  walk(definition['tasks'], (task) => {
    if (task.subWorkflowParam?.name) found.push({ name: task.subWorkflowParam.name, version: task.subWorkflowParam.version });
    const start = task.inputParameters?.['startWorkflow'];
    if (start && typeof start === 'object' && !Array.isArray(start) && typeof start['name'] === 'string') {
      found.push({ name: start['name'], version: typeof start['version'] === 'number' ? start['version'] : undefined });
    }
    // An agent's workflow tools run as child executions, so they travel with it.
    if (task.type === TaskType.AGENT && Array.isArray(task.inputParameters?.['tools'])) {
      for (const tool of task.inputParameters['tools'] as unknown[]) {
        if (tool && typeof tool === 'object' && (tool as Record<string, unknown>)['type'] === 'workflow' && typeof (tool as Record<string, unknown>)['name'] === 'string') {
          found.push({ name: (tool as Record<string, string>)['name'] });
        }
      }
    }
  });
  if (typeof definition['failureWorkflow'] === 'string') {
    found.push({
      name: definition['failureWorkflow'],
      version: typeof definition['failureWorkflowVersion'] === 'number' ? definition['failureWorkflowVersion'] : undefined,
    });
  }
  return found;
}

function byNameThenVersion(a: Definition, b: Definition): number {
  return String(a['name']).localeCompare(String(b['name'])) || Number(a['version'] ?? 0) - Number(b['version'] ?? 0);
}

/** The definition as the engine sees it, without the fields that never change behaviour. */
function comparable(definition: Definition): string {
  const parsed = workflowDefinitionSchema.safeParse(definition);
  const { tags: _tags, ...rest } = (parsed.success ? parsed.data : definition) as Record<string, unknown>;
  return stable(rest);
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
      : v
  );
}
