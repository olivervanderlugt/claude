# Architecture

## The shape of it

```
┌────────────── one Node process, one port ──────────────┐
│                                                        │
│   Next.js 15 (App Router)      Socket.IO server        │
│   ├─ RSC pages, Server Actions ├─ game rooms           │
│   └─ /api/health               └─ /api/socket          │
│                    │                   │               │
│                    └─────── Prisma ────┘               │
└──────────────────────────┬─────────────────────────────┘
                           │
                      PostgreSQL
```

`server/index.ts` mounts Next.js programmatically so both share one HTTP server.
That is the whole reason a custom server exists: a live quiz needs a connection
held open, and serverless request/response runtimes cannot do that.

---

## Directory map

```
server/
  index.ts              Entry point: loads .env, mounts Next, attaches Socket.IO
  realtime/
    engine.ts           GameRoom — the state machine. No Socket.IO import.
    gameServer.ts       Socket wiring, auth, origin checks, rate limits

src/
  lib/
    env.ts              Boot-time env validation. Throws rather than degrading.
    db.ts               Prisma singleton (survives dev hot-reload)
    crypto.ts           scrypt, token hashing, AES-256-GCM, code generation
    auth.ts             Sessions. `server-only`.
    session-cookie.ts   Just the cookie name — shared with the Node server
    rate-limit.ts       In-memory sliding window
    question-schema.ts  The ten question types: payloads, grading, public views
    theme.ts            Themes, layouts, theme → CSS variables
    scoring.ts          Pure scoring functions
    collab.ts           Blind group quizzes. The only sanctioned read path.
    ai/                 Provider interface + Claude implementation
  app/
    actions/            Server Actions (auth, quiz, collab, settings)
    play/[pin]/         Player screen
    host/[gameId]/      Shared-screen host view
    quiz/[id]/edit/     Builder
    collab/             Group-quiz management, contribution, moderation
  components/
  types/realtime.ts     The wire contract, imported by both sides
```

---

## Five decisions worth knowing

### 1. The game engine has no transport dependency

`GameRoom` talks to an injected `RoomEmitter` interface, not to Socket.IO. So
the rules — timing, scoring, phase transitions, who may see what — are testable
without standing up a server, and the transport could be swapped for SSE without
touching the engine.

### 2. Correct answers never leave the server before the reveal

The client is sent `PublicPayload`, a view of the question with every answer
stripped out. Grading happens server-side. This is architectural rather than a
discipline that could be forgotten: the type simply has no field to leak, and
`question-schema.test.ts` asserts it.

The player page also renders **no game data server-side at all** — everything
arrives over the socket after joining, so answers can't hide in the initial HTML
payload either.

### 3. Games run from an immutable snapshot

Starting a game serialises the whole quiz into `Game.quizSnapshot`. The live
game reads only that. A host editing the quiz mid-game therefore cannot change
questions under the players' feet.

It also means a game is fully reconstructible from one row, which is what makes
room loading on demand (and reconnection) straightforward.

### 4. The blind-quiz guarantee lives in the data layer

`src/lib/collab.ts` is the only sanctioned way to read a collaborative quiz's
questions, and `getQuestionsFor(quizId, viewerId)` takes the viewer's identity as
a **required, un-defaulted argument** — there is no way to call it without
stating who's asking.

The return type is a union: `RevealedQuestion` has `prompt` and `payload`,
`HiddenQuestion` does not. A caller cannot leak content by forgetting a check,
because the fields aren't there to leak.

Reveal happens exactly once, in `GameRoom.showQuestion()`, stamping `revealedAt`
at the moment the question actually goes on screen.

### 5. Two colour systems, deliberately

The app chrome uses a fixed neutral palette; the quiz surface is driven entirely
by `--q-*` custom properties. That is why you can edit a neon-on-black quiz in a
readable editor. Theme values are validated hex strings converted to a style
object — never interpolated into raw CSS, so there's no `dangerouslySetInnerHTML`
anywhere in the render path.

---

## The game state machine

```
lobby ──start──▶ countdown ──▶ question ──┬─ timer expires ─┐
                    ▲                     └─ all answered ──┤
                    │                                       ▼
                    │                                     locked
                    │                                       │
                    └──── next ──── scoreboard ◀── reveal ◀─┘
                                         │
                                       ended
```

Transitions are server-driven. `game:state` carries enough to rebuild any screen
from scratch, which is what makes reconnection work: a player whose phone slept
through two questions gets the current state, not a broken screen.

---

## Data model notes

- **`Player` is not `User`.** Players are per-game rows holding a nickname.
  This is a privacy decision as much as a modelling one — see `docs/LEGAL.md`.
- **JSON columns are validated.** `Question.payload`, `Question.presentation`,
  `Quiz.theme`, `Quiz.settings` and `Answer.response` are JSON, but every read
  and write goes through a Zod schema. Ten question types with genuinely
  different shapes would otherwise mean either ten tables or a very wide sparse
  one.
- **`@@unique([gameId, playerId, questionIndex])`** on `Answer` is the anti-cheat
  backstop: the database refuses a double-submit even if a race slips past the
  in-memory check.

---

## Adding an eleventh question type

Everything is driven from `src/lib/question-schema.ts`:

1. Add a payload schema to the `questionPayloadSchema` union.
2. Add a response shape to `responseSchema` if none of the existing ones fit.
3. Add a `case` to `grade()`.
4. Add a `case` to `toPublicPayload()` — **strip the answer**.
5. Add a `case` to `describeCorrectAnswer()`.
6. Add an entry to `QUESTION_TYPES` with defaults for the editor.
7. Add the value to the Prisma `QuestionType` enum and migrate.
8. Add editor fields in `QuestionEditor.tsx` and a player control in
   `AnswerInput.tsx`.

TypeScript's exhaustiveness checking on the discriminated union will point at
every switch you still need to handle.

---

## Testing

`npm test` covers the logic most likely to be wrong in ways players notice:

- **Scoring** — the speed curve, streak caps, partial credit, and clamping of
  hostile response times.
- **Grading** — every question type, including fuzzy text matching and the guard
  that stops tolerance-2 matching making short answers meaningless.
- **Integrity validation** — questions that are structurally valid but
  unanswerable.
- **The anti-cheat boundary** — that public payloads contain no answers, and
  that shuffling is deterministic so host and players agree.

The realtime layer is verified end-to-end by driving real WebSocket connections
against a running server (host attach, join, answer, score, persist) rather than
by mocking Socket.IO, which would mostly test the mock.
