const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { IgnorePlugin } = require('webpack');
const { join } = require('path');

/**
 * NestJS lazily `require()`s a set of optional integrations from inside
 * @nestjs/core and @nestjs/common — WebSockets, microservices, and the
 * class-validator/class-transformer pair behind ValidationPipe. It only needs
 * them if you actually use those features; at runtime the requires sit in
 * try/catch.
 *
 * Webpack resolves statically, so it reports each one as "Module not found"
 * regardless. npm's flat hoisting used to mask some of this; pnpm's strict
 * layout surfaces it honestly, which is the behaviour we want everywhere else.
 *
 * We use zod for validation rather than class-validator, and we have no
 * microservices transport. When RealtimeModule lands and we add
 * @nestjs/websockets for real, drop it from this list and install it.
 */
const OPTIONAL_NEST_INTEGRATIONS = [
  '@nestjs/microservices',
  '@nestjs/websockets',
  'class-validator',
  'class-transformer',
  // platform-fastify peers these for view rendering and static file serving.
  // We are a JSON API and serve the dashboard from a separate Next.js app, so
  // neither is needed.
  '@fastify/view',
  '@fastify/static',
];

/**
 * `jq-wasm` is loaded at runtime, never bundled.
 *
 * Two independent reasons, either of which alone would be decisive:
 *
 *  - **It cannot be bundled.** Its 4 MB Emscripten glue ships as several
 *    independently-built entries in both CJS and ESM, and webpack mis-emits it:
 *    the bundle dies at startup with `__webpack_modules__[moduleId].call is not
 *    a function`, before a line of application code runs.
 *  - **Nothing in the bundle imports it.** Only the jq worker thread does, and
 *    it reaches it by absolute path — see `JqRunner`.
 *
 * `externals` keeps webpack's hands off it and leaves resolution to Node, which
 * finds it beside the bundle. It is a dependency of `server` for exactly that
 * reason, even though no file in `server` mentions it.
 */
const RUNTIME_ONLY = [
  'jq-wasm',
  // pdf.js inside it resolves a worker and its own package.json at runtime, which
  // webpack cannot follow statically. Loaded only when a PDF is parsed.
  'unpdf',
];

module.exports = {
  // An array, because the Nx plugin only merges externals given as one.
  externals: [RUNTIME_ONLY.reduce((all, pkg) => ({ ...all, [pkg]: `commonjs ${pkg}` }), {})],
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new IgnorePlugin({
      checkResource(resource) {
        return OPTIONAL_NEST_INTEGRATIONS.some(
          (pkg) => resource === pkg || resource.startsWith(`${pkg}/`)
        );
      },
    }),
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
      // `RUNTIME_ONLY` above is the whole external list, and nothing decides it
      // implicitly.
      //
      // The default, `'all'`, runs `webpack-node-externals` against the
      // *workspace root* `node_modules`. Under npm's flat hoisting that is
      // approximately "every dependency". Under pnpm it is only the packages
      // the root package.json declares — so which modules ended up external was
      // decided by whether a dependency happened to be declared at the root
      // rather than by anything about the dependency. `tslib` and
      // `@node-saml/node-saml` fell out of the bundle that way, and the
      // resulting image died at startup on `Cannot find module 'tslib'`.
      externalDependencies: 'none',
      // Without this the plugin replaces `externals` above with its own, and the
      // runtime-only packages get bundled after all.
      mergeExternals: true,
    }),
  ],
};
