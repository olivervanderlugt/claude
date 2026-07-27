# Quizzly

A live quiz platform: ten question types, deep theming, AI-drafted questions,
and **blind group quizzes** where everyone contributes questions nobody can see
until they appear on screen mid-game.

Self-hosted, MIT licensed, one Docker container.

---

## What's actually in it

**Ten question types.** Multiple choice, choose-all-that-apply, true/false, type
the answer (typo-tolerant, accepts synonyms), number, slider, put-in-order,
match-pairs, poll, and word cloud. Ordering, matching and multi-select award
partial credit.

**Theming that goes deeper than a colour picker.** Ten built-in themes plus a
custom editor covering palette, six font pairings, four answer shapes and six
background styles (solid, gradient, aurora mesh, grid, dots, rays). Six
per-question layouts — classic, spotlight, image-above, split, full-bleed,
minimal — so a single quiz can change shape between rounds. Themes are stored
with the quiz, so its look travels with it.

**Blind group quizzes.** Share one invite code; everyone writes their own
questions. Nobody can read anyone else's until the game plays it — enforced in
the data layer, not hidden in the UI. The host is not privileged: they're a
player too. There's a moderation escape hatch for checking submissions, and
using it is permanently recorded and shown to every contributor.

**AI drafting.** Give it a topic, or paste source material and have questions
written strictly from it. Uses Claude with a strict JSON schema, so generated
questions can't come back malformed — and every one is then run through the same
validators a hand-written question faces. Optional: the app is fully functional
with no AI key configured.

**Built to be played on real phones.** Reconnects without losing your score,
44px touch targets, no drag-and-drop (it doesn't work on touch and is
inaccessible), typo-forgiving text answers, and a countdown that corrects for
device clock skew.

---

## Quick start

> **Note:** this repository currently hosts a second, unrelated project under
> `percentile/`. Everything Quizzly owns lives in `quizzly/` and the two share no
> files, ports or CI. To pull Quizzly out into its own repository, see
> [`docs/MOVING-TO-ITS-OWN-REPO.md`](docs/MOVING-TO-ITS-OWN-REPO.md).

```bash
git clone <your-repo-url> && cd <repo>/quizzly   # already standalone? just cd in
cp .env.example .env

# Generate the two required secrets
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env

docker compose up --build
```

Then open <http://localhost:3000>.

To load a demo quiz that exercises all ten question types:

```bash
docker compose exec app node_modules/.bin/tsx prisma/seed.ts
# signs in as demo@quizzly.local / demo-password-123
```

### Without Docker

Needs Node 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and the two secrets
npm run db:migrate            # create the schema
npm run db:seed               # optional demo data
npm run dev
```

---

## How a game runs

1. **Host** opens a quiz and hits *Host*. A six-digit PIN appears on the shared
   screen.
2. **Players** go to the site, type the PIN and a nickname. No account, no app,
   no personal data.
3. The host starts. Questions appear on the shared screen; players answer on
   their phones.
4. Scores, a live answer histogram, and a leaderboard between questions.

Players need no account. **Accounts are only for people who build quizzes.**

---

## Configuration

Everything lives in `.env` — see `.env.example` for the annotated list. The
essentials:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_ORIGIN` | yes | Exact public origin, no trailing slash. Must be `https://` in production |
| `SESSION_SECRET` | yes | `openssl rand -base64 32`. Rotating it signs everyone out |
| `ENCRYPTION_KEY` | yes | `openssl rand -base64 32`. Encrypts stored user API keys |
| `ANTHROPIC_API_KEY` | no | Switches on AI drafting. Everything else works without it |
| `AI_MODEL` | no | Defaults to `claude-opus-5` |

The app validates all of this at boot and **refuses to start** if something is
missing or still set to a placeholder. A container that won't start is a much
better failure than one that starts and is quietly insecure.

### Turning on AI later

Nothing else depends on it. Set `ANTHROPIC_API_KEY`, restart, and the AI panel
switches from a "not configured" message to a working drafting tool. Users can
also save their own key under Settings to spend their own budget and skip the
hourly rate limit.

---

## Commands

```bash
npm run dev          # dev server with hot reload
npm run build        # production build
npm start            # run the production build
npm test             # unit tests (scoring, grading, anti-cheat boundary)
npm run typecheck    # tsc --noEmit
npm run db:migrate   # create/apply a migration in development
npm run db:deploy    # apply committed migrations (production)
npm run db:studio    # browse the database
```

---

## Architecture in one paragraph

Next.js 15 (App Router) and a Socket.IO server share one HTTP server in a single
Node process — which is why this isn't deployed to a serverless platform: a live
quiz needs a connection held open. Postgres via Prisma. Live game state lives in
memory in a `GameRoom` state machine, with results written through to Postgres.
The game engine has no Socket.IO import at all, so the rules are unit-testable
without a server.

Deeper detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Security and privacy posture

- Players are **not users**: joining a game stores a nickname and nothing else.
  No email, no account, no IP logged against play. This keeps the entire live
  game path out of "children's personal data" territory.
- Correct answers are **never sent to players' devices** before the reveal. The
  client gets an answer-stripped payload; grading happens server-side against
  the payload the server holds. There's a test asserting this.
- Passwords hashed with scrypt; session tokens stored only as SHA-256 hashes.
- Nonce-based CSP, strict security headers, WebSocket origin validation, rate
  limiting on auth, joins, AI generation and socket events.

Read before deploying publicly: [`SECURITY.md`](SECURITY.md) and
[`docs/LEGAL.md`](docs/LEGAL.md) — the latter covers GDPR, use with children, and
a real patent-litigation risk in this product category that you should
understand before commercialising.

---

## Deploying

[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) covers Railway, Render, Fly, and a
plain VPS, plus what changes if you scale past one instance.

---

## Licence

MIT — see [`LICENSE`](LICENSE).
