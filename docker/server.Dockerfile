# The API, decider and pollers — one image, role-selected at runtime.
#
# `NODE_FLOW_ROLES` decides what a container actually runs, so the same image is
# the API, the decider and the poller fleet. Building three images from one
# source tree would mean three things to keep in step and three chances for a
# deploy to run mismatched versions of the engine against one database.
#
# Built from the repository root: `docker build -f docker/server.Dockerfile .`

# ---- build -------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /repo

RUN corepack enable

# Manifests first, so a source-only change reuses the cached install layer —
# which is most changes, and the install is most of the build time.
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

RUN pnpm install --frozen-lockfile --filter server... --filter cli...

COPY . .

# Same reason as the dashboard image: Nx scans every project before running a
# target, and the docs site is not part of this one.
RUN rm -f packages/docs/next.config.mjs

RUN pnpm nx build server

# The two packages webpack deliberately leaves external, dereferenced.
#
# pnpm links dependencies rather than copying them, so `node_modules/jq-wasm` is
# a symlink into the content-addressed `.pnpm` store — and `COPY --from` cannot
# follow a link that points outside what it is copying. `cp -rL` resolves them
# into a plain directory the runtime stage can take as-is. Both packages have no
# dependencies of their own, which is what makes this two directories rather
# than a second install.
RUN mkdir -p /runtime/node_modules \
  && cp -rL packages/server/node_modules/jq-wasm /runtime/node_modules/jq-wasm \
  && cp -rL packages/server/node_modules/unpdf /runtime/node_modules/unpdf

# ---- run ---------------------------------------------------------------------
FROM node:24-alpine AS run
WORKDIR /app

# Never root. A workflow engine runs user-authored `INLINE` scripts and calls
# user-named URLs; the blast radius of any escape should not include the
# container's own filesystem.
RUN addgroup -S nodeflow && adduser -S nodeflow -G nodeflow

ENV NODE_ENV=production

# The server is bundled, so the runtime image carries the bundle and the few
# packages webpack deliberately leaves external — not a second node_modules.
COPY --from=build /repo/packages/server/dist ./dist
COPY --from=build /repo/packages/server/package.json ./package.json
COPY --from=build /runtime/node_modules ./node_modules

USER nodeflow
EXPOSE 3000

# No shell form: with `exec` form PID 1 is node itself, so SIGTERM reaches it
# and the graceful drain — finishing in-flight tasks, flushing the outbox —
# actually runs instead of the container being killed out from under it.
CMD ["node", "dist/main.js"]
