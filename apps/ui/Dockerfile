# Monorepo-aware build. BUILD CONTEXT IS THE REPO ROOT (see compose.yml:
# build: { context: ../.., dockerfile: apps/ui/Dockerfile }).
# Vite bundles the SPA (resolving @moveet/shared-types from the workspace);
# the static output is served by Caddy.

# ─── Build stage ──────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/adapter/package.json apps/adapter/
COPY apps/simulator/package.json apps/simulator/
COPY apps/ui/package.json apps/ui/
COPY apps/network/package.json apps/network/

RUN npm pkg delete scripts.prepare && \
    npm ci -w @moveet/ui --include-workspace-root

COPY packages/shared-types ./packages/shared-types
COPY apps/ui ./apps/ui

RUN npm run build -w @moveet/ui

# ─── Production stage ─────────────────────────────────────────────────
FROM caddy/caddy:alpine

COPY --from=builder /repo/apps/ui/dist /srv
COPY apps/ui/docker/Caddyfile /etc/caddy/Caddyfile
COPY apps/ui/docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

ENTRYPOINT ["/entrypoint.sh"]

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
