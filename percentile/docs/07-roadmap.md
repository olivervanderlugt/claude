# Roadmap

Sequenced against one question: **how fast can we prove or disprove that cohorts reach
k-anonymity?** Everything else is subordinate.

## Phase 0 — Foundations (weeks 1-6)

Goal: an app can install and send data, and we can prove the privacy claims.

- [x] Privacy core: pseudonymisation, consent ledger, redaction, k-anonymity, DP budget
- [x] Release gate with provenance stamping
- [x] Ingest pipeline with fail-closed consent resolution
- [x] Benchmark comparison and narrative generation
- [x] Co-op settlement logic reconciling to the cent
- [x] Browser SDK with auto-instrumentation and GPC handling
- [x] MCP server
- [x] Financial model with bear/base/bull
- [ ] ClickHouse + Postgres behind the store interface
- [ ] Auth, API keys, rate limiting
- [ ] Hosted ingest edge
- [ ] Minimal dashboard

**Exit:** 10 friendly apps sending real events.

## Phase 1 — Density in one cohort (weeks 7-16)

Goal: one cohort clears k=10, and someone pays for what it produces.

- [ ] Free PII leak scanner, public, no signup — the acquisition wedge
- [ ] Cohort assignment and scheduled rollups
- [ ] Suppression messaging: *"unlocks when 3 more apps like yours contribute"*
- [ ] Co-op enrolment flow and addendum
- [ ] Billing (Stripe), Free/Pro/Scale
- [ ] Manual benchmark computation for the first cohort

**Exit criteria — all four:**
- 100 installed apps, ≥40 in `lovable × b2b_saas × 100-1k`
- One cohort clears k=10 with 500+ subjects
- 10 paying customers
- Conversion measurably higher among unlocked workspaces

Miss the first two and stop to re-plan. That is signal 1 from
[go-to-market](06-go-to-market.md), and pushing harder on a wedge that is not working is
the expensive failure mode.

## Phase 2 — Network (months 5-9)

Goal: enough cohorts live that benchmarks are the reason people sign up.

- [ ] Cohort expansion: Bolt, v0, Replit; marketplace and consumer verticals
- [ ] Automated ε-budget management and refresh cycles
- [ ] Benchmark API for programmatic access
- [ ] MCP server v2: cohort exploration, trend queries
- [ ] Builder partnerships — embedded widget with one platform
- [ ] Publish *State of AI-Built Apps Q1* using real data
- [ ] **External privacy counsel review of the release gate**
- [ ] SOC 2 Type I

The counsel review is the gating item for Phase 3 and should start in month 5, not month 8.
It is also the highest-value cheque in the plan: a written opinion that the anonymisation
clears the EDPB bar is what makes Layer 3 sellable.

**Exit:** 500 apps, 8+ live cohorts, 60 paying, first data LOI signed.

## Phase 3 — The co-op (months 10-16)

Goal: data licensing revenue, and contributors actually paid.

- [ ] Dataset packaging and delivery (Snowflake share, S3, API)
- [ ] Buyer contracts with re-identification prohibition and audit rights
- [ ] Revenue-share settlement in production; first payouts
- [ ] Contributor dashboard — what you contributed, what you earned
- [ ] Public provenance verification endpoint for buyer compliance teams
- [ ] Data-buyer sales motion: 3 design partners → 6 licensees
- [ ] SOC 2 Type II
- [ ] CalPrivacy registration decision, on counsel's advice

**Exit:** 6 paying licensees, first contributor payouts made, co-op revenue > 30% of total.

Month 14 is when the base-case model expects first licensing revenue. Slipping this by six
months does not kill the business; slipping it by eighteen probably does, because it hands
the density race to whoever moved second.

## Phase 4 — Scale (months 17-36)

- [ ] Server-side SDKs, mobile
- [ ] Predictive insights: *"apps like yours that fixed onboarding saw +9pp retention"*
- [ ] Self-serve dataset marketplace
- [ ] EU data residency
- [ ] Enterprise: SSO, custom retention, private cohorts
- [ ] Alt-data channel partnership

**Exit:** base-case month 36 — 1,875 paying apps, $5.2M ARR, 62% from the co-op.

## Sequencing decisions worth defending

**Why the PII scanner before the dashboard?** It acquires customers; a dashboard retains
them. With ten customers, acquisition is the only problem worth solving.

**Why manual benchmarks in Phase 1?** Automating a computation before knowing which metrics
matter builds the wrong pipeline efficiently. Ten hand-computed benchmarks teach more than
a hundred automated ones.

**Why is legal review Phase 2, not Phase 3?** Because a counsel opinion that the gate does
not clear the bar would invalidate the entire business, and finding that out in month 12 is
survivable while finding out in month 20 is not. Buy the bad news early.

**Why not raise before Phase 1 exit?** The k-anonymity question is the whole risk. Answering
it costs roughly $150k and makes the raise dramatically easier — or saves eighteen months.
