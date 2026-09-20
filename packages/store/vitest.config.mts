import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/store',
  // Resolve workspace packages to their TypeScript source, matching the
  // `customConditions` in tsconfig.base.json.
  //
  // Without this, Vite falls through to the "import" condition and loads a
  // sibling package's built dist/. Running `npx vitest` directly then tests a
  // STALE build of every dependency — `nx test` happens to rebuild them first,
  // so the two disagree and the direct run silently reports on old code.
  resolve: { conditions: ['@node-flow-dev/source'] },
  test: {
    name: 'store',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    // These are integration tests against a real Postgres in Docker. Pulling
    // the image and running migrations dwarfs Vitest's 5s default.
    testTimeout: 60_000,
    hookTimeout: 240_000,
    // One container per file, shared by its suites. Running files in parallel
    // would start a Postgres each and fight for Docker and CPU.
    fileParallelism: false,
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
