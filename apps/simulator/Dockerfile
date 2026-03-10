# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:24-alpine

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built application and geojson data
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --chown=nodejs:nodejs export.geojson ./

# Default environment variables
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
    GEOJSON_PATH=/app/export.geojson

# Switch to non-root user
USER nodejs

# Expose the application port
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/status', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/index.js"]