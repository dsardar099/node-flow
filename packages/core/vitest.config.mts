import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/core',
  // Resolve workspace packages to their TypeScript source, matching the
  // `customConditions` in tsconfig.base.json.
  //
  // Without this, Vite falls through to the "import" condition and loads a
  // sibling package's built dist/. Running `npx vitest` directly then tests a
  // STALE build of every dependency — `nx test` happens to rebuild them first,
  // so the two disagree and the direct run silently reports on old code.
  resolve: { conditions: ['@node-flow-dev/source'] },
  test: {
    name: 'core',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
