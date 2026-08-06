# Privacy audit — adversarial review of the release gate

**Status: second pass.** The first pass found a critical differential-privacy violation in
the quantile mechanism, a consent bypass, and eleven other findings. Fixes landed for the
quantile mechanism, the published counts and the provenance stamp. This document is the
re-audit against the changed code and supersedes the first pass throughout.

**Scope.** `src/core/privacy/release-gate.ts`, `src/core/privacy/k-anonymity.ts`,
`src/core/privacy/differential-privacy.ts`, `src/core/consent.ts`, `src/core/identity.ts`,
`src/core/redaction.ts`, and the wired call path through `src/api/server.ts` and
`src/api/store.ts`. The coarsening ladder in `src/core/aggregate/rollup.ts` was reviewed as
an attack surface only.

**Posture.** Written as an attacker: a buyer who wants a named competitor's numbers, a
co-op member who wants to read the other members, and a researcher who wants to publish
"we re-identified Percentile's dataset". Every claim below is reproduced by an executable
test in [`test/adversarial.test.ts`](../test/adversarial.test.ts). Tests named `VULN-n`
**pass because the attack works**; tests named `HOLDS-n` are regression guards on defences
that survived. Attacks that died in this pass were converted to `HOLDS-n` rather than
deleted, so a revert fails the suite.

---

## Verdict

**Not yet, but the gap has closed materially and the remaining work is specific.**

The first pass failed the anonymisation claim on two independent grounds. **One of them is
genuinely fixed.** `exponentialQuantile` is a correct implementation of the exponential
mechanism for quantiles, and the attack that recovered a single workspace's value from one
release of a 1000-app cohort with 100% accuracy is dead — the same attack now scores 51.5%,
which is chance. I tried hard to break it and could not: no percentile and no mean separates
the neighbouring datasets even under 150-fold averaging, degenerate inputs are never echoed
back, the unreachable `-Infinity` branch really is unreachable, and given real budget the
mechanism lands on the true quantile to within 0.0013. That is a good fix.

Two things still block the claim:

1. **The consent model is still not connected to the release path** (F-2, unchanged). The
   only production caller passes a per-workspace boolean instead of consulting the ledger. A
   subject who explicitly withdrew is still in the licensed dataset. Untouched by this round.

2. **The unit of privacy is one row of the `values` array; the declared unit of contribution
   is one workspace** (F-8, escalated to Critical). Nothing bounds rows per workspace, so a
   workspace holding R of N rows gets R times the declared epsilon. Closing the percentile
   channel moved this leak rather than removing it: the *mean* now reads out a single
   workspace's value with a **98% single-release classifier** and **±0.020 recovery from 40
   queries**. This is the same class of defect as the old F-1 — a mechanism calibrated for
   the wrong unit — and it will keep reappearing until the gate collapses to one row per
   workspace.

Two other things changed shape rather than going away:

- **Count generalisation does not survive an adaptive adversary** (F-16, new, High). It
  correctly kills the naive differencing attack — a 317-subject workspace joining no longer
  moves the published figure at all. But generalisation is a *deterministic* function of the
  true count, so an attacker who contributes to the cohort controls its argument and can
  binary-search a ladder boundary. **12–14 queries recover the victim's exact subject
  count**, verified exact for 317, 842, 1163 and 4471. This is the structural difference
  between generalisation and DP: DP degrades gracefully under composition, deterministic
  generalisation does not degrade at all until it falls over.

- **The ladder is still unusable below roughly 10,000 contributors** (F-11). Under Laplace,
  85% of published medians were exactly 0 or 1. Under the exponential mechanism nothing
  piles at the bounds — instead the ladder is now **statistically identical to the order
  statistics of five uniform draws on the domain**. At k=10 a cohort spread 0.0–0.9 and a
  cohort where every app reports exactly 0.5 publish the same ladder. This is not a
  disclosure problem, it is a product problem, and it is answered in detail below because it
  determines the minimum viable cohort size.

**One regression was introduced.** `meanSensitivity` changed from
`(hi − lo) / verdict.contributorCount` to `(hi − lo) / values.length`. `values.length` is
rows, not contributors, so the change moved the mean's calibration *further* from the
declared unit of contribution. See F-8.

---

## Resolved in this round

