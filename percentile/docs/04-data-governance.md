# Data governance

This document exists because the original framing of this idea — *"collect customer data
through apps and sell it to other companies"* — describes a business that cannot legally
operate in the EU, is expensive and precarious in the US, and would be uninsurable in both.
This is the redesign that keeps the revenue and drops the liability.

It is the most important document in the repository. The architecture in
[03-architecture.md](03-architecture.md) is downstream of the decisions made here.

## The core problem with the obvious version

Selling customer-level data collected through someone else's app fails on four independent
grounds. Any one of them is fatal.

**1. You do not have the consent, and you cannot get it.**
Under GDPR the end users — not your developer customers — are the data subjects. A
developer cannot consent on their users' behalf to having those users' data sold. In
practice data-trading businesses do not obtain Article 6(1)(a) consent at all, because the
data subjects are not party to the transaction. That is not a paperwork gap; it is a
structural one.

**2. Legitimate interest does not stretch this far.**
Article 6(1)(f) can support first-party analytics. It does not support onward sale to
third parties for unrelated purposes — the balancing test fails on the subject's reasonable
expectations, and regulators have said so repeatedly.

**3. US state law now prices the failure precisely.**
California's Delete Act makes you a data broker if you sell personal information about
consumers with whom you have no direct relationship — which is exactly the relationship a
B2B2C analytics vendor has with end users. Since 1 August 2026 brokers must process DROP
deletion requests at least every 45 days, at **$200 per request per day** for failures,
against a queue that already exceeds 260,000 requests. A single missed cycle generates
theoretical liability in the billions. Registration failure alone is $200/day.

**4. The asset is worthless at the moment it becomes valuable.**
This is the commercial argument, and it is the one that should actually decide it.
Sophisticated data buyers — the ones paying six figures — run compliance review before
purchase. Data without demonstrable provenance and lawful basis fails that review. So the
naive model builds an asset that only sells to buyers who do not check, at prices set by
buyers who do not check.

## The redesign

Three structural decisions.

### Decision 1 — Two data planes, one gate

| | First-party plane | Co-op plane |
|---|---|---|
| Content | Pseudonymous event-level data | Aggregate statistics only |
| Our role | **Processor** (GDPR Art. 28) | **Controller** of anonymous data |
| Owner | The developer (controller) | Percentile |
| Regulated? | Yes — full GDPR/CCPA | **Outside GDPR material scope** (Recital 26) |
| Leaves the workspace? | Never | Yes, that is its purpose |

Properly anonymised data falls outside GDPR entirely: no lawful basis needed, no subject
access requests, no erasure obligations, no purpose limitation. It is also not "personal
information" under CCPA, so licensing it is **not a sale** and does not trigger data-broker
registration or DROP.

The word doing the work is *properly*. Anonymisation is a high bar and pseudonymisation
does not clear it. Hence the gate.

### Decision 2 — The release gate is the only bridge

Implemented in [`src/core/privacy/release-gate.ts`](../src/core/privacy/release-gate.ts).
Five checks, fail-closed at every step:

| Step | Rule | Why |
|---|---|---|
| 1. Consent filter | Only observations with `coop_licensing` consent | Non-consented rows cannot even influence thresholds |
| 2. k-anonymity | ≥10 contributing workspaces, ≥500 subjects | No individual app or person is inferable |
| 3. Dominance | No workspace >34% of cohort subjects | 10 contributors where one is 90% is not an aggregate |
| 4. Privacy budget | ε ≤ 1.0 per cohort per period | Blocks differencing attacks across repeated queries |
| 5. Provenance | SHA-256 over consent-ledger head | Buyer can verify lineage without seeing data |

Keeping this to one function is a deliberate bet: the entire compliance surface of the
company is auditable in one file, and any future "just this once" bypass has to be written
as a conspicuous exception rather than buried in a query.

Step 4 is the one most systems skip. k-anonymity is not sufficient for a *repeatedly
queried* dataset — a buyer who asks for the same cohort weekly and watches it move can
recover individual contributions even when every published cell cleared k. Adding noise
without tracking cumulative ε spend is decoration.

