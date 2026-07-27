# Go-to-market

The whole GTM problem is one number: **get ~10 comparable apps and 500 subjects into the
same cohort before a competitor does.** Not 10 apps total — 10 per cohort. That reframing
changes everything about how the first year is spent.

## The density trap

Naive growth spreads thin. 1,000 apps scattered across 8 builders × 12 verticals × 5 size
buckets is 480 cohorts averaging 2 apps each — **zero unlocked benchmarks and zero
sellable data.** A thousand customers and no product.

So we go deliberately narrow:

**Phase 1 targets exactly one cohort: `lovable × b2b_saas × 100-1k users`.**

100 apps in one cohort beats 1,000 apps spread across fifty. It produces a working
benchmark, a testimonial, and proof the flywheel turns. Then repeat, cohort by cohort:
Lovable B2B SaaS → Lovable marketplaces → Bolt B2B SaaS → and outward.

Every acquisition decision in year one is subordinate to cohort density. Turning away a
well-qualified lead outside the target cohort is usually correct in month 3 and always
feels wrong.

## Channels, in order of expected yield

### 1. Agent-native distribution (the differentiated one)

The agent installs the SDK. Concretely:

- Ship an MCP server that is trivial to add to Claude Code, Cursor and Windsurf.
- Publish `llms.txt` and a clean OpenAPI spec so agents can self-serve.
- Write the integration docs *for a model*, not a human: one snippet, no configuration, no
  decisions.
- Get into the templates. A Lovable starter with Percentile pre-wired is worth more than
  any amount of content marketing.

This is the highest-leverage channel and the one competitors are already moving on.

### 2. The PII leak report (the one that spreads)

`check_pii_leaks` tells a builder their generated app is shipping user emails into event
properties. That is alarming, specific, true distressingly often, and about *their* app.

Productise it as a free standalone scan — no account, paste a URL. It is a genuinely useful
public service, it demonstrates the privacy posture rather than asserting it, and it
generates exactly the kind of shareable finding that travels in the communities where these
apps get built.

### 3. Published benchmark reports

*"The State of AI-Built Apps: Q1 2026"* — real numbers on activation, retention and
conversion by builder, from data nobody else has.

This is Baremetrics' playbook, and it works: publish aggregate benchmarks openly, become
the citation, let the citation sell the product. It doubles as validation of the co-op
thesis — if the free report gets cited, the paid dataset has buyers.

### 4. Builder communities

Lovable Discord, Bolt community, r/vibecoding, Indie Hackers. Not advertising —
participating, with the benchmark data as the contribution. "Here is the median activation
rate for apps like yours" is a genuinely useful post.

### 5. Partnerships with the builders

Longer sales cycle, highest ceiling. Offer Lovable/Bolt an embedded benchmark widget for
their users, free, in exchange for distribution. They get a differentiating feature; we get
cohort density in exactly the cohorts we need. Their users see a neutral cross-builder
comparison, which they cannot produce themselves.

## Funnel targets

| Stage | Target | Notes |
|---|---|---|
| Install → activated (≥1k events) | 32% | Most installs are abandoned prototypes |
| Activated → benchmark unlocked | 60% by month 12 | Gated on cohort density, not on us |
| Unlocked → paid | 8% at maturity | vs ~3.5% at launch, before benchmarks exist |
| Paid → co-op enrolled | 45% | Revenue share is the ask |
| Monthly logo churn | 7.5% → 3.5% | Benchmarks and credits are retention tools |

The second row is the one to watch. If unlock rate stalls, nothing downstream matters.

## Pricing the co-op ask

The enrolment conversation, in the order it should be had:

1. **You keep your own data.** Enrolment contributes to aggregates, never row-level data.
2. **You get benchmarks.** The comparison you cannot get anywhere else.
3. **You get paid.** 30% of net licensing revenue, by contribution. For a mid-sized
   contributor this materially offsets the subscription.
4. **You can leave.** Withdraw any time; future aggregates exclude you.

Point 4 has to be true and easy, or point 3 reads as a trap.

## First 90 days

| Weeks | Focus | Success looks like |
|---|---|---|
| 1-2 | 30 customer conversations in the target cohort | Confirm they cannot answer "is this good?" |
| 3-6 | Ship SDK, ingest, MCP server, free PII scan | 50 apps installed |
| 7-10 | Manual benchmarks — compute by hand if needed | First cohort clears k=10 |
| 11-13 | First paid conversions; launch report | 10 paying, 1 cohort live |

Weeks 7-10 are deliberately unscalable. Computing the first benchmarks by hand for 10
customers teaches more about which metrics matter than any amount of pipeline building, and
it is the fastest route to knowing whether the core promise lands.

## The three signals that say stop

Pre-committing to falsification, because the alternative is discovering it in month 20:

1. **By month 6, no cohort has cleared k=10.** Density is not achievable at this
   acquisition rate. Either the wedge is too narrow or the channel does not work.
2. **By month 9, conversion among unlocked workspaces is not materially above locked
   ones.** Benchmarks are not the thing people pay for, and the entire thesis is wrong.
3. **By month 12, no design partner will sign an LOI for cohort data.** Layer 3 has no
   buyers, and without Layer 3 this is the bear case — a thin analytics tool in a crowded
   market.

Any one of these means change the plan rather than push harder on it.