| First-pass finding | Status | Evidence |
|---|---|---|
| **F-1** Quantile sensitivity understated by a factor of n | **Fixed** | Same attack, same cohort: single-release classifier **51.5%** (was 100%). Under 150-fold averaging no rung and not the mean separates the two worlds by more than 0.03. Guarded by `HOLDS-Q1`, `HOLDS-Q2`. |
| **F-5** Sybil cohort recovers a contributor's metric via p50 | **Channel closed** | 200-query average p50 is **0.506 / 0.511 / 0.498** for victim values 0.1 / 0.4 / 0.8 — no signal. The estimator now converges on 0, not on the victim. Guarded by `HOLDS-S1`, `HOLDS-S2`. **Root cause survives** (k counts workspaces, not parties) and is exploited through the mean instead — see F-8. |
| **F-7** Exact counts enable single-workspace differencing | **Naive form fixed** | True totals 1600 and 1917 now both publish **1000**; the difference discloses nothing. Guarded by `HOLDS-C1`. Two rungs of the coarsening ladder now collide (`HOLDS-C0`). Superseded by F-16. |
| **F-10** Provenance hash commits to nothing | **Fixed** | Opposite distributions no longer collide; 20 independent releases of one population produce 20 distinct stamps. Guarded by `HOLDS-P1`, `HOLDS-P2`, `HOLDS-P3`. Residual in F-10R. |

Also verified as sound in this pass and newly guarded:

- `exponentialQuantile` never echoes a raw data value, including for fully degenerate input
  (`[0,0,0,0,0]`, `[1,1,1,1,1]`, `[0.5,0.5,0.5]`, `[0,1]`) — 0 exact hits in 1200 draws. The
  `maxLog === -Infinity` branch, which would return `z[0]` unprotected, is unreachable while
  `hi > lo` because the gaps sum to `hi − lo`. `HOLDS-Q4`.
- Output never escapes `[lo, hi]` even with wildly out-of-domain input. `HOLDS-Q5`.
- The mechanism is a real estimator, not a random-number generator that happens to defeat
  the attack: at ε = 6 the worst error across all five rungs on n = 1000 is **0.0013**.
  `HOLDS-Q3`.
- The mean's Laplace calibration is correct **when one row means one workspace**: a
  workspace moving from `lo` to `hi` in a 1000-row/1000-workspace cohort is detected barely
  above chance. `HOLDS-10`. This is the control that isolates F-8 as a unit-of-privacy
  problem rather than a noise-scale problem.

---

## Findings, by severity

| # | Finding | Severity | Works? | Change |
|---|---|---|---|---|
| F-2 | Co-op release never consults per-subject consent | **Critical** | Yes | unchanged |
| F-8 | Privacy unit is a row; declared unit is a workspace | **Critical** | Yes | **escalated + regression** |
| F-3 | Privacy budget keyed on attacker-supplied metadata | **High** | Yes | unchanged |
| F-4 | Coarsening ladder multiplies ε over nested populations | **High** | Yes | partly mitigated |
| F-6 | Suppression path is a free, exact, unbudgeted oracle | **High** | Yes | **relatively worse** |
| F-16 | Count generalisation is invertible by an adaptive adversary | **High** | Yes | **new** |
| F-11 | Ladder carries no information below ~10,000 contributors | **High (product)** | n/a | **reshaped** |
| F-9 | k-anonymity thresholds caller-overridable with no floor | Medium | Yes | **harder to detect** |
| F-12 | Jurisdiction self-declared, never cross-checked | Medium | Yes | unchanged |
| F-13 | Redaction bypasses | Medium | Yes | unchanged |
| F-16b | Passive ladder-crossing detection | Low | Yes | new (accepted concession) |
| F-10R | Provenance stamp is unsigned and has no verifier | Low | Yes | residual |
| F-17 | Quantile ε calibrated for bounded DP, not add/remove | Low | Unproven | new |
| F-14 | Epoch rotation provides no forward secrecy | Low | Yes | unchanged |
| F-15 | Budget in-process, non-durable, no period rollover | Low | Yes | unchanged |

---

### F-2 — Co-op release never consults per-subject consent

**Severity: Critical. Unchanged.** `src/api/server.ts:204`, `src/api/store.ts:52`.

```ts
(o) => store.hasCoopConsent(o.workspaceId)      // server.ts
hasCoopConsent(id) { return this.#profiles.get(id)?.coopEnrolled ?? false; }   // store.ts
```

A developer-set boolean on the workspace profile. The `ConsentLedger` is never read on this
path, so the three-tier purpose model, sticky withdrawal, the jurisdiction defaults and the
GPC/DNT filtering at `server.ts:88-90` have zero effect on what is licensed. A subject who
called `withdrawAll` still resolves to `withdrawn` in the ledger while
`hasCoopConsent` returns `true`.

Structural, not a typo: `WorkspaceObservation` carries `workspaceId`, `cohort`, `metric`,
`value`, `subjectCount` and nothing else, so a corrected predicate has nothing subject-level
to filter on. `rollup.ts` filters subjects on `benchmark_contribution`, which is the second
tier — contributing to a cross-workspace aggregate — not `coop_licensing`, which is
inclusion in a dataset sold to third parties. 04-data-governance.md is explicit that these
must not cascade.

The gate itself is blameless and provably so — `HOLDS-1/2/3`.

**Tests:** `VULN-10` (2).

