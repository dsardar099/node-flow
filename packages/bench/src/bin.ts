#!/usr/bin/env node
import { main } from './lib/cli.js';

/**
 * Entry point for `nf-bench`.
 *
 * `process.exitCode` rather than `process.exit()`, so a report written to
 * stdout is flushed before the process ends — the same reason the `nf` binary
 * does it.
 */
main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
