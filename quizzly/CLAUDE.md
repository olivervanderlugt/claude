# CLAUDE.md

Guidance for Claude Code working in this repository.

Quizzly is a live quiz platform: hosts build quizzes, players join from their
phones with a PIN, everyone plays on a shared screen. It has ten question types,
deep theming, optional AI question drafting, and blind group quizzes where
contributors cannot see each other's questions until the game reaches them.

---

## Commands

```bash
npm run dev          # tsx watch server/index.ts — Next + Socket.IO on one port
npm run build        # prisma generate && next build
npm start            # production server (NODE_ENV=production tsx server/index.ts)
npm run typecheck    # tsc --noEmit
npm test             # vitest run  (npm run test:watch for watch mode)

npm run db:migrate   # prisma migrate dev — creates a migration
npm run db:deploy    # prisma migrate deploy — applies committed migrations
npm run db:seed      # demo account + a quiz using all ten question types
npm run db:studio    # Prisma Studio
```

There is **no lint script**. ESLint is not installed. Do not add `next lint`
back without also adding `eslint` and `eslint-config-next` and a config file —
a script that fails on first invocation is worse than no script.

Before claiming work is done, run `npm run typecheck && npm test && npm run
build`. That trio is exactly what CI runs (`.github/workflows/ci.yml`).

Local setup needs a Postgres and a `.env` (copy `.env.example`, then generate
the two secrets with `openssl rand -base64 32`). `docker compose up --build`
does the whole thing including the database.

---

## Architecture

Read `docs/ARCHITECTURE.md` for the full picture. The short version:

One Node process, one port. `server/index.ts` mounts Next.js programmatically so
Next and Socket.IO share a single HTTP server — a live quiz needs a connection
held open, which a serverless request/response runtime cannot do. That is the
entire reason a custom server exists.

- `server/realtime/engine.ts` — `GameRoom`, the state machine. Imports no
  Socket.IO; it talks to an injected `RoomEmitter`, which is what makes it
  testable.
- `server/realtime/gameServer.ts` — socket wiring: origin checks, host auth,
  rate limits, payload size cap.
- `src/lib/` — the domain: env validation, auth, crypto, question schemas and
  grading, theming, scoring, collab, AI provider.
- `src/app/actions/` — Server Actions. `src/app/` — routes.
- `src/types/realtime.ts` — the wire contract, imported by both sides. Change it
  and you have changed a protocol; update client and server together.

Other docs: `SECURITY.md` (threat model and known limitations),
`docs/LEGAL.md`, `docs/DEPLOYMENT.md`.

---

## Invariants

These are the things that are expensive to rediscover and easy to break.

**Players never receive correct answers.** `toPublicPayload()` in
`src/lib/question-schema.ts` is the boundary: it strips every answer field from a
question before it goes over the wire. Grading happens server-side in `grade()`.
If you add a question type, it needs a `toPublicPayload` branch, and the test
that asserts no public payload contains an answer must cover it.

**Timing is server-authoritative.** The client's reported response time is a
hint, clamped by the server. Never award points from a client-supplied duration.

**`src/lib/collab.ts` is the only sanctioned read path for group-quiz
questions.** `getQuestionsFor(quizId, viewerId)` takes the viewer's identity as a
required, un-defaulted argument and returns a `RevealedQuestion | HiddenQuestion`
union — the hidden variant has no content fields at all, so unauthorised access
is a type error rather than a leak. Do not query `question` directly for a
collaborative quiz, and do not add a "just for the admin UI" bypass.

**Live games run from `Game.quizSnapshot`, never the live quiz row.** The quiz is
copied into the game when it starts (`src/app/actions/quiz.ts`). Editing a quiz
mid-game must not change the game in progress.

**`@@unique([gameId, playerId, questionIndex])` on `Answer` is the anti-cheat
backstop.** It is not decoration — it is what makes a duplicate submission
impossible even if the application-layer check is bypassed. Do not relax it.

**`src/lib/auth.ts` is `server-only`.** The plain-Node Socket.IO server cannot
import it. That is why `src/lib/session-cookie.ts` exists and holds nothing but
the cookie name. If the Socket.IO server needs something from auth, extract it
the same way rather than dropping the `server-only` guard.

**`server/index.ts` loads env before importing anything.** `loadEnvConfig` from
`@next/env` runs first, then modules are pulled in with dynamic `import()`.
Static imports would be hoisted above it and `src/lib/env.ts` would throw. Do not
convert those dynamic imports to static ones.

**Do not reinstate `output: "standalone"` in `next.config.ts`.** Next's
dependency tracing only covers what Next itself imports, so the standalone bundle
omits the `tsx` runtime and the Prisma CLI the container actually needs, and
drops `node_modules/.bin` entirely. See the comment in the `Dockerfile`.

**`tsx` and `prisma` are runtime dependencies, not dev.** The production server
runs TypeScript through `tsx` and applies migrations on boot. Moving them to
`devDependencies` produces an image that builds and then fails to start.

**`src/lib/env.ts` throws rather than degrading.** A container that refuses to
boot beats one that boots quietly insecure. The build phase substitutes
placeholders (`NEXT_PHASE === "phase-production-build"`) so no real secret is
ever needed to compile.

**Two colour systems.** App chrome is fixed; the quiz surface is themed via
`--q-*` CSS custom properties generated by `themeToCssVars()` in
`src/lib/theme.ts`. Don't style quiz surfaces with app-chrome tokens or the
theme silently stops applying.

---

## Conventions

- TypeScript is strict, including `noUncheckedIndexedAccess`. Indexing an array
  gives you `T | undefined`; handle it rather than asserting it away.
- Zod validates every external input — Server Action arguments, socket payloads,
  environment. Parse at the boundary, then trust the typed value inward.
- Tests live beside what they test (`src/lib/scoring.test.ts`). Pure functions
  are unit-tested; the realtime path is exercised end-to-end over real sockets.
- Comments explain *why*, not *what*. Match the density of the file you are in.

---

## Commits

Read the diff and write the commit message yourself. Never ask the user to
supply one, and never leave a placeholder like "update" or "wip". A message
should say what changed and why in a way that is still useful a year later.
