# Monorepo-aware multi-stage build. BUILD CONTEXT IS THE REPO ROOT (see
# compose.yml: build: { context: ../.., dockerfile: apps/adapter/Dockerfile }).
#
# The app depends on the npm workspace package @moveet/shared-types (not on the
# registry). The source is "type: module" with moduleResolution "bundler", so
# tsc emits extensionless ESM imports that plain `node` cannot resolve. We
# therefore bundle the app's own code with esbuild (deps kept external) so the
# production image runs on plain `node` with production dependencies only.

# ─── Build stage ──────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /repo

# Manifests first for install-layer caching. All workspace package.json files
# are needed so `npm ci` can validate the workspace graph against the lockfile.
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/adapter/package.json apps/adapter/
COPY apps/simulator/package.json apps/simulator/
COPY apps/ui/package.json apps/ui/
COPY apps/network/package.json apps/network/

# Drop the root `prepare` (husky) — no .git in the image. Install only the
# adapter workspace (+ root), keeping the simulator's native better-sqlite3 out.
RUN npm pkg delete scripts.prepare && \
    npm ci -w @moveet/adapter --include-workspace-root

COPY packages/shared-types ./packages/shared-types
COPY apps/adapter ./apps/adapter

# Bundle the app's own modules into a single ESM file; node_modules stay
# external (resolved at runtime from the production install below).
RUN node_modules/.bin/esbuild apps/adapter/src/index.ts \
      --bundle --platform=node --format=esm --target=node24 \
      --packages=external --outfile=apps/adapter/dist/index.js

# ─── Production stage ─────────────────────────────────────────────────
FROM node:24-alpine

RUN addgroup -g 1001 -S nodejs && \
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
    npm ci -w @moveet/adapter --include-workspace-root --omit=dev && \
    npm cache clean --force

COPY --from=builder --chown=nodejs:nodejs /repo/apps/adapter/dist ./apps/adapter/dist

ENV NODE_ENV=production \
    PORT=5011 \
    SOURCE_TYPE=static \
    SINK_TYPES=console

USER nodejs
WORKDIR /repo/apps/adapter

EXPOSE 5011

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "import('http').then(h => h.get('http://localhost:5011/health', r => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1)));"

CMD ["node", "dist/index.js"]
