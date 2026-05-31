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
# The simulator/adapter run from source via `tsx` (as in `npm run dev`): their
# tsc output emits extensionless ESM imports that plain `node dist/...` can't
# resolve, so running the TypeScript directly is both simpler and correct.
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

# ── simulator runtime (tsx) ─────────────────────────────────────────────────
FROM source AS simulator
ENV NODE_ENV=production \
    PORT=3000 \
    GEOJSON_PATH=/data/network.geojson
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/simulator/src/index.ts"]

# ── adapter runtime (tsx) ───────────────────────────────────────────────────
FROM source AS adapter
ENV NODE_ENV=production \
    PORT=5011
EXPOSE 5011
CMD ["node", "--import", "tsx", "apps/adapter/src/index.ts"]

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
