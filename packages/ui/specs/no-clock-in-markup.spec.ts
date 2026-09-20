import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No page may render a clock- or timezone-dependent string as JSX text.
 *
 * Two of these shipped, and the second one is the reason this file exists.
 * `formatRelative` reads `Date.now()`, so the server and the browser disagree
 * about *when*; `formatDateTime` is built from `getHours()`/`getFullYear()`,
 * so a UTC container and an operator in another timezone disagree about
 * *where*. Either one makes hydration fail with React #418, and React's
 * response is to throw away the server-rendered HTML for the surrounding tree
 * and rebuild it on the client. Nothing looks wrong — that is the trap. The
 * page renders correctly, and the server render it discarded was the point.
 *
 * Fixing the call sites once does not hold: the helpers are ordinary functions
 * and the next page to show a timestamp will reach for them again. So the rule
 * is enforced here rather than remembered. Use `<LocalTime>` or `<Ago>`, which
 * carry the `suppressHydrationWarning` that tells React the difference is
 * expected, or put `suppressHydrationWarning` on the element holding the text.
 *
 * An *attribute* (`title={formatDateTime(x)}`) is fine and deliberately not
 * flagged: `suppressHydrationWarning` covers an element's own attributes along
 * with its direct text children.
 */

/** Anchored to this file, so it does not depend on the runner's directory. */
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Helpers whose result depends on the machine that renders them. */
const CLOCK_DEPENDENT = ['formatDateTime', 'formatTime', 'formatRelative'];

/**
 * `components/ui` is where the suppression lives, so the helpers are called
 * there by design — that is the whole point of those components.
 */
const OWNS_THE_SUPPRESSION = join('components', 'ui');

async function* tsxFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* tsxFiles(path);
    else if (entry.name.endsWith('.tsx')) yield path;
  }
}

/**
 * Functions *defined in this file* that read the clock or the timezone.
 *
 * The shared helpers were only half the problem. A page can define its own
 * `greeting()` or `bucketLabel()` that calls `new Date().getHours()`, render it
 * as JSX text, and break hydration exactly the same way — and two shipped that
 * way before this looked for them. So the rule is about the *property*, not
 * about a list of names.
 */
function localClockReaders(source: string): string[] {
  const names: string[] = [];
  // `function name(...) { ... }` up to the next top-level close brace. Crude,
  // but these are small helpers at module scope, which is where they live.
  for (const match of source.matchAll(/^function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = match;
    if (/new Date\(\s*\)|Date\.now\(\)|getHours\(\)|toLocale(Date|Time)?String\(/.test(body)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * The `{` that opens the JSX expression a call sits inside, or -1.
 *
 * Walks back counting braces, because the call is not always the outermost
 * thing in the expression. `{formatMs(since(x))}` is clock-dependent through
 * its *argument* — `formatMs` is pure — and looking only at the start of the
 * expression missed exactly that, on a page that was failing hydration.
 */
function enclosingExpression(line: string, at: number): number {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    if (line[i] === '}') depth++;
    else if (line[i] === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** Call sites reached from JSX text position, at any nesting depth. */
function clockTextIn(source: string, file: string): string[] {
  const found: string[] = [];
  const suspects = [...CLOCK_DEPENDENT, ...localClockReaders(source)];
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    for (const helper of suspects) {
      for (let from = 0; ; ) {
        const at = line.indexOf(`${helper}(`, from);
        if (at === -1) break;
        from = at + 1;

        // The definition itself, and any other identifier ending in this name.
        if (/[\w.]/.test(line[at - 1] ?? '')) continue;
        if (new RegExp(`function\\s+${helper}\\s*\\(`).test(line)) continue;

        const open = enclosingExpression(line, at - 1);
        if (open === -1) continue;

        // `title={…}` is an attribute; `${…}` is a template literal. Both are
        // fine — the first is covered by suppression on its own element, and
        // the second is checked where the surrounding element is.
        if (/[=$]\s*$/.test(line.slice(0, open))) continue;

        // An element declaring the difference is expected is the fix, not an
        // offence. Looked for above this line too, since the attribute and the
        // text are rarely on the same one.
        const context = lines.slice(Math.max(0, index - 12), index + 1).join('\n');
        if (context.includes('suppressHydrationWarning')) continue;

        found.push(`${file}:${index + 1}  ${line.trim()}`);
        break;
      }
    }
  });
  return found;
}

describe('server-rendered markup', () => {
  it('renders no clock- or timezone-dependent text outside a suppressed element', async () => {
    const offenders: string[] = [];
    for await (const file of tsxFiles(SOURCE)) {
      if (file.includes(OWNS_THE_SUPPRESSION)) continue;
      offenders.push(...clockTextIn(await readFile(file, 'utf8'), relative(SOURCE, file)));
    }
    expect(offenders).toEqual([]);
  });

  // The scan is only worth having if it would actually fail, and a regex over
  // source is exactly the kind of check that quietly stops matching.
  it('detects the call it exists to prevent', () => {
    const offending = '        <span>{formatDateTime(row.startedAt)}</span>';
    expect(clockTextIn(offending, 'x.tsx')).toHaveLength(1);

    // …while leaving the shapes that are genuinely fine alone.
    expect(clockTextIn('  <i title={formatDateTime(x)} />', 'x.tsx')).toEqual([]);
    expect(clockTextIn('  const s = `at ${formatDateTime(x)}`;', 'x.tsx')).toEqual([]);
    expect(
      clockTextIn('<span suppressHydrationWarning>\n  {formatDateTime(x)}\n</span>', 'x.tsx')
    ).toEqual([]);
  });

  /**
   * The half that was missing. Both bugs that reached a browser were local
   * helpers, not the shared ones — a `greeting()` reading `getHours()` and a
   * chart axis label formatting a timestamp in the reader's timezone.
   */
  it('detects a locally defined function that reads the clock', () => {
    const source = [
      'function greeting() {',
      "  const hour = new Date().getHours();",
      "  return hour < 12 ? 'Morning' : 'Afternoon';",
      '}',
      'export function Header() {',
      '  return <h1>{greeting()}</h1>;',
      '}',
    ].join('\n');

    expect(localClockReaders(source)).toContain('greeting');
    expect(clockTextIn(source, 'x.tsx')).toHaveLength(1);
  });

  it('leaves a local function that does not read the clock alone', () => {
    const source = [
      'function shout(text) {',
      '  return text.toUpperCase();',
      '}',
      'export function Header() {',
      '  return <h1>{shout(name)}</h1>;',
      '}',
    ].join('\n');

    expect(localClockReaders(source)).toEqual([]);
    expect(clockTextIn(source, 'x.tsx')).toEqual([]);
  });

  /**
   * The shape that got past the first version of this scan and left
   * `/taskQueue` failing hydration: the clock-dependent call is an *argument*
   * to a pure one, so the expression does not begin with it.
   */
  it('detects a clock-dependent call nested inside a pure one', () => {
    const source = [
      'function since(at) {',
      '  return Date.now() - new Date(at).getTime();',
      '}',
      'export function Row() {',
      '  return <span>{formatMs(since(row.lastPollAt))}</span>;',
      '}',
    ].join('\n');

    expect(clockTextIn(source, 'x.tsx')).toHaveLength(1);
  });
});
