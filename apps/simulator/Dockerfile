# Monorepo-aware multi-stage build. BUILD CONTEXT IS THE REPO ROOT (see
# compose.yml: build: { context: ../.., dockerfile: apps/simulator/Dockerfile }).
#
# Bundled with esbuild (deps external) so the production image runs on plain
# `node` with production dependencies only. Two entry points are bundled: the
# server and the pathfinding worker thread (kept at dist/workers/ so
# PathfindingPool resolves it).

# ─── Build stage ──────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Toolchain for the native better-sqlite3 build during install.
RUN apk add --no-cache python3 make g++

WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/adapter/package.json apps/adapter/
COPY apps/simulator/package.json apps/simulator/
COPY apps/ui/package.json apps/ui/
COPY apps/network/package.json apps/network/

RUN npm pkg delete scripts.prepare && \
    npm ci -w @moveet/simulator --include-workspace-root

COPY packages/shared-types ./packages/shared-types
COPY apps/simulator ./apps/simulator

# Bundle server + worker, preserving the workers/ subdirectory.
RUN node_modules/.bin/esbuild \
      apps/simulator/src/index.ts \
      apps/simulator/src/workers/pathfinding-worker.ts \
      --bundle --platform=node --format=esm --target=node24 \
      --packages=external \
      --outdir=apps/simulator/dist --outbase=apps/simulator/src

# ─── Production stage ─────────────────────────────────────────────────
FROM node:24-alpine

# better-sqlite3 compiles again for the production (prod-only) install.
RUN apk add --no-cache python3 make g++ && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/adapter/package.json apps/adapter/
COPY apps/simulator/package.json apps/simulator/
COPY apps/ui/package.json apps/ui/
COPY apps/network/package.json apps/network/

RUN npm pkg delete scripts.prepare && \
    npm ci -w @moveet/simulator --include-workspace-root --omit=dev && \
    npm cache clean --force && \
    apk del make g++ python3

# Bundled output + the OpenAPI spec (read at runtime, cwd-relative).
COPY --from=builder --chown=nodejs:nodejs /repo/apps/simulator/dist ./apps/simulator/dist
COPY --chown=nodejs:nodejs apps/simulator/openapi.yaml ./apps/simulator/openapi.yaml

# Network GeoJSON is mounted at runtime (see compose.yml). `recordings/` is the
# cwd-relative output dir for generated recordings and must be writable by the
# runtime user.
RUN mkdir -p /repo/apps/simulator/data /repo/apps/simulator/recordings && \
    chown -R nodejs:nodejs /repo/apps/simulator/data /repo/apps/simulator/recordings

ENV NODE_ENV=production \
    PORT=3000 \
    UPDATE_INTERVAL=500 \
    MIN_SPEED=20 \
    MAX_SPEED=120 \
    HEATZONE_SPEED_FACTOR=0.2 \
    SPEED_VARIATION=0.2 \
    ACCELERATION=5 \
    DECELERATION=7 \
    TURN_THRESHOLD=30 \
    GEOJSON_PATH=/repo/apps/simulator/data/network.geojson

USER nodejs
WORKDIR /repo/apps/simulator

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/status', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/index.js"]
