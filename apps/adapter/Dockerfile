# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:24-alpine

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && \
    npm cache clean --force

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

ENV NODE_ENV=production \
    PORT=5011 \
    SOURCE_TYPE=static \
    SINK_TYPES=console

USER nodejs

EXPOSE 5011

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5011/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/index.js"]
