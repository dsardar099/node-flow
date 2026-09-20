import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { simulate } from '@node-flow-dev/testkit';

/**
 * The commands that talk to a running server, and `nf test`, which needs none.
 *
 * Connection comes from flags or the environment, in that order:
 * `--url` / `NF_URL`, `--api-key` / `NF_API_KEY`, `--namespace` / `NF_NAMESPACE`.
 * Every command takes `--json` for scripts; without it the output is for people.
 */

type Flags = Record<string, string | boolean>;

export interface Io {
  out(text: string): void;
  err(text: string): void;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  sleep(ms: number): Promise<void>;
}

export class CliError extends Error {}

interface Connection {
  url: string;
  key: string;
  namespace: string;
}

function connection(flags: Flags, io: Io): Connection {
  const pick = (flag: string, env: string, fallback?: string) => {
    const value = typeof flags[flag] === 'string' ? (flags[flag] as string) : io.env[env] ?? fallback;
    if (!value) throw new CliError(`missing --${flag} (or $${env})`);
    return value;
  };
  return {
    url: pick('url', 'NF_URL', 'http://localhost:3000').replace(/\/$/, ''),
    key: pick('api-key', 'NF_API_KEY'),
    namespace: pick('namespace', 'NF_NAMESPACE', 'default'),
  };
}

async function api<T>(io: Io, conn: Connection, method: string, path: string, body?: unknown): Promise<T> {
  const response = await io.fetch(`${conn.url}/v1/ns/${encodeURIComponent(conn.namespace)}${path}`, {
    method,
    headers: { 'x-api-key': conn.key, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const message = (parsed as { message?: string } | undefined)?.message ?? `${response.status} ${response.statusText}`;
    throw new CliError(`${method} ${path} failed: ${message}`);
  }
  return parsed as T;
}

/** A JSON value from `--input '{"a":1}'` or `--input @file.json`. */
async function jsonFlag(flags: Flags, name: string): Promise<Record<string, unknown> | undefined> {
  const raw = flags[name];
  if (raw === undefined || raw === true) return undefined;
  const text = String(raw).startsWith('@') ? await readFile(String(raw).slice(1), 'utf8') : String(raw);
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new CliError(`--${name} must be a JSON object, or @path to a file holding one`);
  }
}

function table(rows: string[][]): string {
  if (rows.length === 0) return '';
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : (cell ?? '').padEnd(widths[i]))).join('  ')).join('\n') + '\n';
}

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'TIMED_OUT', 'TERMINATED']);

// ------------------------------------------------------------------ workflows

export async function workflows(sub: string | undefined, args: string[], flags: Flags, io: Io): Promise<number> {
  const conn = connection(flags, io);
  switch (sub) {
    case 'list': {
      const rows = await api<{ name: string; version: number; description?: string | null; tags: string[] }[]>(io, conn, 'GET', '/metadata/workflows');
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) if (!latest.has(row.name) || latest.get(row.name)!.version < row.version) latest.set(row.name, row);
      if (flags['json']) return (io.out(`${JSON.stringify([...latest.values()], null, 2)}\n`), 0);
      io.out(table([['NAME', 'VERSION', 'TAGS', 'DESCRIPTION'], ...[...latest.values()].map((w) => [w.name, `v${w.version}`, w.tags.join(',') || '-', w.description ?? ''])]));
      return 0;
    }
    case 'get': {
      const name = args[0];
      if (!name) throw new CliError('usage: nf workflows get <name> [--version N]');
      const version = typeof flags['version'] === 'string' ? `?version=${flags['version']}` : '';
      io.out(`${JSON.stringify(await api(io, conn, 'GET', `/metadata/workflows/${encodeURIComponent(name)}${version}`), null, 2)}\n`);
      return 0;
    }
    case 'register': {
      if (args.length === 0) throw new CliError('usage: nf workflows register <file.json|directory>...');
      const files = await jsonFiles(args);
      let failed = 0;
      for (const file of files) {
        try {
          const definition = JSON.parse(await readFile(file, 'utf8')) as unknown;
          const saved = await api<{ name: string; version: number }>(io, conn, 'POST', '/metadata/workflows', definition);
          io.out(flags['json'] ? `${JSON.stringify({ file, ...saved })}\n` : `registered ${saved.name} v${saved.version}  (${file})\n`);
        } catch (error) {
          failed++;
          io.err(`${file}: ${(error as Error).message}\n`);
        }
      }
      return failed ? 1 : 0;
    }
    default:
      throw new CliError('usage: nf workflows <list|get|register>');
  }
}

