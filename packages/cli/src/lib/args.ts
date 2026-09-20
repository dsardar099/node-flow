/**
 * Argument parsing, by hand.
 *
 * `commander` and `yargs` are both excellent and both larger than this file.
 * The CLI has a handful of flags and no subcommand tree worth a framework; when
 * it grows one — `nf run`, `nf tail`, `nf test` in Phase 9 — that is the moment
 * to reach for a library, not before.
 */

export interface ParsedArgs {
  command?: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const argument = rest[i];

    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }

    const body = argument.slice(2);

    // `--key=value` and `--key value` are both common; supporting only one is
    // the kind of papercut that makes a tool feel unfinished.
    const equals = body.indexOf('=');
    if (equals !== -1) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }

    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[body] = true;
    } else {
      flags[body] = next;
      i++;
    }
  }

  return { command, flags, positional };
}

/** Reads a flag as a string, or fails with a message naming the flag. */
export function requireString(
  flags: Record<string, string | boolean>,
  name: string,
  fallback?: string
): string {
  const value = flags[name];
  if (typeof value === 'string' && value !== '') return value;
  if (fallback !== undefined && fallback !== '') return fallback;

  throw new Error(`--${name} is required`);
}

/** Comma-separated list, or undefined when the flag was not given. */
export function optionalList(
  flags: Record<string, string | boolean>,
  name: string
): string[] | undefined {
  const value = flags[name];
  if (typeof value !== 'string') return undefined;

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
