# ── Build Stage ─────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Prune dev dependencies
RUN npm ci --omit=dev

# ── Runtime Stage ──────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Run as non-root user
RUN addgroup -S mcp && adduser -S mcp -G mcp

WORKDIR /app

# Copy only what's needed for runtime
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/dist dist/
COPY --from=builder /app/package.json package.json

# Don't embed secrets in the image -- pass via env vars or .env mount
# ENV NODE_ENV=production

USER mcp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
