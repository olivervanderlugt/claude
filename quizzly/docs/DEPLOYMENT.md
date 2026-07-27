# Deployment

Quizzly is one container: Next.js and the Socket.IO server share a single HTTP
server and port. Anywhere that runs a Docker image and gives you a Postgres
database will work.

**It will not work on serverless platforms** (Vercel, Netlify Functions, Lambda)
without changes. A live quiz needs a persistent WebSocket connection, and
request/response serverless runtimes can't hold one open. See
[Vercel](#if-you-must-use-vercel) at the end.

---

## Before you deploy

Generate two secrets — separately, not the same value twice:

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
```

Set at minimum:

```
NODE_ENV=production
APP_ORIGIN=https://quiz.example.com     # exact, no trailing slash
DATABASE_URL=postgresql://...           # keep sslmode=require on managed DBs
SESSION_SECRET=...
ENCRYPTION_KEY=...
```

`APP_ORIGIN` must be exactly right. It drives WebSocket origin validation, so a
mismatch shows up as sockets that connect and immediately fail — the confusing
symptom being that pages load fine but no game ever starts.

The app validates all of this at boot and refuses to start if anything is
missing, still a placeholder, or if production is configured over plain HTTP.

---

## Railway

1. New project → Deploy from GitHub repo.
2. Add a **PostgreSQL** service. Railway injects `DATABASE_URL` automatically.
3. Set `APP_ORIGIN`, `SESSION_SECRET`, `ENCRYPTION_KEY` in the app service's
   variables.
4. Railway detects the `Dockerfile` and builds it.
5. Add a start command that migrates first:
   ```
   node_modules/.bin/prisma migrate deploy && node_modules/.bin/tsx server/index.ts
   ```

Railway supports WebSockets on its default proxy with no extra configuration.

## Render

1. New → **Web Service**, pointed at the repo, runtime **Docker**.
2. New → **PostgreSQL**, then copy its internal connection string into
   `DATABASE_URL`.
3. Set the other environment variables.
4. Health check path: `/api/health`.
5. Pre-deploy command: `node_modules/.bin/prisma migrate deploy`.

## Fly.io

```bash
fly launch --no-deploy          # keep the generated Dockerfile
fly postgres create
fly postgres attach <db-name>   # sets DATABASE_URL

fly secrets set \
  APP_ORIGIN=https://your-app.fly.dev \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  ENCRYPTION_KEY="$(openssl rand -base64 32)"

fly deploy
```

In `fly.toml`, keep `internal_port = 3000` and set
`auto_stop_machines = false` — a machine that suspends mid-game drops every
player's connection.

## Plain VPS with Docker Compose

```bash
git clone <repo> /opt/quizzly && cd /opt/quizzly
cp .env.example .env
# edit .env: set APP_ORIGIN to your https:// domain and both secrets
docker compose up -d --build
```

Then put a TLS-terminating reverse proxy in front. Caddy is the least
error-prone, because it gets certificates automatically **and** proxies
WebSockets with no special configuration:

```caddy
quiz.example.com {
    reverse_proxy localhost:3000
}
```

With nginx you must forward the upgrade headers explicitly — omitting them is
the single most common cause of "the site works but games never start":

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;

    # Set this authoritatively — do not append to a client-supplied value,
    # or rate limiting can be bypassed with a forged header.
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 3600s;   # don't cut idle sockets mid-lobby
}
```

---

## Migrations

`prisma migrate deploy` only applies already-committed migrations. It never
generates, resets, or drops anything, so it is safe to run automatically on
every boot — which is what `docker-compose.yml` does.

Never run `prisma migrate dev` or `prisma db push` against production.

---

## Sizing

One instance handles a lot. A single Node process holds roughly 50k concurrent
WebSocket connections before you need a second, and a live quiz uses far less
CPU per connection than a chat app — traffic is bursty around question
boundaries and near-idle in between.

Practical guidance:

| Concurrent players | What you need |
|---|---|
| Up to ~500 | 512 MB / 1 vCPU. The default `MAX_PLAYERS_PER_GAME` |
| Up to ~5,000 | 1–2 GB / 2 vCPU, single instance |
| Beyond that | Scale up before scaling out — see below |

**Scale vertically first.** It is genuinely the right answer here, because
scaling out requires real changes.

---

## Running more than one instance

Two things are process-local and will break if you naively add instances behind
a load balancer:

**1. Live game state.** `GameRoom` holds the authoritative state in memory. Two
instances means two independent games under one PIN.

**2. Rate limiting.** `src/lib/rate-limit.ts` is an in-memory map, so limits
become per-instance.

To scale out you need all three of:

- **Sticky sessions** at the load balancer, so a game's sockets always reach the
  instance holding its state. This alone gets you most of the way, since a game
  is naturally partitioned by PIN.
- **`@socket.io/redis-adapter`**, so broadcasts reach clients on other
  instances. Set `REDIS_URL` and wire the adapter in
  `server/realtime/gameServer.ts`.
- **A Redis-backed `consume()`** in `src/lib/rate-limit.ts`. The interface was
  designed to be swappable — replace the function body, not the call sites.

The genuinely robust version moves game state into Redis so any instance can
serve any game. That is a real piece of work; don't take it on until you need it.

---

## Backups

The database holds everything. Nothing else is stateful — the container is
disposable.

```bash
# Compose
docker compose exec db pg_dump -U quizzly quizzly | gzip > backup-$(date +%F).sql.gz

# Restore
gunzip -c backup-2026-07-27.sql.gz | docker compose exec -T db psql -U quizzly quizzly
```

Managed Postgres providers do this for you. **Test a restore before you need
one** — an untested backup is a hypothesis, not a backup.

---

## Monitoring

- `GET /api/health` returns `200 {"status":"ok"}`, or `503` if the database is
  unreachable. Point your uptime monitor at it.
- The container `HEALTHCHECK` uses the same endpoint, so orchestrators restart a
  wedged instance rather than routing to it.
- Application logs go to stdout in the standard container fashion.

---

## If you must use Vercel

The app builds and runs on Vercel, but **live games will not work** — the
Socket.IO server can't run there. Options:

1. **Recommended: don't.** Deploy the container to Railway or Fly. It's a single
   image and takes minutes.
2. Split it: Next.js on Vercel, and a separate Node service for Socket.IO with
   `APP_ORIGIN` and CORS configured across both. You now operate two services
   and pay a cross-origin round trip on every game event.
3. Replace the transport with Server-Sent Events plus a polling fallback for
   answers. Workable, higher latency, and a meaningful rewrite of
   `server/realtime/`.
