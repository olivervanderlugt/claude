# Business model

Every figure here is produced by [`scripts/model.ts`](../scripts/model.ts). Change an
assumption, run `npm run model -- all`, and the numbers move. Nothing in this document is
hand-typed.

## Three revenue layers

The layers are ordered so each one funds and feeds the next. Layer 3 is the prize, but it
is unreachable without Layers 1 and 2 having already built the network.

### Layer 1 — Analytics subscription (the wedge)

Usage-based, sold to the app operator.

| Tier | Price | Events/mo | Who it is for |
|---|---|---|---|
| **Free** | $0 | 100k | Every new app. Deliberately generous — the point is population, not revenue. |
| **Pro** | $29/mo | 2M | An app with real users. |
| **Scale** | $199/mo | 20M | An app with real revenue. |
| **Enterprise** | from $1.5k/mo | custom | Custom retention, DPA, SSO, residency. |

Priced deliberately near PostHog and Mixpanel. Layer 1 is not where the margin is; it is
customer acquisition that happens to pay for itself.

### Layer 2 — Intelligence (the flywheel)

Benchmarks and AI insights. Included in Pro and above, **but only for cohorts you
contribute to.**

This is the mechanism that makes the whole thing work. Contribution is not begged for, it
is the price of admission — and the price is one the customer is happy to pay, because
what they get back is worth more than what they put in. Non-contributors see their own
numbers and a greyed-out comparison reading *"unlocks when 3 more apps like yours
contribute."*

### Layer 3 — The data co-op (the business)

Aggregate-only, k-anonymised cohort datasets, licensed to third parties. **30% of net
revenue flows back to contributing workspaces**, allocated by contributed subject count.

| Buyer | What they want | Indicative ACV |
|---|---|---|
| VC / growth equity | Category-level adoption and retention curves for diligence | $60-150k |
| Dev-tool vendors | Which builders produce apps that survive; where the funnel breaks | $40-100k |
| Market researchers | AI-built app economy sizing | $30-80k |
| Hedge funds / alt-data | Adoption signal for public AI-infrastructure names | $150-400k |

Base case assumes a $95k blended ACV. Marginal cost of an additional licensee is near
zero — the same aggregates, delivered again.

## Why revenue share, not pure extraction

Paying contributors back looks like leaving money on the table. It is the cheapest growth
capital available, for four reasons:

1. **It collapses churn.** A customer whose analytics bill is partly offset by co-op
   credit has a materially worse reason to leave.
2. **It keeps the consent ask honest,** which keeps end-user opt-in rates high enough for
   cohorts to clear k-anonymity. A co-op where nobody opts in has no product to sell.
3. **It makes opting out expensive** without anything coercive: contributors get
   benchmarks *and* money.
4. **It is the defensible story.** "We pay the apps whose data we aggregate" survives a
   journalist, a regulator and a procurement review. "We sell your users' data" does not.

## Unit economics

Base case, at month 36:

| | |
|---|---|
| Blended ARPA | $88/mo |
| Gross margin | **71%** |
| Monthly logo churn | 3.5% (≈29-month average life) |
| LTV (contribution) | ≈ $1,790 |
| Target CAC | < $450 (blended, heavily content and integration led) |
| LTV:CAC | ≈ **4:1** |
| Co-op share of revenue | **62%** |

Two things are worth reading twice.

**Gross margin is 71%, not 90%.** Analytics is a storage-and-scan business, and the model
charges honestly for free-tier infrastructure at $0.35 per free workspace per month.
Vendors quoting 90% margins on usage-based analytics are usually not charging themselves
for the free tier.

**Co-op revenue overtakes subscription revenue.** By month 36 it is 62% of the total in the
base case. This is the thesis working — and also the concentration risk. See
[risks](08-risks.md).

## Three-year projection

`npm run model -- all`

| Scenario | Y1 ARR | Y2 ARR | Y3 ARR | Y3 paying apps | Co-op % | GM% | Peak cash | Breakeven |
|---|---|---|---|---|---|---|---|---|
| **Bear** | $11k | $97k | $305k | 88 | 80% | 63% | -$846k | never |
| **Base** | $96k | $2.35M | $5.19M | 1,875 | 62% | 71% | -$334k | month 15 |
| **Bull** | $1.74M | $13.99M | $30.51M | 13,409 | 31% | 83% | -$296k | month 16 |

The bull case breaks even *later* than the base case, which looks wrong and is not: it
grows fast enough to justify hiring against the higher opex ceiling. Growth costs money.

Base case detail:

| Month | Installs/mo | Paying | Sub MRR | Co-op MRR | Revenue | GM% | Cum. cash |
|---|---|---|---|---|---|---|---|
| 6 | 716 | 34 | $2k | — | $2k | 73% | -$165k |
| 12 | 1,544 | 126 | $8k | — | $8k | 81% | -$310k |
| 15 | 2,086 | 211 | $14k | $35k | $49k | 66% | -$333k |
| 18 | 2,695 | 330 | $25k | $68k | $93k | 66% | -$330k |
| 24 | 4,028 | 707 | $61k | $135k | $195k | 69% | -$306k |
| 36 | 6,617 | 1,875 | $165k | $268k | $433k | 71% | -$102k |

Note the shape: the first data-licensing revenue in month 15 is what turns the corner. The
twelve months before that are pure investment in a network that cannot be monetised yet.

Over 36 months the base case pays **$854k back to contributing developers.**

### Capital requirement

Peak cumulative cash in the base case is **-$334k**, and the model is more sensitive to
hiring discipline than to almost anything else:

| Opex ceiling as % of revenue | Breakeven | Peak cash |
|---|---|---|
| ≤ 65% | **month 15** | **-$334k** |
| 70% | month 30 | -$372k |
| 75% | never (within 36 months) | -$608k |

At 75% the company hovers just below breakeven by construction — 71% gross margin minus
75% opex. That is a legitimate choice (reinvest everything into growth) but it should be a
choice, not an accident, and it is the difference between raising once and raising twice.

**A ~$750k pre-seed carries the base case to breakeven with roughly 2x margin for error.**
The bear case needs about $1.1M to reach the point where the k-anonymity question is
answered either way — which is the only milestone that matters, and the one any raise
should be explicitly sized against.

## Pricing decisions worth defending

**Why not free with data as the price?** Because "free analytics, we sell your data" is a
positioning that cannot survive contact with a procurement team, and it selects for the
customers least likely to convert.

**Why is contribution opt-in rather than default-on?** Two reasons. GDPR and ePrivacy make
default-on legally fragile in the EU. And an opt-in the customer chose is worth
substantially more to a data buyer than a default they never noticed, because it survives
their compliance review.

**Why 30% to contributors?** High enough to be a real line item on their bill, low enough
to keep co-op gross margin above 60%. It is the number that makes the pitch — "your
analytics pays for itself" — literally true for mid-sized contributors.

## What has to be true

The model is a set of bets. The three that matter, in order:

1. **Cohorts clear k-anonymity by month 14.** Requires ~10 contributing apps and 500
   subjects *per cohort*. Everything in Layer 3 is blocked on this.
2. **Activated-to-paid conversion reaches 8%.** Assumes benchmarks are the thing people
   pay for. Falsifiable early: watch conversion among workspaces with unlocked benchmarks
   versus without.
3. **A blended $95k data ACV is achievable.** Test with three design partners before
   building any delivery infrastructure.

If (1) fails, this is a thin analytics tool in a crowded market — the bear case, and it is
not a rounding error away from the base case but an order of magnitude.