**Fix.** Add `consentedSubjectCount: number` to `WorkspaceObservation`
(`src/core/types.ts:120`), computed at rollup time by resolving `coop_licensing` per subject
against the ledger, and make it the value k-anonymity counts. `src/api/server.ts:204` then
becomes `(o) => o.consentedSubjectCount > 0`. Until that lands, gate co-op releases behind an
explicit per-subject ledger query rather than `coopEnrolled`.

---

### F-8 — The privacy unit is one row; the declared unit is one workspace

**Severity: Critical (escalated from High). Contains a regression introduced by this round.**
`src/core/privacy/release-gate.ts:146, 169`, `src/api/store.ts:87`.

```ts
const values = eligible.map((o) => clamp(o.value, metric.lo, metric.hi));   // one entry per ROW
const meanSensitivity = (metric.hi - metric.lo) / values.length;            // per ROW
```

Both mechanisms are calibrated per element of `values`: the Laplace mean by
`(hi − lo) / values.length`, and `exponentialQuantile` by a rank utility with sensitivity 1
per element. `checkKAnonymity`, meanwhile, sums `subjectCount` per *workspace* and caps a
workspace at 34% of subjects — a different quantity entirely.
`MemoryStore.putObservation` appends without deduplication or any per-workspace cap.

A workspace holding R of the N rows therefore enjoys an effective epsilon of **R × the
declared epsilon**.

**Regression.** `meanSensitivity` previously read `verdict.contributorCount`. It now reads
`values.length`. Rows ≥ contributors always, so the change moved the mean's calibration
strictly further from the gate's own stated unit of contribution ("One workspace is the unit
of contribution to a cross-workspace statistic").

**The attack.** 600 rows from one workspace at one subject each, plus 999 honest workspaces
at five subjects each. The cohort reports 1000 contributors, 5595 subjects, maximum
contributor share 10.7% — clears every threshold. The stuffing workspace holds 600 of 1599
rows, so its declared sensitivity is `1/1599` against a true `600/1599`: a **600-fold
understatement**.

| | measured |
|---|---|
| declared Laplace scale b | 0.0375 |
| true shift when the stuffer moves 0.62 → 0.0 | 0.233 (6.2 b) |
| **single-release neighbouring-dataset classifier** | **98.0%** |
| 1-query recovery of the stuffer's value, median \|error\| | 0.035 |
| **40-query recovery, median \|error\|** | **0.020** (worst of 30 runs: 0.043) |

The neighbouring datasets here differ in exactly one **workspace**, which is the gate's own
declared unit. This is a live differential-privacy violation, not a modelling quibble.

**And the percentile channel reopens at scale.** With 6000 of 10,000 rows from one
workspace, the ranks around the p50 target collapse into a zero-width region, forcing the
exponential mechanism into the gap immediately adjacent to that workspace's value: published
p50 tracks the stuffer to **0.606** (true 0.62) and **0.225** (true 0.20). `exponentialQuantile`
is behaving correctly; the input is not one row per privacy unit.

**Tests:** `VULN-4` (4), with `HOLDS-10` as the control showing the mean is correctly
calibrated when rows and workspaces coincide.

**Fix.** `src/core/privacy/release-gate.ts:146`, before anything else in step 4: collapse to
**one value per workspace** — a `subjectCount`-weighted mean per `workspaceId` — and weight
the resulting distribution by `subjectCount`. That single change makes
`(hi − lo) / values.length` correct for the mean, gives `exponentialQuantile` one element per
privacy unit, and makes the 34% dominance check bind on influence rather than on a proxy for
it. Add a hard `MAX_ROWS_PER_CONTRIBUTOR` assertion so a future caller cannot reintroduce it.

---

### F-3 — The privacy budget is keyed on attacker-supplied metadata

**Severity: High. Unchanged.** `src/core/privacy/release-gate.ts:128`.

```ts
const budgetKey = `${cohortKeyString(cohort)}::${metric.name}`;
```

`cohort` and `observations` are independent parameters; nothing checks that the label
describes the population. `period` reaches the gate from `?period=` (`src/api/server.ts:196`)
and `metric.name` is a free string. Measured: **50 of 50** releases of one identical
population against a budget permitting 10, by varying the period label; **50 of 50** again by
appending whitespace to the metric name.

This is now load-bearing for two other findings — F-8's averaging attack and F-16's adaptive
binary search both need many queries, and this is where they get them. Fixing F-3 does not
remove either attack but raises their cost by an order of magnitude.

**Tests:** `VULN-3` (3).

**Fix.** In `src/core/privacy/release-gate.ts`: (1) derive the budget key from the
population — `sha256(sorted distinct workspaceIds) + '::' + metricId`; (2) maintain a
**per-workspace** epsilon ledger in `differential-privacy.ts` and charge every contributing
workspace on every release that includes it, capped at 1.0 per workspace per period; (3)
resolve `MetricSpec` from a fixed registry so a metric cannot be renamed into a fresh budget.

