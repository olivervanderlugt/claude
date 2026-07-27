# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Quizzly — multi-stage build.
#
# The result is one image containing Next.js and the Socket.IO server sharing a
# single port, which is what makes this deployable to anything that runs a
# container: Railway, Render, Fly, Coolify, a bare VPS.
#
# Deliberate choices:
#  • Multi-stage, so build tooling never reaches the runtime image.
#  • Non-root user. A container escape should not land on root.
#  • `output: standalone` from next.config.ts, so only the traced dependencies
#    are copied rather than the whole node_modules tree.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine

# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# libc6-compat covers glibc-linked prebuilt binaries that some transitive
# dependencies still ship on Alpine.
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: build ───────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `prisma generate` needs a DATABASE_URL to be present but never connects, so a
# placeholder is fine here. The real one is injected at runtime.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate && npm run build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN apk add --no-cache libc6-compat wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 quizzly

# The standalone output carries its own minimal node_modules; static assets and
# the public folder have to be copied alongside it.
COPY --from=builder --chown=quizzly:nodejs /app/.next/standalone ./
COPY --from=builder --chown=quizzly:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=quizzly:nodejs /app/public ./public

# The custom server runs from TypeScript source via tsx, so it and its imports
# ship too, along with Prisma's generated client and migrations.
COPY --from=builder --chown=quizzly:nodejs /app/server ./server
COPY --from=builder --chown=quizzly:nodejs /app/src ./src
COPY --from=builder --chown=quizzly:nodejs /app/prisma ./prisma
COPY --from=builder --chown=quizzly:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=quizzly:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=quizzly:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder --chown=quizzly:nodejs /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder --chown=quizzly:nodejs /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=builder --chown=quizzly:nodejs /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps
COPY --from=builder --chown=quizzly:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=quizzly:nodejs /app/package.json ./package.json

USER quizzly
EXPOSE 3000

# Fails the container if the app stops serving, so orchestrators restart it
# rather than leaving a wedged process routed to.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node_modules/.bin/tsx", "server/index.ts"]