### Decision 3 — Consent is layered, and withdrawal is sticky

Three independent purposes. Agreeing to one is never agreement to the next:

```
product_analytics        →  the developer sees their own metrics
benchmark_contribution   →  contributes to cross-workspace aggregates
coop_licensing           →  included in datasets licensed to third parties
```

Defaults are jurisdiction-aware and fail closed. In the EU, `coop_licensing` and
`benchmark_contribution` default to **denied** and `product_analytics` to **unknown** —
because ePrivacy requires prior consent for non-essential device storage and "we assumed
yes" has never survived a DPA review. Unrecognised jurisdictions get the strictest posture.

Two rules that matter more than they look:

- **A workspace default can never overturn a subject's own decision.** Without this a
  developer could flip a config toggle and silently re-consent people who said no.
- **GPC and DNT are honoured server-side and client-side.** Global Privacy Control is
  legally binding in several US states, and treating it as advisory is among the fastest
  routes to an enforcement action. Under an opt-out signal the SDK does not even mint a
  persistent device id.

## The consent ledger

Append-only, hash-chained, every entry committing to its predecessor. Tampering with
history breaks verification at the exact entry — there is a test for it.

Beyond compliance, this is a **commercial asset**. Provenance is what lets a buyer's
compliance team approve the purchase, and it is precisely what incumbent brokers cannot
produce. Every dataset release carries a hash binding it to the consent state it was
derived from.

## Erasure

`POST /v1/erasure` sweeps every pseudonym epoch in the retention window, because subject
keys rotate every 30 days and a single-epoch delete quietly leaves rows behind — exactly
the failure DROP fines target.

The response says something most vendors fudge:

> Future aggregates exclude this subject. Previously published aggregates are anonymous
> and are not recalled.

This is honest and correct. A published aggregate that passed the gate contains no personal
data and cannot be attributed to any individual, so there is nothing in it to erase.
Claiming otherwise would be a promise we could not keep.

## Our regulatory position, stated plainly

| Question | Answer |
|---|---|
| Are we a data broker under the CA Delete Act? | **No** — we license only anonymised aggregates, which are not personal information, so there is no sale. |
| Do we register with CalPrivacy? | Not required on the above analysis. **Get outside counsel to confirm before first licence** — this is the single highest-value legal opinion to buy. |
| GDPR role, Layer 1? | Processor. Standard DPA, SCCs, sub-processor list. |
| GDPR role, Layer 3? | Controller of anonymous data — outside material scope. |
| Do we sell personal data? | No. Never row-level, never identified, never re-identifiable. |
| Can we build cross-app profiles? | **No** — pseudonyms are keyed per workspace, so it is impossible by construction, not by policy. |

## What we will not do, regardless of the offer

These are load-bearing. Breaking any one converts the company from a data co-op into a
data broker, with the liability profile to match.

1. No row-level or subject-level data leaves the first-party plane. Ever.
2. No cohort below the k-anonymity thresholds is released, whatever a customer offers.
3. No cross-workspace identity resolution.
4. No re-identification attempts, and contractual prohibition on buyers attempting it,
   with audit rights.
5. No special-category data (health, biometrics, sexuality, politics, religion) enters the
   co-op plane at all.
6. No children's data — apps directed at under-16s are excluded from the co-op entirely.

## Open questions for counsel

Honest gaps. None is blocking for building, all are blocking for the first licence.

- **Does our anonymisation clear the EDPB bar?** k=10 workspaces plus ε=1.0 is defensible
  and is not the same as approved. Get a written opinion before the first EU-sourced
  release.
- **Does the EU Data Act create obligations we have not modelled?** It was not fully
  analysed here.
- **Is the co-op addendum enforceable across jurisdictions?** A developer promising us
  rights over their users' data needs to actually hold those rights.
- **Do we need CalPrivacy registration as a belt-and-braces measure?** Registration is
  cheap; a wrong answer at $200/request/day is not. The asymmetry may favour registering
  even if the analysis says we need not.
