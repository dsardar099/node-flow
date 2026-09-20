import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // The keystone constraint. `core` and `engine` are the pure decider:
            // no framework, no ORM, no I/O. Replay, time-travel debugging and the
            // sub-second engine test suite all depend on this staying true.
            // npm's flat hoisting means these bans are the ONLY thing stopping a
            // stray import resolving at runtime — never waive them.
            {
              sourceTag: 'scope:pure',
              onlyDependOnLibsWithTags: ['scope:pure'],
              bannedExternalImports: [
                '@nestjs/*',
                'sequelize',
                'sequelize-typescript',
                'pg',
                'pg-*',
                'umzug',
                'next',
                'react',
                'react-*',
                'undici',
                'ioredis',
                'kafkajs',
              ],
            },
            // Infrastructure may build on the pure core and on each other,
            // but must not reach up into apps or client tooling.
            {
              sourceTag: 'scope:infra',
              onlyDependOnLibsWithTags: ['scope:pure', 'scope:infra'],
            },
            // Client-facing packages ship to users' machines, so they must not
            // pull in server infrastructure or a database driver.
            //
            // `cli` is deliberately NOT tagged this way. `nf bootstrap` and
            // `nf migrate` exist precisely to do what the API cannot — create
            // the first credential, and change the schema — so they run next to
            // the database by design. It is an operator tool, tagged
            // `scope:app`, not a library shipped to end users. `sdk` is the
            // package this rule is really protecting.
            {
              sourceTag: 'scope:client',
              onlyDependOnLibsWithTags: ['scope:pure', 'scope:client'],
              bannedExternalImports: [
                'sequelize',
                'sequelize-typescript',
                'pg',
                'pg-*',
                'umzug',
              ],
            },
            // Applications compose everything.
            {
              sourceTag: 'scope:app',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
