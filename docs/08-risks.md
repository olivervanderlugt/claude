# Risks

Ordered by expected damage, not by likelihood. The first three are the ones that decide
whether this exists.

---

## 1. Cohorts never reach density — the business does not exist

**Likelihood: medium. Impact: fatal.**

Everything depends on cohorts clearing k=10 workspaces and 500 subjects. Miss it and there
are no benchmarks, no dataset, and no reason to choose us over free PostHog. This is the
bear case: **$305k ARR at year 3** against a base case of $5.19M. Not a shortfall — a
different company.

The arithmetic is unforgiving. 1,000 apps across 8 builders × 12 verticals × 5 size buckets
averages 2 apps per cohort.

**Mitigations**
- Target one cohort at a time. Density beats breadth for the entire first year.
- Coarsen cohorts when thin: drop `builder` first, then `vertical`. A benchmark against
  "all AI-built B2B SaaS" is worth more than no benchmark.
- Publish the gap as a call to action — *"3 more apps unlocks this"* turns a suppression
  into a referral prompt.
- Kill criterion: **no cohort clears k by month 6 → stop and re-plan.**

---

## 2. A competitor ships benchmarks first

**Likelihood: medium-high. Impact: severe.**

PostHog has vastly more data and could ship industry benchmarks as a free feature.
Databuddy, Rybbit and Seline are already on the agent-native interface. Lovable could ship
in-product analytics with perfect distribution tomorrow.

**Mitigations**
- Speed on cohort density. It is the only thing that cannot be copied quickly.
- Cross-builder neutrality — a defensible position no single builder can occupy.
- Revenue share. A competitor matching it takes a permanent 30% margin hit; one that does
  not gives contributors a reason to stay.
- The consent architecture is a genuine retrofit barrier for anyone with an installed base
  that never agreed to cross-customer aggregation.

**Honest read:** we do not win a feature race. We win a density race, or not at all.

---

## 3. The anonymisation does not clear the regulatory bar

**Likelihood: low-medium. Impact: fatal to Layer 3, survivable overall.**

The whole Layer 3 thesis rests on aggregates being genuinely anonymous and therefore
outside GDPR. If a regulator or counsel decides k=10 plus ε=1.0 is insufficient, data
licensing stops.

**Mitigations**
- Buy the opinion in month 5, not month 18. Cheap; the alternative is not.
- Thresholds are configuration, not architecture — k and ε can be raised without a rewrite,
  at the cost of thinner coverage.
- Layer 1 + 2 survive independently. Losing Layer 3 costs 62% of base-case year-3 revenue
  and leaves a real, if much smaller, business.
- Consider CalPrivacy registration even if the analysis says it is unnecessary. The
  asymmetry — cheap registration versus $200/request/day — favours belt and braces.

---

## 4. Co-op enrolment is too low to matter

**Likelihood: medium. Impact: high.**

Base case assumes 45% of workspaces enrol and enough of their end users consent. If
developers fear their users' reaction, or EU consent rates come in at 20%, cohorts thin out
and the co-op stalls even with plenty of customers.

**Mitigations**
- Make the money visible before the ask: show projected earnings at the enrolment screen.
- Make withdrawal genuinely one click, so enrolling is low-stakes.
- Give the developer a pre-built consent banner that gets good opt-in rates — their consent
  UX is our supply chain.
- Fall back to US-only cohorts if EU rates prove unworkable. Materially smaller, still real.

---

## 5. Concentration in data-licensing revenue

**Likelihood: medium. Impact: high.**

By month 36 the base case has 62% of revenue from a small number of licensees. Losing two
of six is a catastrophic quarter, and data buyers churn on budget cycles for reasons that
have nothing to do with product quality.

**Mitigations**
- Multi-year contracts with annual prepayment.
- Diversify buyer types — VC, tooling, research and alt-data churn on different cycles.
- Keep subscription growth funded even when co-op revenue looks easier. The temptation to
  under-invest in Layer 1 once Layer 3 works is real and should be resisted explicitly.

---

## 6. A privacy incident

**Likelihood: low. Impact: severe.**

A breach, a re-identification demonstration, or a journalist framing us as "the startup
selling data from apps built by amateurs" would do disproportionate damage precisely
because privacy is the positioning.

**Mitigations**
- Redaction at ingest means the worst-case breach exposes pseudonymous behavioural data,
  not PII. This is the single highest-value control in the system.
- Per-workspace pseudonym keying makes cross-app profiling impossible by construction, so
  the worst headline is bounded.
- Publish the release gate and thresholds. Transparency is cheaper than a rebuttal.
- Fund an external re-identification audit before scaling Layer 3, and publish the result.

---

## 7. AI builders make analytics native

**Likelihood: medium-high over 3 years. Impact: high.**

Lovable or Vercel bundling analytics for free removes the reason to install anything.

**Mitigations**
- Cross-builder comparison is structurally unavailable to any single builder.
- Sell *to* them: an embedded benchmark widget makes them a Layer 3 customer rather than a
  competitor.
- The MCP interface travels across builders; developers change platforms more readily than
  they change instrumentation.

---

## 8. Model assumptions are simply wrong

**Likelihood: certain in detail. Impact: variable.**

`scripts/model.ts` is a set of bets. The most fragile:

| Assumption | Base | Fragility |
|---|---|---|
| Install ceiling 9,000/mo | | Depends on the AI-builder market continuing to compound |
| Activated → paid 8% | | Assumes benchmarks drive purchase. Testable by month 9 |
| Data ACV $95k | | No design partner has confirmed this. Test before building delivery |
| Co-op live month 14 | | Gated entirely on risk 1 |
| Opex ≤ 65% of revenue | | Breakeven month 15 becomes *never* at 75% |

That last row deserves emphasis: hiring discipline moves breakeven more than any growth
assumption in the model.

---

## What would make me walk away

Stated in advance, because the point of pre-commitment is that it binds you later:

1. No cohort clears k=10 by month 6.
2. Conversion among unlocked workspaces is not materially above locked ones by month 9.
3. No design partner signs a data LOI by month 12.
4. Counsel advises that the aggregates are not anonymous under GDPR **and** raising k
   destroys cohort coverage.

Any two of these together mean the thesis is wrong rather than early.
