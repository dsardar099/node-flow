import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vitest.config.{js,ts,mjs,mts}',
            // Test-only harness: excluded from the lib build so testcontainers
            // never reaches published output.
            '{projectRoot}/src/lib/testing/**',
          ],
          // pg is required at runtime but never imported: Kysely's
          // PostgresDialect takes the Pool we construct, and the driver itself
          // is resolved by the dialect rather than by our source.
          ignoredDependencies: ['pg'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