---

### F-4 — The coarsening ladder multiplies epsilon over nested populations

**Severity: High. Partly mitigated.** `src/core/aggregate/rollup.ts:410`.

`coarsen()` returns four strictly nested cohorts: `exact ⊂ all_builders ⊂
all_builders_all_sizes ⊂ all_ai_built_apps`. Members of the narrow rung belong to all four
populations and absorb **4 × 1.0 of epsilon** while every per-cohort ledger reports 1.0.
rollup.ts documents the distinct budget keys as deliberate; the reasoning is inverted,
because epsilon composes over subjects, not over labels.

**Improved:** the first pass also showed adjacent rungs differencing to the exact subject
total of the ring between them (1000 / 1200 / 1400). Count generalisation blunts that — the
four rungs now publish 1000 / 2500 / 2500 / 5000, and two of them collide. Recorded as
`HOLDS-C0` so it cannot silently regress.

**Tests:** `VULN-3b` (2 vuln + 1 holds).

**Fix.** The per-workspace epsilon ledger from F-3 fixes this as a side effect. Additionally
make `narrowestReleasableCohort`'s selection binding: release at most one rung per
(workspace, metric, period).

---

### F-6 — The suppression path is a free, exact, unbudgeted oracle

**Severity: High. Unchanged in absolute terms, relatively worse.**
`src/core/privacy/release-gate.ts:117-124`, `src/core/privacy/k-anonymity.ts:67-96, 102`.

Gate order is k-anonymity (step 2) then budget (step 3), so a refusal never touches the
budget. The refusal carries exact `contributorCount`, exact `subjectCount` and an exact
`shortfall`, and `explainSuppression` renders the shortfall into prose that
`src/api/server.ts:212` returns verbatim.

The gap has **widened**: released counts are now generalised to a coarse public ladder while
refused cohorts still return exact integers, for free, forever. The sub-k region — the region
k-anonymity exists to protect — is now strictly more informative than the super-k region by a
wide margin.

Confirmed, all unchanged from the first pass:

- One rival in a cohort → `contributorCount: 1, subjectCount: 137`, exact.
- Prose alone suffices: `MIN_SUBJECTS = 500` is public, so *"needs 139 more end users"* ⟹
  exactly 361 subjects.
- Dominance shortfall is `ceil(largest / 0.34) − subjectCount` with 0.34 published, so
  `(shortfall + subjectCount) × 0.34` recovers the **dominant workspace's exact subject count
  to ±3**. Verified: recovered 900 from a true 900.
- 200 consecutive probes spent **ε = 0.0**; `remaining()` still 1.0.

**Tests:** `VULN-5` (4).

**Fix.** In `src/core/privacy/k-anonymity.ts`, drop `contributorCount` / `subjectCount` from
the `ok: false` variant of `KAnonymityVerdict` and return a coarse band
(`shortfallBand: 'a few' | 'several' | 'many'`). In `release-gate.ts`, stop returning
`verdict` on the refusal path, and charge a small fixed epsilon or a hard rate limit for
suppressed queries.

---

### F-16 — Count generalisation is invertible by an adaptive adversary

**Severity: High. New.** `src/core/privacy/release-gate.ts:59-72, 191-192`.

Assessed on the terms the code claims — generalisation, not differential privacy. It fails on
those terms.

`generaliseCount` is **deterministic**: the published figure is a known function of the true
count, and the ladder is published in the source. An attacker who contributes to the cohort
controls the function's argument, so he can move the true count until it straddles a rung and
read the boundary off the published figure.

**The attack.** 200 sybil workspaces whose subject counts the attacker sets exactly, plus one
honest victim with unknown subject count *v*. Published `subjectCount` is
`generaliseCount(S + v)`. Binary-search the smallest *S* for which the published figure
reaches rung *L*; then *v = L − S*. Each probe needs a fresh budget, which F-3 supplies. The
34% dominance cap constrains which rung is usable, so the attacker escalates to the smallest
rung above `3v`.

| victim's true subject count | recovered | queries | rung used |
|---|---|---|---|
| 317 | **317** | 12 | 2500 |
| 842 | **842** | 13 | 5000 |
| 1163 | **1163** | 13 | 5000 |
| 4471 | **4471** | 14 | 25000 |

**Exact, every time, in 12–14 queries.** This is the structural difference between
generalisation and DP: differential privacy degrades gracefully under composition, whereas a
deterministic generalisation does not degrade at all until an adaptive adversary tips it over
in one step.

