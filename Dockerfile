# syntax=docker/dockerfile:1
# Production image for the ClaudeRoad authoritative WebSocket server.
#
# Designed to run ISOLATED in a container (EasyPanel / Traefik): it binds 0.0.0.0 on
# an INTERNAL port and never touches host ports — Traefik routes the domain to it.
# Multi-stage: a build stage compiles + bundles the server (needs devDeps), and a tiny
# runtime stage ships ONLY the bundle + the single runtime dep (ws), as a non-root user.

# ---------- build stage: typecheck + bundle the server ----------
FROM node:22-slim AS build
WORKDIR /app

# Install ALL deps from the lockfile (the build needs tsc + esbuild, which are devDeps).
# Copy the manifests first so this layer is cached unless dependencies change.
COPY package.json package-lock.json ./
RUN npm ci

# Only the sources the server build actually needs: the server + the shared sim/net it
# imports (the heavy client code and 3D assets are excluded via .dockerignore anyway).
COPY tsconfig.json ./
COPY server ./server
COPY src/sim ./src/sim
COPY src/net/protocol.ts ./src/net/protocol.ts
COPY src/world_api.ts ./src/world_api.ts

# Typecheck the server, then bundle -> dist-server/index.js (ESM; ws kept external).
RUN npm run build:server

# ---------- runtime stage: minimal, non-root ----------
FROM node:22-slim AS runtime

# HOST=0.0.0.0 so Traefik/EasyPanel can route to the container; PORT is the internal port.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app

# Production deps only: ws + pg (+ their transitive deps). The bundle keeps these external,
# so they must be on disk at runtime. (three is a prod dep too but is client-only/unused by
# the server.) The real package.json also gives Node "type": "module" to run the ESM bundle.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The compiled server bundle.
COPY --from=build /app/dist-server ./dist-server

# Run as the image's built-in unprivileged user (the copied files are world-readable).
USER node

# Document the internal port (informational; the server binds process.env.PORT).
EXPOSE 8080

# Liveness probe via the server's /health, using Node's built-in fetch (no curl needed).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Direct node (not `npm run`) so SIGTERM reaches the process for a clean container stop.
CMD ["node", "dist-server/index.js"]
