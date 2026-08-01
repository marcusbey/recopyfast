# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# RecopyFast – Socket.io realtime server
# ---------------------------------------------------------------------------
# Build:  docker build -t recopyfast-ws ./server
# Run:    docker run --env-file ../.env.local -p 4001:4001 recopyfast-ws
# ---------------------------------------------------------------------------

FROM node:20-alpine AS base

# Install only production dependencies
WORKDIR /app

# Copy dependency manifests first so Docker layer-caches npm ci
COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# Copy server source (index.js + any scripts)
COPY . .

# The server listens on WS_PORT (default 4001)
EXPOSE 4001

# Use non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

CMD ["node", "index.js"]