**On the diagnosis that led here.** The conclusion that `noisyCount` is unusable was drawn
from `noisyCount(25, ε/6)` — Laplace scale 60 — and that specific measurement is right. But
the inference does not generalise, because a **count has sensitivity 1**, independent of *n*
and of `(hi − lo)`. It has no business drawing a one-sixth share of a budget sized for value
statistics. Measured:

| ε | true 25 → mean \|error\| | true 1600 → mean \|error\| | p95 \|error\| |
|---|---|---|---|
| 0.0167 (ε/6) | 38.3 | 61.0 | 126–185 |
| 0.1 | 9.5 | 10.0 | 25–30 |
| **0.5** | **2.0** | **1.9** | **6** |
| 1.0 | 1.0 | 1.0 | 3 |

`noisyCount(n, 0.5)` publishes a count within ±6 at the 95th percentile at *any* scale. That
is entirely usable, and unlike generalisation it composes.

**Tests:** `VULN-6` (2), with `HOLDS-C1`/`HOLDS-C2` recording what generalisation did fix.

**Fix.** `src/core/privacy/release-gate.ts:191-192`. Two options, in preference order:

1. **Publish nothing finer than the k-threshold band.** `contributorCount: '≥10'`,
   `subjectCount: '≥500'`. Buyers need to know the cohort cleared the bar; they do not need
   its size. This is the only option that is robust by construction.
2. **Noise the counts on a separate budget line.** `noisyCount(n, 0.5)` from a dedicated
   count budget, then generalise the *noised* value to the ladder for presentation. The order
   matters: noise first, snap second. Generalising a noised count is post-processing and
   stays DP; noising a generalised count does not repair the determinism.

Do not keep bare `generaliseCount` on a value an attacker can move.

---

### F-11 — The ladder carries no information below roughly 10,000 contributors

**Severity: High (product/correctness). Reshaped, not fixed.**
`src/core/privacy/release-gate.ts:151-166`.

This is the finding the go-to-market plan depends on, so it is quantified in full.

The exponential mechanism's error is measured in **ranks**, with scale `2/ε`. At
`ε/6 = 0.0167` that is **120 ranks**. A cohort needs *n* ≫ 120 contributors before a
120-rank error is small as a fraction of the population. Almost no cohort in the plan is.

**Measured — the published ladder at n ≤ 1000 is the order statistics of five uniform draws:**

| | p10 | p50 | p90 |
|---|---|---|---|
| cohort of 200 apps, every value exactly 0.5 (zero dispersion) | 0.164 | 0.503 | 0.837 |
| k=10 cohort spread 0.0 … 0.9 | 0.164 | 0.493 | 0.834 |
| k=10 cohort, every value exactly 0.5 | 0.173 | 0.500 | 0.841 |
| **theory: min / median / max of five iid U(0,1)** | **0.167** | **0.500** | **0.833** |

A cohort of ten apps spread across the entire domain and a cohort of ten apps that all report
the identical number **publish the same ladder**. `compare()` in
`src/core/aggregate/benchmarks.ts` will read a confident percentile rank off it either way,
and tell a developer they are in the 90th percentile of a distribution that does not exist.

**Median error against cohort size** (true p50 = 0.5, mean absolute error of the published
p50, 200–300 trials each):

| contributors | mean \|error\| |
|---|---|
| 10 | 0.155 |
| 25 | 0.158 |
| 100 | 0.145 |
| 1,000 | 0.099 |
| **10,000** | **0.012** |

**Answer to the commercial question: yes, the minimum cohort size has to rise — but raising
it is the most expensive of the three available fixes, and the cheapest one is free.**

Same mechanism, same n = 1000, budget spent on **one** rung instead of split six ways:

| n | ε per quantile | mean \|error\| |
|---|---|---|
| 100 | 0.0167 (current) | 0.228 |
| 100 | 0.1 | 0.159 |
| 100 | 1.0 | 0.020 |
| 1,000 | 0.0167 (current) | 0.117 |
| **1,000** | **0.1 (whole query budget on p50)** | **0.021** |
| 1,000 | 1.0 | 0.002 |
| 10,000 | 0.0167 (current) | 0.013 |
| 10,000 | 0.1 | 0.002 |

So the options, in cost order:

1. **Publish fewer statistics.** Spend the whole 0.1 on the median alone: usable from
   n ≈ 1000, today, with no other change. The five-point ladder is what is unaffordable, not
   the privacy. A three-point ladder (p25/p50/p75 at ε/3) sits between the two rows above.
2. **Raise ε per query** to ~1.0 and shrink the number of releases per period from 10 to 1.
   Same total ε, far better utility, and it makes the "ten queries per cohort per period"
   promise honest rather than nominal.
3. **Raise the minimum cohort size to ~10,000 contributing workspaces.** Correct, and by far
   the most expensive — docs/08-risks.md already ranks cohort density as the risk that
   decides whether the company exists.

Options 1 and 2 are the same lever seen from two sides: stop spreading a small budget over
six statistics nobody acts on.

