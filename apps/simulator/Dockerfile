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
COPY --chown=nodejs:nodejs export.geojson ./

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
    GEOJSON_PATH=/app/data/network.geojson

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/status', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/index.js"]
