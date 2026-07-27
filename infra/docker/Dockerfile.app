# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# Stage 1: build the React+Vite PWA frontend and bundle the
# Hono+tRPC Node API into a production artifact.
# ─────────────────────────────────────────────────────────────
FROM node:20 AS build
WORKDIR /app

# Install dependencies from lockfile first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source (frontend src/, api/, db/, contracts/, configs).
COPY . .

# Vite build (frontend) + API bundle. `npm run build` must produce dist/.
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 2: slim runtime, non-root, production deps only.
# ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built artifacts (frontend static assets + server bundle).
COPY --from=build /app/dist ./dist
# Runtime assets the server may need at boot (drizzle migrations, contracts).
COPY db ./db
COPY contracts ./contracts

# Run as the built-in non-root node user.
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The server entrypoint serves the API and the built PWA from dist/.
CMD ["node", "dist/server/index.js"]