**Tests:** `VULN-9` (3 vuln + 2 holds, including the crossover at n = 10,000 and the
single-rung comparison, so both are facts in the suite rather than opinions here).

---

### F-9 — k-anonymity thresholds are caller-overridable with no floor

**Severity: Medium. Unchanged, and now harder to detect.**
`src/core/privacy/release-gate.ts:42-48`, `src/core/privacy/k-anonymity.ts:54-56`.

`ReleaseGateOptions` exposes `minContributors` / `minSubjects` / `maxContributorShare` with
`?? DEFAULT` resolution and no lower bound. `{ minContributors: 1, minSubjects: 1,
maxContributorShare: 1 }` still releases **one app's data over three people** with a full
provenance stamp.

Count generalisation made this *harder* to spot from the outside. A k=1 release now publishes
`contributorCount: 0` rather than `1`, and every cohort between 10 and 24 contributors
publishes the identical `10` — so the published counts no longer distinguish a compliant
release from a marginal one. The thresholds are now inside the provenance preimage, but only
as opaque bytes, and no verifier exists to check them against policy (F-10R).

Mitigant: `src/api/server.ts:206` passes no overrides, and `epsilonPerQuery` is still capped
by the remaining budget.

**Tests:** `VULN-8` (2 vuln + 1 holds).

**Fix.** `src/core/privacy/k-anonymity.ts:54-56` — clamp rather than default:
`Math.max(opts.minContributors ?? MIN_CONTRIBUTORS, MIN_CONTRIBUTORS)`, likewise for
subjects, `Math.min` for `maxContributorShare`. Better: delete the options.

---

### F-12 — Jurisdiction is self-declared and never cross-checked

**Severity: Medium. Unchanged.** `src/core/ingest.ts:60`.

The value comes from the SDK payload. `ipToCountry` exists at `src/core/redaction.ts:128` and
the IP is on the same request, but nothing compares them. Verified with one identical event,
same identifier, same IP `145.100.1.1` (NL): declared `EU` → rejected `no_analytics_consent`;
declared `US` → accepted with `['product_analytics', 'benchmark_contribution']`.

**Holds:** `coop_licensing` still defaults to `denied` under every posture including the
fallback, so this does not by itself reach the co-op — F-2 is what does that.

**Tests:** `VULN-11` (1 vuln + 2 holds).

**Fix.** `src/core/ingest.ts:60` — resolve jurisdiction from `ipToCountry(raw.context.ip)` and
take the **stricter** of declared and derived.

---

### F-13 — Redaction bypasses

**Severity: Medium. Unchanged.** `src/core/redaction.ts`, `src/core/ingest.ts:43`.

All seven still reproduce: property **key names** are never value-scanned (`{'jane.doe@acme.com': 1}`
survives); non-ASCII (`josé@exämple.com`) and full-width (`user＠example.com`) emails defeat
the ASCII-only `\w` pattern; base64 and hex match nothing; PII split across sibling keys
produces **zero findings**; numeric PII is never examined because `PATTERNS` only run on
strings; `BLOCKED_KEY_PATTERN` has `lat|lng|latitude|longitude` but **not `lon`**; and the
event name is an unredacted 64-character free-text channel.

First-party-plane exposure (pre-gate), so a breach-surface and DPA problem rather than an
anonymisation one.

**Tests:** `VULN-12` (6 vuln + 3 holds).

**Fix,** all in `src/core/redaction.ts` unless noted: run `redactString` over key names;
`normalize('NFKC')` before matching and rewrite the email pattern with the `u` flag and
`\p{L}\p{N}`; coerce numbers to strings and run the phone/card/ipv4 patterns over them; add
`lon|long|geo|coord|gps|x_deg|y_deg` to `BLOCKED_KEY_PATTERN:22`; add a base64/hex decode
heuristic for high-entropy strings ≥ 16 chars; and in `src/core/ingest.ts:43` move event names
to a per-workspace allowlist or at minimum run them through `redactString`.

---

### F-16b — Passive ladder-crossing detection

**Severity: Low. New, and an accepted concession in the code comments.**

Watching a cohort across periods discloses the exact period in which it crossed a rung:

| true subjects | published |
|---|---|
| 499 | *suppressed* (itself a signal — `MIN_SUBJECTS` is a boundary too) |
| 500 | 500 |
| 999 | 500 |
| 1000 | 1000 |
| 2499 | 1000 |
| 2500 | 2500 |

This is exactly the concession `release-gate.ts:186` states, and it is bounded and much
smaller than the exact-count leak it replaced. Recording it because F-3 removes the "the ε
budget still caps how many times a cohort can be asked" half of that argument: with unlimited
fresh budgets there is no cap on how many periods an attacker can watch. Fixing F-3 restores
the intended bound; F-16's fix removes the issue entirely.

