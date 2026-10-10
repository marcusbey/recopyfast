# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# RecopyFast – Socket.io realtime server
# ---------------------------------------------------------------------------
# Build:  docker build -t recopyfast-ws ./server
# Run:    docker run --env-file ../.env.local -p 4001:4001 recopyfast-ws
# ---------------------------------------------------------------------------

# Node 24 LTS (s75): the major CI tests on and Vercel runs. node:20 was past
# end of life (s69 L16). A major tag, not a digest, on purpose: each `fly
# deploy` then picks up Node's security patches, which a digest with no update
# bot would freeze.
FROM node:24-alpine AS base

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
