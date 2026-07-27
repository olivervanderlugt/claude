# Architecture

## The shape

```
   AI-built app                    Coding agent (Claude Code / Cursor / Lovable)
        │                                        │
        │ sdk.track()                            │ MCP tools
        ▼                                        ▼
  ┌───────────────┐                      ┌────────────────┐
  │  Ingest edge  │                      │   MCP server   │
  │  (workers)    │                      └────────┬───────┘
  └───────┬───────┘                               │
          │  redact → pseudonymise → consent check│
          ▼                                       │
  ┌───────────────┐                               │
  │ Event stream  │  Kafka / Redpanda             │
  └───────┬───────┘                               │
          │                                       │
    ┌─────┴──────┐                                │
    ▼            ▼                                ▼
┌────────┐  ┌──────────┐                  ┌──────────────┐
│ClickHse│  │ Postgres │                  │  Query API   │
│ events │  │ ledger,  │◄─────────────────┤  (Hono)      │
│ TTL'd  │  │ billing  │                  └──────┬───────┘
└───┬────┘  └──────────┘                         │
    │                                            │
    │  ═══════ FIRST-PARTY PLANE ═══════         │
    ▼                                            │
┌─────────────────────────────────────┐          │
│         RELEASE GATE                │          │
│  consent → k-anon → ε budget →      │          │
│  noise → provenance stamp           │          │
└──────────────┬──────────────────────┘          │
               │  ═══ CO-OP PLANE ═══            │
               ▼                                 ▼
      ┌──────────────────┐              ┌─────────────────┐
      │ Aggregate store  │─────────────►│   Benchmarks    │
      │ (cohort rollups) │              │   (in product)  │
      └────────┬─────────┘              └─────────────────┘
               │
               ▼
      ┌──────────────────┐
      │ Dataset delivery │  Snowflake share / S3 / API
      └──────────────────┘
```

The horizontal lines are the important part. Everything above the gate is regulated
personal data where we are a processor; everything below is anonymous data we own. One
function moves data across, and it is the only one permitted to.

## Ingest path

Order is load-bearing:

1. **Auth** — workspace resolved from the API key, never from the payload. Otherwise a
   leaked client key writes into someone else's dataset.
2. **Redact** — PII scrubbed *before* anything is persisted, so a leak in a customer's
   generated code cannot become a breach in our database.
3. **Pseudonymise** — HMAC keyed per workspace and per 30-day epoch.
4. **Consent check** — resolve permitted purposes; fail closed.
5. **Opt-out signals** — GPC/DNT strip everything but `product_analytics`, overriding any
   existing ledger grant. The most recent expression of a subject's wishes wins.
6. **Persist** — idempotent on `eventId`, because the SDK retries and must not double-count.

Redaction before pseudonymisation is deliberate: a raw identifier or a leaked API token is
never written down, not even transiently.

## Storage

| Store | Holds | Why |
|---|---|---|
| **ClickHouse** | Event rows, TTL by tier | Columnar scans over billions of rows at the cost point the pricing assumes |
| **Postgres** | Workspaces, keys, consent ledger, billing, settlements | Needs transactions and referential integrity; the ledger must never lose an entry |
| **Object store** | Cohort rollups, dataset exports | Cheap, versioned, easy to share |

The consent ledger deliberately does *not* live in ClickHouse. It is small, it is
append-only, it is the legal record of the business, and it needs transactional guarantees
ClickHouse does not provide.

`src/api/store.ts` is an in-memory stand-in implementing the interface ClickHouse would
satisfy, so swapping it is a driver change rather than a rewrite.

## Aggregation

Runs on a schedule, not on request:

1. Roll each workspace's raw events into `WorkspaceObservation` rows per cohort/metric/period.
2. Assign cohorts: `(builder, vertical, sizeBucket, period)`. Size is bucketed so no
   workspace's true scale is inferable from the cohort definition.
3. Pass the observation set through the release gate.
4. Persist survivors; record suppressions with reasons.

Suppressions are stored rather than discarded because they are a product surface: *"this
benchmark unlocks when 3 more apps like yours contribute"* is the growth loop's main call
to action.

## API surface

Six endpoints. Small on purpose — every endpoint is a promise.

| Endpoint | Purpose |
|---|---|
| `POST /v1/events` | Batched ingest (≤500), returns redaction findings |
| `POST /v1/consent` | Record a consent decision |
| `POST /v1/erasure` | Sweep every epoch, withdraw all purposes |
| `GET /v1/insights` | First-party metrics |
| `GET /v1/benchmarks` | Cohort comparison, or an explained suppression |
| `GET /v1/provenance` | Verify the ledger chain, return its head |

`/v1/events` returning redaction findings turns our safeguard into a feature: the developer
learns their generated code is leaking PII *from us*, before a regulator tells them.

`/v1/provenance` is unusual and deliberate — a public, verifiable statement that the
consent chain is intact. It is what a buyer's compliance team is handed.

## SDK design

Three constraints, in priority order:

1. **One line to install.** An agent pasting a snippet must get it right with no follow-up.
   Builder detection, jurisdiction detection and route capture are automatic.
2. **Never block the app.** Every failure path is swallowed. Analytics must not break
   someone's launch.
3. **Respect opt-out client-side.** Under GPC the SDK mints an ephemeral id instead of a
   persistent one. Data never collected cannot leak, cannot be subpoenaed, and does not
   need deleting.

SPA route capture patches `history.pushState`/`replaceState`, because generated apps are
almost universally client-routed and a naive page-view integration reports one page view
per session.

Failed flushes re-queue, bounded at 1,000 events — an unbounded retry queue turns a
transient outage into a memory leak in the user's browser tab.

## MCP server

Four tools: `get_metrics`, `get_benchmark`, `check_pii_leaks`, `explain_suppression`.

Bare JSON-RPC over stdio, zero dependencies. Notifications (no `id`) never receive a
response — a detail that breaks several MCP implementations in the wild.

## Scale and cost

The pricing model assumes roughly $0.09 per million events ingested at ClickHouse scale.
That holds if three things stay true:

- **TTL aggressively.** Free tier 30 days, Pro 12 months, Scale 24 months. Raw events are
  the cost driver; rollups are cheap and are what benchmarks read.
- **Pre-aggregate.** Benchmark queries hit materialised rollups, never raw events.
- **Cap cardinality.** Property values are constrained and arrays collapse to counts —
  which is a privacy measure first and a cost measure second, but it is both.

## Deliberate omissions

- **No session replay.** High value, extremely PII-dense, and it would compromise the
  positioning everything else depends on.
- **No server-side SDKs at v1.** The wedge is client-side apps. Server SDKs follow demand.
- **No real-time streaming to customers.** Benchmarks are weekly. Real-time would multiply
  privacy-budget spend for precision nobody acts on.