**Tests:** second test of `VULN-6`.

---

### F-10R — The provenance stamp is unsigned and has no verifier

**Severity: Low. Residual after the F-10 fix.**
`src/core/privacy/release-gate.ts:212-234`.

The preimage now covers the metric bounds, all five percentiles, the mean, the published
counts and the threshold options. Opposite distributions no longer collide, and 20 draws give
20 distinct stamps. Real improvement.

What remains:

- It is an unsigned SHA-256 over an entirely public preimage. A reseller can fabricate
  numbers and mint a stamp that verifies — demonstrated in `VULN-7`, which forges a valid
  stamp for a p50 of 0.99.
- It still omits the contributing workspace set and the consent predicate, so it cannot
  attest that the release was built from consented rows (F-2).
- **No verification function is exported anywhere in the repository.** A buyer's compliance
  team has to reimplement the preimage from this source file — including the exact field
  order and the `''` placeholders for absent threshold options — to check anything.

**Fix.** Sign the preimage with a release key rather than publishing a bare digest, include a
hash of the sorted contributing `workspaceId` set, and export a `verifyRelease(release, head,
publicKey)` function so verification is a call rather than an archaeology exercise.

---

### F-17 — Quantile ε may be calibrated for the wrong neighbouring-dataset model

**Severity: Low. Not demonstrated — flagged for review.**
`src/core/privacy/differential-privacy.ts:138`.

`exponentialQuantile` scores gap *i* by `log(width) − ε|i − q·n| / 2`, i.e. it assumes the
rank utility has sensitivity 1. That holds under **bounded** DP, where a neighbouring dataset
replaces one value and *n* is fixed. Under **unbounded** DP — a workspace joins or leaves,
which is the gate's actual threat model — *n* changes, so the target `q·n` also shifts by
*q*, and the utility can move by up to `1 + q ≤ 2`. The effective ε would then be up to **2×**
the declared ε.

I could not demonstrate a distinguishing attack from this at ε = 0.0167, and a factor of 2 is
not in the same category as the 1000× of the original F-1. Recording it because the audit
trail should say which neighbouring-dataset model the guarantee is stated over, and
04-data-governance.md currently does not.

**Fix.** Either halve the ε passed to `exponentialQuantile` (cheap, conservative), or state
the bounded-DP model explicitly in the docblock and in 04-data-governance.md and justify it.

---

### F-14 — Epoch rotation provides no forward secrecy

**Severity: Low. Unchanged.** `src/core/identity.ts:22, 42-64, 90-106`.

The epoch is a plaintext counter mixed into the HMAC **message**; the key material is a
single long-lived `rootSecret` that is never rotated and never destroyed.
`subjectKeysForRetentionWindow` regenerates every pseudonym an identifier has held across the
400-day window — verified, a one-year-old key reproduced exactly — and because the epoch
derives from a client-supplied `occurredAt`, any past epoch can be addressed by backdating.

**Holds, and it is the strongest claim in 04-data-governance.md:** cross-workspace
unlinkability is real. `HMAC(rootSecret, "workspace:" + id)` scoping gives the same human
three unrelated keys in three apps.

**Tests:** `VULN-13` (2 vuln + 2 holds).

**Fix.** Derive per-epoch subkeys `HMAC(rootSecret, "epoch:" + n)`, hold them in a KMS, and
**destroy** subkeys older than the retention window. Restrict
`subjectKeysForRetentionWindow` to the erasure path with audit logging. Correct identity.ts's
docblock, which currently overstates the guarantee.

---

### F-15 — The budget is in-process, non-durable, and never rolls over

**Severity: Low. Unchanged.** `src/api/server.ts:41`,
`src/core/privacy/differential-privacy.ts:174`.

A module-level singleton holding a private `Map`. A restart, a deploy or a second replica
resets every cohort's spend to zero, and no period-rollover logic exists — the refresh the
refusal message promises happens only because `period` is part of the key, and `period` is
caller-supplied (F-3).

**Fix.** Persist spend to Postgres keyed by `(populationHash, metricId, period)` with a
transactional check-and-decrement, per [03-architecture.md](03-architecture.md).

---

## What did not work

Attacks attempted in this pass that failed. Each is now a regression guard.

