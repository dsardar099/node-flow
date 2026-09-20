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
          ],
          // `jq-wasm` is imported by the jq worker thread, whose body is a
          // source string rather than a module — see `JqRunner` for why it has
          // to be. Static analysis cannot see through that, so the rule reports
          // a real dependency as unused. It stays declared here because the
          // tests resolve it from this package.
          ignoredDependencies: ['jq-wasm'],
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
