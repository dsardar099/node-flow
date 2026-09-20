//@ts-check

/**
 * The dashboard.
 *
 * The API is reached same-origin through a proxy **route handler**, not CORS
 * and not `rewrites()`. Rewrites are baked into the build, which would fix the
 * API's address at image-build time; see `src/app/v1/[...path]/route.ts`.
 *
 * Redirects, by contrast, are fixed paths and belong here: they keep links to
 * the dashboard's earlier URLs working — in logs, alerts and bookmarks.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  /**
   * Standalone output, for the container image.
   *
   * Next traces the files the server actually needs and copies them next to a
   * generated `server.js`, so the runtime image carries those rather than the
   * whole workspace `node_modules` — roughly 200 MB instead of a gigabyte. It
   * changes nothing about `next dev` or `next start` locally.
   */
  output: 'standalone',
  async redirects() {
    return [
      { source: '/workflows', destination: '/workflowDef', permanent: false },
      { source: '/workflows/:name/edit', destination: '/workflowDef/:name', permanent: false },
      { source: '/workflows/:name', destination: '/workflowDef/:name', permanent: false },
      { source: '/new-workflow', destination: '/newWorkflowDef', permanent: false },
      { source: '/executions/:id', destination: '/execution/:id', permanent: false },
      { source: '/inbox', destination: '/human/tasks', permanent: false },
      { source: '/schedules', destination: '/scheduleDef', permanent: false },
      { source: '/queues', destination: '/taskQueue', permanent: false },
    ];
  },
};

module.exports = nextConfig;