| Attack | Result |
|---|---|
| Re-run the first pass's single-release quantile disclosure on a 1000-app cohort | **Failed.** 51.5% classifier accuracy, i.e. chance. `HOLDS-Q1` |
| Average 150 releases and look for any rung or the mean that still separates neighbouring datasets | **Failed.** Largest gap on any of the six statistics was under 0.03. `HOLDS-Q2` |
| Re-run the sybil p50 readout with 200 queries | **Failed.** Average p50 sits at 1/2 for every victim value; the estimator's fixed point is 0, not the victim. `HOLDS-S1/S2` |
| Force `exponentialQuantile` to echo a raw data value via degenerate input | **Failed.** 0 exact hits in 1200 draws across four degenerate shapes; the unprotected `-Infinity` branch is unreachable while `hi > lo`. `HOLDS-Q4` |
| Push a value outside the public domain through the quantile mechanism | **Failed.** `HOLDS-Q5`, `HOLDS-7` |
| Check the mechanism is a real estimator rather than noise that happens to defeat the attack | **Confirmed sound.** Worst error 0.0013 across all five rungs at ε = 6. `HOLDS-Q3` |
| Difference two releases where one workspace of 317 subjects joined | **Failed.** Both publish 1000. `HOLDS-C1` |
| Difference adjacent rungs of the coarsening ladder on published counts | **Failed.** Two of the four rungs now collide. `HOLDS-C0` |
| Collide two provenance stamps from opposite distributions | **Failed.** `HOLDS-P1/P2/P3` |
| Distinguish a one-workspace change through the mean, one row per workspace | **Failed** — detected 50–60% of the time, i.e. chance. This is the control that proves F-8 is a unit-of-privacy problem, not a noise-scale problem. `HOLDS-10` |
| Pad a thin cohort with non-consented rows to clear k, or shift the distribution with them | **Failed.** The gate filters first (`release-gate.ts:102`); 50 non-consented workspaces holding 50,000 subjects were invisible to counts, thresholds and distribution. Test is constructed so a leak would show as 50 / 50000 against the true 10 / 1000. `HOLDS-1/2` |
| Learn anything from the "nobody consented" refusal | **Failed.** Returns before k-anonymity, carries no verdict. `HOLDS-3` |
| Overspend inside a fixed budget key | **Failed.** Exactly 10 releases at ε = 0.1, then refusal. `HOLDS-4` |
| Buy low noise with a huge `epsilonPerQuery` | **Failed.** `trySpend` refuses ε > remaining. |
| Produce a non-monotonic ladder | **Failed** across 100 releases. `HOLDS-9` |
| Poison the aggregate with a value of 1e9 | **Failed.** `clamp` runs before measurement. `HOLDS-8` |
| Predict or subtract the noise stream | **Failed.** `randomInt` from `node:crypto`; interior draws never repeat. `HOLDS-5` |
| Rewrite consent history | **Failed.** The hash chain breaks at the exact entry. `HOLDS-6` |
| Link the same person across workspaces | **Failed.** Per-workspace HMAC scoping. |
| Grant consent via a prototype-shaped jurisdiction | **Failed,** fail-closed — though by luck: the lookup returns `undefined`, which is not a valid `ConsentState`. A `hasOwnProperty` guard at `consent.ts:126` and a type fix are still worth doing. |
| Slip an email past redaction under a camelCase key, a nested object, or an array | **Failed** on all three. |
| Run with a weak root secret | **Failed.** Refused at `identity.ts:48` and `server.ts:32`. |

---

## Recommended order of work

1. **F-2** — wire per-subject `coop_licensing` into the release predicate. Nothing should be
   licensed until this lands.
2. **F-8** — collapse to one value per workspace before step 4. One change closes a live DP
   violation in the mean, closes the percentile channel at scale, and makes the 34% dominance
   check mean what it says.
3. **F-16** — stop publishing a deterministic function of an attacker-movable count. Prefer
   the k-threshold band; otherwise `noisyCount` on its own ε line, noised before snapping.
4. **F-3 / F-4** — per-workspace epsilon ledger keyed on population, not label. This also
   restores the bound that F-16b's concession relies on.
5. **F-11** — decide between a shorter ladder, a larger ε per query, and a larger minimum
   cohort. Option 1 is free and takes effect immediately; the plan currently assumes a
   five-point ladder is affordable at k=10, and it is not.
6. **F-6** — stop returning exact counts on the refusal path.
7. **F-9 / F-10R** — threshold floors, signed provenance, an exported verifier.
8. **F-12 / F-13 / F-14 / F-15 / F-17** — ingest hardening, key lifecycle, durability, and a
   stated neighbouring-dataset model.

The quantile fix removed the finding that made the anonymisation claim indefensible in
principle. Items 1–3 are what stand between the current code and a claim that can be
defended in practice. Until they land, 04-data-governance.md's "outside GDPR material scope
(Recital 26)" should stay out of customer-facing and buyer-facing material.

## Reproduction

```
cd percentile
npm run typecheck
npm test
```

`test/adversarial.test.ts` contributes 67 tests. Statistical attacks use enough trials that
each assertion margin is several standard errors wide; the file was run 12 consecutive times
with no flakes. A `VULN-n` test that starts *failing* most likely means the hole was fixed —
convert it to a `HOLDS-n` guard and record the fix, as was done for F-1, F-5, F-7 and F-10 in
this pass.
