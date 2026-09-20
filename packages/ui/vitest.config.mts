import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { join } from 'node:path';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/ui',
  plugins: [react()],
  // Resolve workspace packages to their TypeScript source, matching the
  // `customConditions` in tsconfig.base.json.
  //
  // Without this, Vite falls through to the "import" condition and loads a
  // sibling package's built dist/. Running `npx vitest` directly then tests a
  // STALE build of every dependency — `nx test` happens to rebuild them first,
  // so the two disagree and the direct run silently reports on old code.
  //
  // One `resolve` key, holding both this and the alias. There used to be two,
  // and in an object literal the second silently replaces the first — so the
  // `@/` alias existed in tsconfig and not in tests, which surfaces as a module
  // not found the first time a test imports through it.
  resolve: {
    alias: { '@': join(import.meta.dirname, './src') },
    conditions: ['@node-flow-dev/source'],
  },
  test: {
    name: 'ui',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: [
      '{src,app,pages,specs}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
