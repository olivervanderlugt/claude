# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Quizzly — one image containing Next.js and the Socket.IO server sharing a
# single port. Deployable to anything that runs a container.
#
# This deliberately copies the whole built app rather than using Next's
# `output: standalone` tracing. Standalone only ships the dependencies Next
# itself imports, which excludes the tsx runtime and the Prisma CLI that the
# custom server and the migrate-on-boot step actually need — and it drops
# node_modules/.bin entirely, so every binary the start command invokes goes
# missing. The image is larger this way and it starts, which is the better
# trade for something people self-host.
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

# `prisma generate` needs DATABASE_URL to be present but never connects, so a
# placeholder is correct here. The real one is injected at runtime.
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

# The whole built tree, node_modules and its .bin symlinks included. Build
# tooling never reaches this stage because the build ran in the previous one.
COPY --from=builder --chown=quizzly:nodejs /app ./

USER quizzly
EXPOSE 3000

# Fails the container if the app stops serving, so orchestrators restart it
# rather than leaving a wedged process in rotation.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Applies committed migrations, then serves. `npm run` puts node_modules/.bin
# on PATH, so nothing depends on a hard-coded binary path.
CMD ["npm", "run", "start:migrate"]
