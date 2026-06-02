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
# (deps kept external) and run on plain `node dist/...`. Bundling sidesteps the
# extensionless-ESM imports that tsc emits under moduleResolution "bundler"
# (which plain node can't resolve) without shipping a TS runtime. The simulator
# also bundles its pathfinding worker into dist/workers (PathfindingPool resolves
# the bundled path).
#
# Targets: `simulator`, `adapter`, `ui`. See docker-compose.yml.

# ── deps: install the whole workspace (cached on manifest changes) ──────────
FROM node:24-alpine AS deps
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
# Bundle the server and the pathfinding worker (preserving the workers/ subdir).
RUN node_modules/.bin/esbuild \
      apps/simulator/src/index.ts \
      apps/simulator/src/workers/pathfinding-worker.ts \
      --bundle --platform=node --format=esm --target=node24 --packages=external \
      --outdir=apps/simulator/dist --outbase=apps/simulator/src
ENV NODE_ENV=production \
    PORT=3000 \
    GEOJSON_PATH=/data/network.geojson
EXPOSE 3000
WORKDIR /repo/apps/simulator
CMD ["node", "dist/index.js"]

# ── adapter runtime (bundled, plain node) ───────────────────────────────────
FROM source AS adapter
RUN node_modules/.bin/esbuild apps/adapter/src/index.ts \
      --bundle --platform=node --format=esm --target=node24 --packages=external \
      --outfile=apps/adapter/dist/index.js
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
