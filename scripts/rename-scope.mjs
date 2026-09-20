/**
 * Renames the npm scope across the whole workspace.
 *
 * `@node-flow` on npm belongs to someone else — `@node-flow/core` and
 * `@node-flow/cli` are published there by an unrelated project — so publishing
 * means moving to a name we own. That touches every import in the repository,
 * which is exactly the sort of change nobody wants to make by hand at release
 * time.
 *
 *   node scripts/rename-scope.mjs @acme          # scoped:   @acme/core
 *   node scripts/rename-scope.mjs nodeflow-      # unscoped: nodeflow-core
 *   node scripts/rename-scope.mjs @acme --dry-run
 *
 * A trailing `/` is implied for a scope and must be explicit for a prefix, so
 * the two forms cannot be confused.
 *
 * What it deliberately does *not* rename is the Nx project names (`core`,
 * `server`, …). Those are internal identifiers that appear in task graphs,
 * cache keys and every `nx run` anyone has typed; they have nothing to do with
 * what npm calls the package.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const CURRENT = '@node-flow';

/** Extensions worth rewriting. Anything else is either binary or generated. */
const EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.mjs', '.cjs', '.jsx',
  '.json', '.md', '.yml', '.yaml',
]);

/** Never descend into these: generated, installed, or not ours to rewrite. */
const SKIP = new Set(['node_modules', 'dist', '.git', '.nx', 'out-tsc', 'coverage', 'test-output', '.next']);

/**
 * Files this must not touch, for two different reasons.
 *
 * The lockfile is *derived*: `pnpm install` rewrites it from the manifests, and
 * editing it by hand produces a file that disagrees with its own integrity
 * hashes. Rewriting it here would look like it worked and fail on the next
 * `--frozen-lockfile` install.
 *
 * This script names the old scope in its own constant and its own usage text,
 * so rewriting itself would leave it unable to find anything the second time.
 */
const SKIP_FILES = new Set(['pnpm-lock.yaml', join('scripts', 'rename-scope.mjs')]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    if (dot > 0 && EXTENSIONS.has(entry.name.slice(dot))) yield path;
  }
}

function targetFor(raw) {
  if (raw.startsWith('@')) {
    // A scope: `@acme` and `@acme/` mean the same thing.
    const scope = raw.replace(/\/+$/, '');
    if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) throw new Error(`"${raw}" is not a usable npm scope`);
    return { replacement: `${scope}/`, describe: `${scope}/<package>` };
  }

  // A prefix for unscoped names, which must say so with a separator.
  if (!/[-_.]$/.test(raw)) {
    throw new Error(`"${raw}" looks like an unscoped prefix but does not end in - _ or . — write "${raw}-" if that is what you meant`);
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(raw)) throw new Error(`"${raw}" is not a usable npm name prefix`);
  return { replacement: raw, describe: `${raw}<package>` };
}

const [rawTarget, ...rest] = process.argv.slice(2);
const dryRun = rest.includes('--dry-run');

if (!rawTarget) {
  console.error('usage: node scripts/rename-scope.mjs <@scope|prefix-> [--dry-run]');
  process.exit(2);
}

let target;
try {
  target = targetFor(rawTarget);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const root = process.cwd();
// `@node-flow/` → the new prefix. Matching the trailing slash is what keeps
// this from touching a bare mention of the old scope in prose.
const pattern = new RegExp(`${CURRENT.replace('/', '\\/')}\\/`, 'g');

let changedFiles = 0;
let changedOccurrences = 0;

for await (const file of walk(root)) {
  if (SKIP_FILES.has(relative(root, file))) continue;

  const before = await readFile(file, 'utf8');
  if (!before.includes(`${CURRENT}/`)) continue;

  const occurrences = before.match(pattern)?.length ?? 0;
  const after = before.replace(pattern, target.replacement);

  changedFiles += 1;
  changedOccurrences += occurrences;

  if (dryRun) {
    console.log(`  ${relative(root, file)}  (${occurrences})`);
  } else {
    await writeFile(file, after);
  }
}

console.log(
  `\n${dryRun ? 'would rewrite' : 'rewrote'} ${changedOccurrences} occurrences in ${changedFiles} files → ${target.describe}`
);

if (!dryRun) {
  console.log(
    [
      '',
      'Next:',
      '  pnpm install            # relink the workspace under the new names',
      '  pnpm nx reset           # the task graph caches the old ones',
      '  pnpm nx run-many -t build test lint typecheck',
      '',
      'The `@node-flow/source` export condition was renamed with everything',
      'else; it is internal to this workspace, so nothing outside depends on it.',
    ].join('\n')
  );
}