async function jsonFiles(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    if ((await stat(path)).isDirectory()) {
      for (const entry of (await readdir(path)).sort()) if (extname(entry) === '.json') out.push(join(path, entry));
    } else out.push(path);
  }
  return out;
}

// ------------------------------------------------------------------ running

export async function runWorkflow(args: string[], flags: Flags, io: Io): Promise<number> {
  const name = args[0];
  if (!name) throw new CliError('usage: nf run <workflow> [--input JSON|@file] [--wait SECONDS] [--correlation-id ID]');
  const conn = connection(flags, io);
  const input = (await jsonFlag(flags, 'input')) ?? {};
  const body = {
    input,
    ...(typeof flags['version'] === 'string' ? { version: Number(flags['version']) } : {}),
    ...(typeof flags['correlation-id'] === 'string' ? { correlationId: flags['correlation-id'] } : {}),
  };

  if (flags['wait'] === undefined) {
    const started = await api<{ workflowId: string; status: string }>(io, conn, 'POST', `/executions/${encodeURIComponent(name)}`, body);
    io.out(flags['json'] ? `${JSON.stringify(started, null, 2)}\n` : `started ${name}: ${started.workflowId}\n`);
    return 0;
  }

  const seconds = flags['wait'] === true ? 30 : Number(flags['wait']);
  if (!Number.isFinite(seconds) || seconds < 0) throw new CliError('--wait takes a number of seconds');
  const result = await api<{ workflowId: string; reached: boolean; status: string; output?: unknown; reasonForIncompletion?: string }>(
    io,
    conn,
    'POST',
    `/executions/${encodeURIComponent(name)}/execute`,
    { ...body, waitForSeconds: Math.min(seconds, 60) }
  );
  if (flags['json']) io.out(`${JSON.stringify(result, null, 2)}\n`);
  else {
    io.out(`${result.workflowId}  ${result.status}${result.reached ? '' : ' (still running)'}\n`);
    if (result.output !== undefined) io.out(`${JSON.stringify(result.output, null, 2)}\n`);
    if (result.reasonForIncompletion) io.err(`reason: ${result.reasonForIncompletion}\n`);
  }
  // A script can branch on the exit code: 0 completed, 2 did not finish, 1 failed.
  return result.status === 'COMPLETED' ? 0 : result.reached ? 1 : 2;
}

// ------------------------------------------------------------------ executions

interface TaskRow {
  refName: string;
  taskType: string;
  status: string;
  attempt: number;
  iteration: number;
  reasonForIncompletion?: string | null;
}

