# syntax=docker/dockerfile:1
#
# Workspace-aware multi-stage build for the Moveet monorepo.
#
# The per-app Dockerfiles build from each app's own context and `npm install`
# their dependencies in isolation — which fails for local/branch builds because
# the apps depend on UNPUBLISHED workspace packages (@moveet/shared-types,
# @moveet/eslint-config) referenced as "*". Building from the repo root with
# `npm ci` resolves them locally via npm workspaces.
#
# The simulator/adapter are bundled with esbuild into a single ESM file each
# (real npm deps kept external) and run on plain `node dist/...`. Bundling
# sidesteps the extensionless-ESM imports that tsc emits under moduleResolution
# "bundler" (which plain node can't resolve) without shipping a TS runtime.
# scripts/bundle-app.mjs externalizes real deps but INLINES the internal
# @moveet/* workspace packages (server-kit, shared-types), which also ship raw
# extensionless-ESM TypeScript that node cannot resolve at runtime. The simulator
# also bundles its pathfinding worker into dist/workers (PathfindingPool resolves
# the bundled path).
#
# Targets: `simulator`, `adapter`, `ui`. See docker-compose.yml.

# ── deps: install the whole workspace (cached on manifest changes) ──────────
FROM node:26-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/simulator/package.json apps/simulator/
COPY apps/adapter/package.json apps/adapter/
COPY apps/ui/package.json apps/ui/
COPY apps/network/package.json apps/network/
RUN npm ci

# ── source: full workspace with the clean Linux node_modules ────────────────
FROM deps AS source
COPY . .

# ── simulator runtime (bundled, plain node) ─────────────────────────────────
FROM source AS simulator
# Bundle the server (ESM) and the pathfinding worker (self-contained CJS).
# The worker is emitted as CommonJS into dist/workers/pathfinding-worker.cjs so
# it runs regardless of "type":"module"; PathfindingPool launches that .cjs. It
# inlines the shared A* cost/heap + OSM-parser modules the worker imports, which
# plain node cannot resolve from raw extensionless ESM specifiers.
RUN node scripts/bundle-app.mjs apps/simulator/src/index.ts apps/simulator/dist/index.js \
 && node apps/simulator/scripts/build-worker.mjs
ENV NODE_ENV=production \
    PORT=3000 \
    GEOJSON_PATH=/data/network.geojson
EXPOSE 3000
WORKDIR /repo/apps/simulator
CMD ["node", "dist/index.js"]

# ── ws-gateway runtime (bundled, plain node) ────────────────────────────────
# The scale-out WebSocket fan-out process: subscribes to the simulator's Redis
# broadcast channel and fans out to its own WS clients. Reuses the simulator's
# source tree (shares ClientFanout); only the entrypoint differs.
FROM source AS ws-gateway
RUN node scripts/bundle-app.mjs apps/simulator/src/ws-gateway.ts apps/simulator/dist/ws-gateway.js
ENV NODE_ENV=production \
    WS_GATEWAY_PORT=5020
EXPOSE 5020
WORKDIR /repo/apps/simulator
CMD ["node", "dist/ws-gateway.js"]

# ── adapter runtime (bundled, plain node) ───────────────────────────────────
FROM source AS adapter
RUN node scripts/bundle-app.mjs apps/adapter/src/index.ts apps/adapter/dist/index.js
ENV NODE_ENV=production \
    PORT=5011
EXPOSE 5011
WORKDIR /repo/apps/adapter
CMD ["node", "dist/index.js"]

# ── ui: static SPA built by vite, served by Caddy ───────────────────────────
# VITE_* vars are baked at build with localhost defaults; the browser reaches
# the simulator/adapter via their published host ports, so no build args needed.
FROM source AS ui-build
RUN npm run build -w @moveet/ui

FROM caddy:2-alpine AS ui
COPY --from=ui-build /repo/apps/ui/dist /srv
RUN printf ':8080\n\nencode zstd gzip\ntry_files {path} /index.html\nfile_server\n' \
    > /etc/caddy/Caddyfile
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
