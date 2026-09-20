import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest for the NestJS app, with SWC doing the transform.
 *
 * **This plugin is not optional and its absence does not fail loudly.** Vitest
 * transpiles with esbuild, which does not emit `design:paramtypes` decorator
 * metadata. NestJS reads exactly that metadata to resolve constructor
 * injection, and without it DI does not throw — it resolves every dependency to
 * `undefined`, and tests fail later with unrelated errors like "cannot read
 * property of undefined" somewhere deep in a repository.
 *
 * SWC emits the metadata, so DI behaves as it does in the built application.
 */
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/server',
  plugins: [
    swc.vite({
      // Nest's decorators are the legacy (stage 2) form, not the TC39 standard
      // ones; the two are not interchangeable and the wrong choice produces the
      // same silent `undefined` injection.
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
        keepClassNames: true,
      },
      module: { type: 'es6' },
      sourceMaps: true,
    }),
  ],
  // Resolve workspace packages to TypeScript source rather than a sibling's
  // built dist/. Without it, a direct `npx vitest` silently tests a stale build
  // of every dependency while `nx test` — which rebuilds first — tests current
  // code, and the two disagree.
  resolve: { conditions: ['@node-flow-dev/source'] },
  test: {
    name: 'server',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    reporters: ['default'],
    // Boots a real Postgres and the whole Nest container per file.
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