export async function executions(sub: string | undefined, args: string[], flags: Flags, io: Io): Promise<number> {
  const conn = connection(flags, io);
  switch (sub) {
    case 'list': {
      const q = [
        typeof flags['workflow'] === 'string' ? `workflow:${flags['workflow']}` : '',
        typeof flags['status'] === 'string' ? `status:${flags['status']}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const found = await api<{ executions: { workflowId: string; defName: string; defVersion: number; status: string; startedAt: string }[] }>(io, conn, 'POST', '/executions/search', {
        ...(q ? { q } : {}),
        limit: typeof flags['limit'] === 'string' ? Number(flags['limit']) : 20,
      });
      if (flags['json']) return (io.out(`${JSON.stringify(found.executions, null, 2)}\n`), 0);
      io.out(table([['ID', 'WORKFLOW', 'STATUS', 'STARTED'], ...found.executions.map((e) => [e.workflowId, `${e.defName} v${e.defVersion}`, e.status, e.startedAt])]));
      return 0;
    }
    case 'get': {
      const id = args[0];
      if (!id) throw new CliError('usage: nf executions get <id>');
      const execution = await api<{ id: string; defName: string; status: string; output?: unknown; reasonForIncompletion?: string; tasks: TaskRow[] }>(io, conn, 'GET', `/executions/${id}`);
      if (flags['json']) return (io.out(`${JSON.stringify(execution, null, 2)}\n`), 0);
      io.out(`${execution.defName}  ${execution.status}\n`);
      if (execution.reasonForIncompletion) io.out(`reason: ${execution.reasonForIncompletion}\n`);
      io.out(table([['TASK', 'TYPE', 'STATUS', 'ATTEMPT'], ...execution.tasks.map((t) => [taskLabel(t), t.taskType, t.status, String(t.attempt + 1)])]));
      if (execution.output !== undefined && execution.output !== null) io.out(`output: ${JSON.stringify(execution.output)}\n`);
      return 0;
    }
    /**
     * Stop one running task and hold the workflow.
     *
     * Under `executions` rather than as a top-level command because it acts on
     * a run, not on a definition — the same reason `get` and `list` live here.
     */
    case 'cancel-task': {
      const [id, taskRef] = args;
      if (!id || !taskRef) throw new CliError('usage: nf executions cancel-task <id> <task-ref>');

      const result = await api<{ taskRef: string; status: string }>(
        io,
        conn,
        'POST',
        `/executions/${id}/tasks/cancel`,
        { taskRef }
      );

      if (flags['json']) return (io.out(`${JSON.stringify(result, null, 2)}\n`), 0);
      io.out(`cancelled ${result.taskRef}; workflow is ${result.status}\n`);
      // Said plainly, because it is the part people assume otherwise.
      io.out(`the worker was not stopped — its result will be refused when it reports\n`);
      return 0;
    }

    /**
     * Run named tasks again.
     *
     * `--cascade` is opt-in, matching the API. Without it the tasks that now
     * hold outputs from the replaced run are printed rather than left to be
     * discovered, because a partially re-run workflow looks identical to a
     * clean one from the outside.
     */
    case 'rerun-tasks': {
      const [id, ...refs] = args;
      if (!id || refs.length === 0) {
        throw new CliError('usage: nf executions rerun-tasks <id> <task-ref>... [--cascade]');
      }

      const result = await api<{ rerun: string[]; staleDownstream: string[]; cascade: boolean }>(
        io,
        conn,
        'POST',
        `/executions/${id}/rerun-tasks`,
        { taskRefs: refs, cascade: Boolean(flags['cascade']) }
      );

      if (flags['json']) return (io.out(`${JSON.stringify(result, null, 2)}\n`), 0);

      io.out(`re-running ${result.rerun.join(', ')}\n`);
      if (result.staleDownstream.length > 0) {
        io.out(
          `\nstale — still holding output from the run being replaced:\n` +
            `  ${result.staleDownstream.join(', ')}\n` +
            `re-run with --cascade to replace these too\n`
        );
      }
      return 0;
    }

    default:
      throw new CliError('usage: nf executions <list|get|cancel-task|rerun-tasks>');
  }
}

const taskLabel = (t: TaskRow) => `${t.refName}${t.iteration > 0 ? `#${t.iteration}` : ''}`;

/** Follows a run, printing each task change as it happens, until it ends. */
export async function tail(args: string[], flags: Flags, io: Io): Promise<number> {
  const id = args[0];
  if (!id) throw new CliError('usage: nf tail <execution-id> [--interval MS]');
  const conn = connection(flags, io);
  const interval = typeof flags['interval'] === 'string' ? Number(flags['interval']) : 1000;
  const seen = new Map<string, string>();
  let status = '';
  for (;;) {
    const execution = await api<{ status: string; reasonForIncompletion?: string; output?: unknown; tasks: TaskRow[] }>(io, conn, 'GET', `/executions/${id}`);
    for (const task of execution.tasks) {
      const key = `${task.refName}#${task.iteration}#${task.attempt}`;
      if (seen.get(key) === task.status) continue;
      seen.set(key, task.status);
      const line = { at: new Date().toISOString(), task: taskLabel(task), attempt: task.attempt + 1, status: task.status, ...(task.reasonForIncompletion ? { reason: task.reasonForIncompletion } : {}) };
      io.out(flags['json'] ? `${JSON.stringify(line)}\n` : `${line.at.slice(11, 19)}  ${line.task.padEnd(24)} ${task.status}${task.attempt ? ` (attempt ${task.attempt + 1})` : ''}${task.reasonForIncompletion ? ` — ${task.reasonForIncompletion}` : ''}\n`);
    }
    if (execution.status !== status) {
      status = execution.status;
      if (!flags['json']) io.out(`── workflow ${status}\n`);
    }
    if (TERMINAL.has(execution.status)) {
      if (execution.reasonForIncompletion && !flags['json']) io.err(`reason: ${execution.reasonForIncompletion}\n`);
      return execution.status === 'COMPLETED' ? 0 : 1;
    }
    await io.sleep(interval);
  }
}

export async function replay(args: string[], flags: Flags, io: Io): Promise<number> {
  const id = args[0];
  if (!id) throw new CliError('usage: nf replay <execution-id> [--version N]');
  const conn = connection(flags, io);
  const result = await api<{ matches: boolean; replayedVersion: number; recordedVersion: number; divergences: { message: string }[] }>(io, conn, 'POST', `/executions/${id}/replay`, {
    ...(typeof flags['version'] === 'string' ? { version: Number(flags['version']) } : {}),
  });
  if (flags['json']) io.out(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.matches) io.out(`v${result.replayedVersion} reproduces the run exactly\n`);
  else io.out(`${result.divergences.length} difference(s) against v${result.replayedVersion}:\n${result.divergences.map((d) => `  - ${d.message}`).join('\n')}\n`);
  return result.matches ? 0 : 1;
}

// ------------------------------------------------------------------ bundles

export async function exportDefinitions(flags: Flags, io: Io): Promise<number> {
  const conn = connection(flags, io);
  const names = typeof flags['workflows'] === 'string' ? flags['workflows'].split(',').map((n) => n.trim()).filter(Boolean) : undefined;
  const bundle = await api<unknown>(io, conn, 'POST', '/metadata/export', names ? { workflows: names } : {});
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  if (typeof flags['out'] === 'string') {
    await writeFile(flags['out'], text);
    io.out(`wrote ${flags['out']}\n`);
  } else io.out(text);
  return 0;
}

export async function importDefinitions(args: string[], flags: Flags, io: Io): Promise<number> {
  if (!args[0]) throw new CliError('usage: nf import <bundle.json> [--dry-run] [--workflow-conflicts skip|new-version] [--task-conflicts skip|overwrite]');
  const conn = connection(flags, io);
  const bundle = JSON.parse(await readFile(args[0], 'utf8')) as unknown;
  const result = await api<unknown>(io, conn, 'POST', '/metadata/import', {
    bundle,
    ...(flags['dry-run'] ? { dryRun: true } : {}),
    ...(typeof flags['workflow-conflicts'] === 'string' ? { workflowConflicts: flags['workflow-conflicts'] } : {}),
    ...(typeof flags['task-conflicts'] === 'string' ? { taskDefinitionConflicts: flags['task-conflicts'] } : {}),
  });
  io.out(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

// ------------------------------------------------------------------ offline

/**
 * `nf test` — runs a definition through the real engine with no server.
 *
 * A test file is `{ "definition": ..., "input": ..., "mocks": ..., "expect": { "status": ..., "output": ... } }`,
 * or a directory of them; `--definition` and `--mocks` build one from parts.
 * Exit code 1 when any expectation fails, so it drops straight into CI.
 */
export async function test(args: string[], flags: Flags, io: Io): Promise<number> {
  const cases: { file: string; spec: Record<string, unknown> }[] = [];
  if (typeof flags['definition'] === 'string') {
    cases.push({
      file: flags['definition'],
      spec: {
        definition: JSON.parse(await readFile(flags['definition'], 'utf8')),
        input: await jsonFlag(flags, 'input'),
        mocks: await jsonFlag(flags, 'mocks'),
      },
    });
  }
  for (const file of await jsonFiles(args)) cases.push({ file, spec: JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown> });
  if (cases.length === 0) throw new CliError('usage: nf test <test.json|directory>... or nf test --definition wf.json [--input JSON] [--mocks JSON]');

  let failures = 0;
  for (const { file, spec } of cases) {
    const started = Date.now();
    const result = await simulate(spec['definition'], {
      input: (spec['input'] ?? {}) as never,
      mocks: (spec['mocks'] ?? {}) as never,
      taskDefs: (spec['taskDefs'] ?? {}) as never,
      subWorkflows: (spec['subWorkflows'] ?? {}) as never,
    });
    const expected = (spec['expect'] ?? {}) as { status?: string; output?: Record<string, unknown>; tasks?: Record<string, string> };
    const problems: string[] = [];
    if (expected.status && result.status !== expected.status) problems.push(`status ${result.status}, expected ${expected.status}`);
    for (const [path, value] of Object.entries(expected.output ?? {})) {
      const actual = (result.output ?? {})[path];
      if (JSON.stringify(actual) !== JSON.stringify(value)) problems.push(`output.${path} is ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
    }
    for (const [ref, status] of Object.entries(expected.tasks ?? {})) {
      const last = [...result.tasks].reverse().find((t) => t.refName === ref);
      if (last?.status !== status) problems.push(`task ${ref} is ${last?.status ?? 'never run'}, expected ${status}`);
    }
    if (problems.length) failures++;
    if (flags['json']) io.out(`${JSON.stringify({ file, passed: problems.length === 0, status: result.status, output: result.output, problems, unmocked: result.unmocked })}\n`);
    else {
      io.out(`${problems.length ? '✗' : '✓'} ${file}  ${result.status}  ${Date.now() - started} ms\n`);
      for (const problem of problems) io.out(`    ${problem}\n`);
      if (result.unmocked.length && !problems.length) io.out(`    note: completed with empty output because nothing mocked ${result.unmocked.join(', ')}\n`);
    }
  }
  if (!flags['json']) io.out(`\n${cases.length - failures} passed, ${failures} failed\n`);
  return failures ? 1 : 0;
}

