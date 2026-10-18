# Shared multi-stage build for every Node backend service.
#   docker build -f infrastructure/docker/node-service.Dockerfile \
#     --build-arg APP=@dpp/project-service --build-arg APP_DIR=apps/project-service .
# Exact versions, so a rebuild of the same commit gets the same base; Dependabot proposes updates.
ARG NODE_IMAGE=node:24.21.0-alpine3.24

# 1. Reduce the monorepo to the target service and its internal dependencies.
FROM ${NODE_IMAGE} AS prune
ARG APP
WORKDIR /repo
COPY . .
RUN npx --yes turbo@2.11.4 prune "${APP}" --docker

# 2. Install all dependencies (dev included) and compile.
FROM ${NODE_IMAGE} AS build
ARG APP
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
# The npm cache is a BuildKit cache mount: packages are downloaded once and reused across
# images and rebuilds (and a build that fails part-way keeps what it fetched). Retries ride out
# transient registry/network resets.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --prefer-offline --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY --from=prune /repo/out/full/ ./
COPY tsconfig.base.json ./
RUN npx turbo run build --filter="${APP}..." \
 && mkdir /deploy \
 && for dir in apps/* packages/*; do \
      [ -f "$dir/package.json" ] || continue; \
      mkdir -p "/deploy/$dir" && cp "$dir/package.json" "/deploy/$dir/"; \
      [ -d "$dir/dist" ] && cp -r "$dir/dist" "/deploy/$dir/"; \
      [ -d "$dir/migrations" ] && cp -r "$dir/migrations" "/deploy/$dir/"; \
    done; true

# 3. Production dependencies only; no compilers or dev tooling in the final image.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts --prefer-offline --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# 4. Runtime image.
FROM ${NODE_IMAGE} AS runtime
ARG APP_DIR
ENV NODE_ENV=production
# Services start with `node` directly; the package managers are only attack surface here.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /deploy ./
# Public CA bundle for TLS to Amazon RDS (used when DATABASE_TLS_CA_FILE points at it).
COPY --chown=node:node infrastructure/certs/ /app/certs/
# The image's `node` user, by ID so the runtime can verify it is not root without a passwd lookup.
USER 1000
WORKDIR /app/${APP_DIR}
# tini-less: Node is PID 1 but installs its own SIGTERM/SIGINT handlers in every service.
CMD ["node", "dist/server.js"]
