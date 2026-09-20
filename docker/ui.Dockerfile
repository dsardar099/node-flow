# The dashboard.
#
# Next.js in standalone mode, so the runtime image is the server bundle and its
# traced dependencies rather than the whole `node_modules` — the difference
# between a ~200 MB image and a ~1 GB one.
#
# Built from the repository root: `docker build -f docker/ui.Dockerfile .`

# ---- build -------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/engine/package.json packages/engine/
COPY packages/store/package.json packages/store/
COPY packages/tasks/package.json packages/tasks/
COPY packages/sdk/package.json packages/sdk/
COPY packages/cli/package.json packages/cli/
COPY packages/server/package.json packages/server/
COPY packages/testkit/package.json packages/testkit/
COPY packages/bpmn/package.json packages/bpmn/
COPY packages/bench/package.json packages/bench/
COPY packages/ui/package.json packages/ui/
# The docs site (including the landing page) is deployed separately — but the
# lockfile describes the whole workspace, so `--frozen-lockfile`
# fails unless every member manifest exists. Copied, then excluded by --filter.
COPY packages/docs/package.json packages/docs/

RUN pnpm install --frozen-lockfile --filter ui...

COPY . .

# Nx builds a graph of every project before running any target, and the
# @nx/next plugin loads every Next config it finds — including the docs
# site's, which imports `fumadocs-mdx` that --filter deliberately did not
# install. Removing that config skips Next target inference for the docs site.
#
# The directory itself stays: the root tsconfig references it, and deleting
# it makes that reference stale, which Nx fails the build over.
RUN rm -f packages/docs/next.config.mjs

RUN pnpm nx build ui

# ---- run ---------------------------------------------------------------------
FROM node:24-alpine AS run
WORKDIR /app

RUN addgroup -S nodeflow && adduser -S nodeflow -G nodeflow

ENV NODE_ENV=production
ENV PORT=3100
# Where the dashboard's server-side proxy sends API calls. Same-origin from the
# browser's point of view, which is what keeps the session cookie working
# without CORS.
ENV NODE_FLOW_API_URL=http://server:3000

COPY --from=build /repo/packages/ui/.next/standalone ./
COPY --from=build /repo/packages/ui/.next/static ./packages/ui/.next/static
COPY --from=build /repo/packages/ui/public ./packages/ui/public

USER nodeflow
EXPOSE 3100

CMD ["node", "packages/ui/server.js"]
