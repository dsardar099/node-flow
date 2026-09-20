#!/usr/bin/env node
import { run } from './lib/main.js';

/**
 * Entry point for the `nf` binary.
 *
 * `process.exitCode` rather than `process.exit()`: the latter terminates
 * immediately and can truncate stdout that has been written but not yet
 * flushed, which turns "here is your API key" into a blank line at exactly the
 * moment it matters.
 */
run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
