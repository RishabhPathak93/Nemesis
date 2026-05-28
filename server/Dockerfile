# syntax=docker/dockerfile:1.7
#
# v2.1 — switched from node:20-alpine to node:20-slim because Playwright's
# bundled Chromium needs glibc + a handful of shared libs that Alpine (musl)
# doesn't ship. The image is ~150 MB bigger but Playwright "just works".

FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev

FROM node:20-slim AS run
# Playwright's Chromium runtime deps. `--with-deps` adds them via apt; we run
# this once at build time and the resulting image already has everything.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
# Install Chromium (only — Firefox/WebKit not needed for the chat adapter)
# and its system dependencies. Runs as root in this layer; the final user
# switch happens below.
RUN npx playwright install --with-deps chromium
RUN chown -R node:node /app
USER node
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
