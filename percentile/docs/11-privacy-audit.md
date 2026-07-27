# Privacy audit — adversarial review of the release gate

**Scope.** `src/core/privacy/release-gate.ts`, `src/core/privacy/k-anonymity.ts`,
`src/core/privacy/differential-privacy.ts`, `src/core/consent.ts`, `src/core/identity.ts`,
`src/core/redaction.ts`, and the wired call path through `src/api/server.ts` and
`src/api/store.ts`. The coarsening ladder in `src/core/aggregate/rollup.ts` was reviewed
as an attack surface only.

**Posture.** Written as an attacker: a buyer who wants a named competitor's numbers, a
co-op member who wants to read the other members, and a researcher who wants to publish
"we re-identified Percentile's dataset". Every claim below is reproduced by an executable
test in [`test/adversarial.test.ts`](../test/adversarial.test.ts). Tests named `VULN-n`
**pass because the attack works**; tests named `HOLDS-n` are regression guards on defences
that survived.

---

## Verdict

**The anonymisation claim in [04-data-governance.md](04-data-governance.md) does not
survive.** It fails on two independent grounds, either of which is sufficient:

1. **The differential-privacy mechanism is mis-specified.** The gate computes a noise scale
   appropriate for a *mean* and applies it to *quantiles*. The true epsilon consumed by a
   published percentile is up to **n times** the epsilon that is recorded, where n is the
   contributor count. In a 1000-app cohort that clears every threshold with room to spare,
   a single workspace changing its value is recoverable from **one** release with ~100%
   accuracy. There is no epsilon at which the accounting is honest, because the accounting
   is measuring the wrong quantity.

2. **The consent model is not connected to the release path.** The three-purpose ledger,
   sticky withdrawal, jurisdiction defaults and GPC/DNT handling are all real and all
   correct — and the only production caller of `gateRelease` ignores every one of them in
   favour of a single per-workspace boolean (`store.hasCoopConsent`). A subject who
   explicitly withdrew `coop_licensing` is still in the licensed dataset.

Finding 1 means releases are not anonymous data under GDPR Recital 26 and the "outside
material scope" position in 04-data-governance.md does not hold. Finding 2 means the
first-party plane is leaking into the co-op plane without a lawful basis. Both are fixable,
neither is fixable by tuning a constant.

There is a third, structural point worth stating separately, because it is the most
counter-intuitive result of this audit and it shapes the fix:

> **Privacy currently gets *worse* as cohorts get larger.** The declared sensitivity is
> `(hi - lo) / contributorCount`, so noise shrinks as 1/n. The real sensitivity of a
> quantile does not shrink with n at all. A k=10 cohort is protected (by noise so large the
> output is meaningless — see F-11); a k=1000 cohort is wide open. The two thresholds the
> product is built around, k and cohort density, are pushing in opposite directions.

What *is* sound: the consent ledger, the pseudonymisation scheme's per-workspace scoping,
the ordering of the consent filter inside the gate, clamping, and the CSPRNG noise source.
Details in [What did not work](#what-did-not-work), which is not a formality — several of
these are the only reason the failures above are not worse.

---

## Findings, by severity

| # | Finding | Severity | Works? |
|---|---|---|---|
| F-1 | Quantile sensitivity understated by a factor of n | **Critical** | Yes |
| F-2 | Co-op release never consults per-subject consent | **Critical** | Yes |
| F-3 | Privacy budget is keyed on attacker-supplied metadata | **High** | Yes |
| F-4 | Coarsening ladder multiplies epsilon over nested populations | **High** | Yes |
| F-5 | Sybil cohort reads out an honest contributor's metric | **High** | Yes |
| F-6 | Suppression path is a free, exact, unbudgeted oracle | **High** | Yes |
| F-7 | `contributorCount` / `subjectCount` published exactly, unnoised | **High** | Yes |
| F-8 | Row stuffing defeats the dominance check | **High** | Yes |
| F-9 | k-anonymity thresholds are caller-overridable with no floor | Medium | Yes |
| F-10 | Provenance hash commits to nothing a buyer cares about | Medium | Yes |
| F-11 | Post-hoc `.sort()` + clamping manufacture dispersion | Medium | Yes |
| F-12 | Jurisdiction is self-declared and never cross-checked | Medium | Yes |
| F-13 | Redaction bypasses (keys, unicode, encodings, numbers, event name) | Medium | Yes |
| F-14 | Epoch rotation provides no forward secrecy | Low | Yes |
| F-15 | Budget is in-process, non-durable, with no period rollover | Low | Yes |

---

### F-1 — The noise scale is computed for a mean and applied to quantiles

**Severity: Critical.** `src/core/privacy/release-gate.ts:119-132`.

```ts
const sensitivity = (metric.hi - metric.lo) / verdict.contributorCount;
const noisy = (v) => clamp(v + laplaceNoise(sensitivity, epsilon / 6), metric.lo, metric.hi);
```

`(hi - lo) / n` is the correct global sensitivity for a **mean** over n bounded
contributions. It is wrong for a **quantile**. Changing one contributor's value can move an
order statistic by the entire gap to its neighbour — up to `(hi - lo)` — and that gap does
not shrink with n. The classic counterexample is three points `{0, 0, 1}` versus
`{0, 1, 1}`: n grows, the median still swings the full domain.

**The attack.** Build a 1000-workspace cohort of 5000 subjects — well clear of k=10, well
clear of 500 subjects, maximum contributor share 0.1%. Values are a step function: 100
workspaces at 0, 900 at 1. The p10 index lands at `999 × 0.1 = 99.9`, i.e. exactly on the
step. One workspace flipping from 1 to 0 moves the *true* p10 from 0.9 to 0.0.

| | declared | actual |
|---|---|---|
| sensitivity of p10 | 0.001 | ~1.0 |
| Laplace scale b | 0.06 | 0.06 |
| epsilon for this statistic | 0.0167 | **~16.7** |

Measured over 120 releases: mean published p10 is **0.863** in one world and **0.023** in
the other, and a threshold classifier at 0.45 is **100% accurate from a single release**.
A mechanism honouring ε = 0.0167 would cap the attacker's advantage at ~1.7%.

Generalising: effective epsilon per statistic is `n × declared_epsilon / 6` in the worst
case, so the real epsilon spend is **n times** what the budget records. At n = 1000 with
the default ε = 0.1, one "release" spends on the order of ε = 100.

The step distribution is not contrived. Any metric with a floor or a mass point — trial
conversion at 0, retention at 0, a feature flag that is on or off — produces exactly this
shape, and the p10/p90 rungs sit closest to those mass points by construction.

**Tests:** `VULN-1` (3 tests).

**Fix.** `src/core/privacy/release-gate.ts:119-132`. Do not add Laplace noise to an order
statistic. Two viable replacements:

- **Preferred:** publish a DP histogram over a fixed, *public* bin grid derived from
  `MetricSpec.lo/hi` (say 20 bins). Per-bin sensitivity is 1 for counts, split the budget
  across bins, then derive the whole percentile ladder by post-processing the noisy CDF.
  This costs one epsilon spend for the entire ladder rather than five, is correctly
  calibrated, and is monotone by construction — which also removes the `.sort()` of F-11.
- Or the **exponential mechanism** for quantiles (utility improves with n, as intended),
  one invocation per rung with `epsilon / 6`.

Keep the existing `(hi - lo) / n` Laplace path **only** for `mean`, which is the one
statistic where it is correct — and only once row-per-workspace is enforced (F-8).

---

### F-2 — Co-op release never consults per-subject consent

**Severity: Critical.** `src/api/server.ts:204`, `src/api/store.ts:52`.

```ts
// server.ts, the only production call site of gateRelease
(o) => store.hasCoopConsent(o.workspaceId),
// store.ts
hasCoopConsent(workspaceId) { return this.#profiles.get(workspaceId)?.coopEnrolled ?? false; }
```

`coopEnrolled` is a developer-set boolean on the workspace profile. The `ConsentLedger` is
never read on this path. Consequences, all confirmed:

- A subject who granted `product_analytics` and denied `coop_licensing` is licensed anyway.
- `withdrawAll` (the erasure endpoint) marks every purpose `withdrawn` and changes nothing
  about what is released — `hasCoopConsent` still returns `true`.
- The GPC/DNT filtering at `server.ts:88-90` applies to stored `CleanEvent.permittedPurposes`
  and has no effect on `WorkspaceObservation`, which is what the gate actually sees.
- The EU fail-closed posture (`coop_licensing: 'denied'` in every jurisdiction, including
  the fallback) is correct and unreachable.

This is structural, not a typo: `WorkspaceObservation` carries `workspaceId`, `cohort`,
`metric`, `value`, `subjectCount` and nothing else. There is no subject-level consent state
for a corrected predicate to filter on. `rollup.ts` filters subjects on
`benchmark_contribution`, which is the *second* tier — contributing to a cross-workspace
aggregate — not `coop_licensing`, which is inclusion in a dataset sold to third parties.
04-data-governance.md is explicit that these must not cascade.

The gate itself is blameless here and provably so — see `HOLDS-1/2/3`. The predicate is the
hole.

**Tests:** `VULN-10` (2 tests).

**Fix.** Add `consentedSubjectCount: number` to `WorkspaceObservation`
(`src/core/types.ts:120`), computed at rollup time by resolving `coop_licensing` per subject
against the ledger, and make it the value k-anonymity counts. Then in
`src/api/server.ts:204` the predicate becomes `(o) => o.consentedSubjectCount > 0` and the
gate's `verdict.subjectCount` becomes a count of people who actually agreed. Until that
lands, gate co-op releases behind an explicit per-subject ledger query rather than
`coopEnrolled`.

---

### F-3 — The privacy budget is keyed on attacker-supplied metadata

**Severity: High.** `src/core/privacy/release-gate.ts:107`.

```ts
const budgetKey = `${cohortKeyString(cohort)}::${metric.name}`;
```

`cohort` and `observations` are independent parameters. Nothing checks that the cohort key
describes the population handed in. Both components are free strings, and `period` reaches
the gate straight from `?period=` in the query string (`src/api/server.ts:196`).

Measured: **50 out of 50 releases** of one identical population succeeded against a single
`PrivacyBudget` that permits 10, by varying only the period label. **50 out of 50** again by
appending whitespace to the metric name. Combined with F-1 and F-5 this converts a bounded
disclosure into an unbounded one — noise averages away at 1/√N.

**Tests:** `VULN-3` (3 tests).

**Fix.** Two changes in `src/core/privacy/release-gate.ts`:

1. Derive the budget key from the *population*, not the label:
   `sha256(sorted distinct workspaceIds) + '::' + metricId`.
2. Maintain a **per-workspace** epsilon ledger in
   `src/core/privacy/differential-privacy.ts` and charge every contributing workspace on
   every release that includes it. Cap at `DEFAULT_EPSILON_BUDGET = 1.0` per workspace per
   period. Epsilon composes over *subjects*, not over labels; the current design tracks the
   label.
3. Make `MetricSpec` resolve from a fixed registry rather than accepting an arbitrary
   `name` string, so a metric cannot be renamed into a fresh budget.

---

### F-4 — The coarsening ladder multiplies epsilon over nested populations

**Severity: High.** `src/core/aggregate/rollup.ts:410` (`coarsen`), consumed by the gate.

`coarsen()` returns four strictly nested cohorts: `exact ⊂ all_builders ⊂
all_builders_all_sizes ⊂ all_ai_built_apps`. Each rung is a distinct `cohortKeyString`, and
rollup.ts documents that as deliberate:

> "two rungs sharing a key would let a broad query drain a narrow cohort's budget"

The reasoning is inverted. Members of the narrow rung are members of all four populations,
so they absorb 4 × 1.0 = **4.0 of epsilon** while every per-cohort ledger reports 1.0. This
is not a hypothetical composition argument — the ladder is *designed* to be walked, and
`narrowestReleasableCohort` walks it.

The nesting also makes an ideal differencing lattice. Measured on a synthetic world of 160
workspaces, the four rungs published subject counts of 1600 / 2600 / 3800 / 5200, so
subtracting adjacent rungs yields the exact subject total of each ring — 1000, 1200, 1400 —
at zero epsilon cost (compounding F-7).

**Tests:** `VULN-3b` (3 tests).

**Fix.** The per-workspace epsilon ledger from F-3 fixes this as a side effect: a workspace
in the narrow rung is charged on every rung that contains it, and the fourth query refuses.
Additionally, in `src/core/aggregate/rollup.ts`, release **at most one rung per
(workspace, metric, period)** — `narrowestReleasableCohort` already selects one; make that
selection binding rather than advisory.

---

### F-5 — A sybil cohort reads out an honest contributor's exact metric

**Severity: High.** `src/core/privacy/k-anonymity.ts:19-28`.

k-anonymity counts **workspaces**, and the dominance check counts **subjects per
workspace**. Neither counts *parties*. Registering many workspaces is a business-rules
problem, and nothing in the gate models collusion.

**The attack.** Register 999 workspaces with one subject each. Set 499 of them to `lo` and
500 to `hi`, so the victim's value sits exactly at the p50 index. Then

```
p50 = victim + (hi - victim) × 0.5   ⟹   victim = 2 × p50 - 1
```

The cohort reports 1000 contributors and a maximum contributor share of 0.1% — the
healthiest-looking cohort in the dataset — and the noise scale is only 0.06 *because* there
are 1000 contributors (F-1's inversion working for the attacker).

Measured recovery of a victim whose true value is 0.40:

| queries | median \|error\| | worst of 25 runs |
|---|---|---|
| 1 | 0.090 | 0.265 (p90) |
| 40 | **0.022** | 0.043 |
| 60 | ~0.018 | — |

**With 40 queries the attacker recovers a named competitor's private metric to within
2.2 percentage points.** The 40 queries are free because of F-3.

**Tests:** `VULN-2` (3 tests).

**Fix.** F-1 and F-3 both blunt this. Additionally, in
`src/core/privacy/k-anonymity.ts`, k must count *independent parties*, not workspace rows:
require verified, distinct billing or domain ownership per contributor, and add a
`minIndependentOrgs` threshold alongside `MIN_CONTRIBUTORS`. Until that exists, treat
`MIN_CONTRIBUTORS = 10` as protecting against accidents, not adversaries, and say so in
04-data-governance.md.

---

### F-6 — The suppression path is a free, exact, unbudgeted oracle

**Severity: High.** `src/core/privacy/release-gate.ts:96-103`,
`src/core/privacy/k-anonymity.ts:67-96`, `explainSuppression` at `:102`.

Gate order is k-anonymity (step 2) **then** budget (step 3), so a refusal never touches the
budget. And the refusal is *more informative than a release*: it carries exact
`contributorCount`, exact `subjectCount`, and a `shortfall`, which `explainSuppression`
renders into prose that `src/api/server.ts:212` returns verbatim.

The sub-k region — the region k-anonymity exists to protect — answers unlimited **exact**
queries for free, while the super-k region answers ten noisy ones.

Confirmed disclosures:

- A cohort containing one rival returns `contributorCount: 1, subjectCount: 137` — that
  rival's exact user count.
- The prose alone suffices: `MIN_SUBJECTS = 500` is a published constant, so
  *"needs 139 more end users"* ⟹ exactly 361 subjects.
- The dominance shortfall is `ceil(largest / 0.34) - subjectCount`, and 0.34 is published,
  so `(shortfall + subjectCount) × 0.34` recovers the **dominant workspace's exact subject
  count to within ±3**. Verified: recovered 900 from a true 900.
- 200 consecutive probes spent **ε = 0.0**; `budget.remaining()` was still 1.0.

Repeated weekly, this is a live time series of a competitor's user base.

**Tests:** `VULN-5` (4 tests).

**Fix.** In `src/core/privacy/k-anonymity.ts`, stop returning raw counts on the failure
branch — return a coarse bucket (`shortfallBand: 'a few' | 'several' | 'many'`) and drop
`contributorCount` / `subjectCount` from the `ok: false` variant of `KAnonymityVerdict`
entirely. In `src/core/privacy/release-gate.ts`, do not return `verdict` on the refusal
path, and charge a small fixed epsilon (or a hard rate limit) for suppressed queries so the
oracle is bounded.

---

### F-7 — Released counts are exact and unnoised

**Severity: High.** `src/core/privacy/release-gate.ts:139-140`.

`AggregateRelease.contributorCount` and `.subjectCount` are published as exact integers.
`noisyCount()` exists in `src/core/privacy/differential-privacy.ts:69` for exactly this job
and has **zero call sites anywhere in the repository**.

Because they are exact, ordinary set differencing works. Two releases whose populations
differ by one workspace disclose that workspace's exact subject count — verified: 1600 and
1917 ⟹ **317, to the person**. F-3 and F-4 guarantee an attacker can always obtain both
releases. Over 20 repeated releases the count never varied by a single unit.

**Tests:** `VULN-6` (2 tests).

**Fix.** `src/core/privacy/release-gate.ts:139-140` — publish
`noisyCount(verdict.contributorCount, epsilon / 7)` and
`noisyCount(verdict.subjectCount, epsilon / 7)`, changing the split from `/6` to `/8`
(5 percentiles + mean + 2 counts). Round subject counts to a public grid (nearest 100)
before noising so the residual is not usable for differencing.

---

### F-8 — Row stuffing defeats the dominance check

**Severity: High.** `src/core/privacy/k-anonymity.ts:59-62` vs
`src/core/privacy/release-gate.ts:119`.

`checkKAnonymity` sums `subjectCount` per workspace and caps any workspace at 34% of
subjects. The gate then builds the distribution from **observations**, one value per row,
unweighted:

```ts
const values = eligible.map((o) => clamp(o.value, metric.lo, metric.hi)).sort(...);
```

A workspace submitting 600 rows of one subject each holds **10.7% of subjects** (passes
dominance) and **37.5% of rows** (owns the median). `MemoryStore.putObservation`
(`src/api/store.ts:87`) appends without deduplication or any per-workspace cap.

Measured: with the stuffer's true value at 0.62 in a 1000-contributor cohort, the mean
published p50 over 80 releases was **0.573** — one workspace's private number, republished
as a thousand-app industry benchmark.

The same defect breaks the mean's sensitivity: `(hi - lo) / contributorCount` assumes one
row per workspace. With 600 of 1599 rows from one workspace, that workspace's influence on
the mean is 37.5% of the domain against a declared 0.1%.

Note also that percentiles are unweighted by `subjectCount`, so a 4-subject workspace and a
450-subject workspace count equally in the "aggregate".

**Tests:** `VULN-4` (2 tests).

**Fix.** In `src/core/privacy/release-gate.ts` step 4, collapse to **one value per
workspace** before computing anything — a `subjectCount`-weighted mean per `workspaceId` is
the natural choice — and weight the resulting distribution by `subjectCount`. This makes
`(hi - lo) / contributorCount` correct for the mean and makes the dominance check bind on
influence rather than on a proxy for it.

---

### F-9 — k-anonymity thresholds are caller-overridable with no floor

**Severity: Medium.** `src/core/privacy/release-gate.ts:41-47`,
`src/core/privacy/k-anonymity.ts:54-56`.

`ReleaseGateOptions` exposes `minContributors`, `minSubjects` and `maxContributorShare` as
optional overrides resolved with `?? DEFAULT`, with no lower bound. The file header claims
that "any future 'just this once' bypass has to be written as an obvious exception" — the
bypass already exists as a documented, type-checked option object.

Verified: `{ minContributors: 1, minSubjects: 1, maxContributorShare: 1 }` releases **one
app's data over three people**, with a full 64-character provenance stamp. The output is
structurally indistinguishable from a compliant release apart from the counts, and the
stamp records nothing about which thresholds were applied (F-10).

Mitigant: `src/api/server.ts:206` does not pass overrides, so the live path uses defaults,
and `epsilonPerQuery` cannot exceed the remaining budget (`HOLDS` test under `VULN-8`).

**Fix.** `src/core/privacy/k-anonymity.ts:54-56` — clamp rather than default:
`Math.max(opts.minContributors ?? MIN_CONTRIBUTORS, MIN_CONTRIBUTORS)` and likewise for
subjects, and `Math.min(...)` for `maxContributorShare`. Better: delete the options
entirely. Thresholds this load-bearing should not be parameters.

---

### F-10 — The provenance hash commits to nothing a buyer cares about

**Severity: Medium.** `src/core/privacy/release-gate.ts:155-166`.

The preimage is `[consentLedgerHead, cohortKeyString, metric.name, contributorCount,
subjectCount, epsilon]`. It does **not** cover the percentiles, the mean, the observation
set, the consent predicate used, or the thresholds applied.

Verified: two releases built from opposite distributions (every value 0.02 versus every
value 0.98) produced **byte-identical provenance hashes**. Mutating `release.percentiles.p50`
to 0.99 after the fact leaves the stamp valid.

So the stamp proves that *some* release with these counts was made against a ledger head.
It cannot detect altered numbers, a fabricated distribution, a weakened k threshold, or a
release built from non-consented rows. 04-data-governance.md sells this as the commercial
differentiator — "provenance is what lets a buyer's compliance team approve the purchase".
A compliance team verifying this hash is verifying a tautology.

The ledger's own hash chain (`src/core/consent.ts:169`) is genuinely sound; it is the
*binding to the release* that is decorative.

**Tests:** `VULN-7` (2 tests).

**Fix.** `src/core/privacy/release-gate.ts:155` — include the complete serialised
`AggregateRelease` payload, the applied thresholds, the per-statistic epsilon, and a hash of
the sorted contributing `workspaceId` set in the preimage. Then **sign** it with a release
key rather than publishing a bare SHA-256, so a buyer can verify authorship and not just
self-consistency.

---

### F-11 — Post-hoc `.sort()` and clamping manufacture dispersion

**Severity: Medium** (correctness and misrepresentation, not disclosure).
`src/core/privacy/release-gate.ts:126-132, 122`.

Sorting five independently-noised percentiles is legitimate DP post-processing — it leaks
nothing extra, and the `.sort()` is *not* a privacy hole. But it is not free: the reported
p10 becomes the **minimum of five noisy draws** and the reported p90 the **maximum**.

Measured on a cohort where all 200 workspaces report exactly 0.5 (true p90 − p10 = 0):

- published p10 averaged **0.153**, published p90 averaged **0.859**
- published spread **0.71**, entirely manufactured by noise and sorting

At the minimum legal cohort size the picture is worse. With 10 contributors on a [0, 1]
domain, `b = 0.1 / (0.1/6) = 6.0`, so:

- **85% of published medians are exactly 0.0 or 1.0** (clamped)
- a cohort whose true median is 0.05 publishes a median **≥ 0.9 on ~43% of queries**
- clamping drags the expectation toward the domain midpoint, so a true 0.4 publishes ≈0.48

In other words, at k = 10 — the threshold the product is designed around — the released
statistic carries essentially no signal, and `compare()` in
`src/core/aggregate/benchmarks.ts` will confidently tell a developer they are in the 90th
percentile of a cohort that has no dispersion at all. Every buyer-facing number in the
five-point ladder is currently unusable, and the ladder is the product.

**Tests:** `VULN-9` (2 tests).

**Fix.** The DP-histogram approach in F-1 removes both problems: it is monotone by
construction (no `.sort()` needed) and its noise scale does not blow up at small n. If the
Laplace path is retained, at minimum surface a confidence interval alongside each rung and
suppress the ladder — not just the cohort — when `b > (hi - lo) / 4`.

---

### F-12 — Jurisdiction is self-declared and never cross-checked

**Severity: Medium.** `src/core/ingest.ts:60`.

```ts
const jurisdiction = raw.context?.jurisdiction || 'unknown';
```

The value comes from the SDK payload. `ipToCountry` exists in
`src/core/redaction.ts:128` and the IP is on the same request, but nothing compares them.

Verified with one identical event, same identifier, same IP `145.100.1.1` (NL):

| declared | outcome |
|---|---|
| `EU` | rejected, `no_analytics_consent` |
| `US` | accepted, `['product_analytics', 'benchmark_contribution']` |

One string converts the fail-closed EU posture into US defaults and puts the subject in the
benchmark pool. 04-data-governance.md's ePrivacy argument rests on a field the client
controls.

**Holds:** `coop_licensing` still defaults to `denied` under *every* posture including the
fallback, so this does not by itself reach the co-op — F-2 is what does that.

**Tests:** `VULN-11` (1 vuln + 2 holds).

**Fix.** `src/core/ingest.ts:60` — resolve jurisdiction from `ipToCountry(raw.context.ip)`
and take the **stricter** of declared and derived. Never let a client widen its own posture.

---

### F-13 — Redaction bypasses

**Severity: Medium.** `src/core/redaction.ts`, `src/core/ingest.ts:43`.

Confirmed, each reproduced in `VULN-12`:

1. **Property key names are never scanned.** `redactProperties` tests keys against
   `BLOCKED_KEY_PATTERN` and then uses them verbatim as output keys. The value patterns
   never run on a key. `{ 'jane.doe@acme.com': 1 }` is stored intact.
2. **Non-ASCII and full-width emails.** JavaScript `\w` is ASCII-only, so
   `[\w.+-]+@[\w-]+\.[\w.-]{2,}` fails on `josé@exämple.com`. Full-width `＠`
   (`user＠example.com`) is not `@` at all. Both pass with zero findings.
3. **Trivially reversible encodings.** Base64 and hex match nothing.
   `Buffer.from(x,'base64').toString()` recovers the address in one line.
4. **Split across sibling keys.** `{ local_part: 'ada.lovelace', domain_part: 'example.com' }`
   produces **zero findings** and reassembles downstream.
5. **Numeric PII is never examined.** `PATTERNS` only run on `typeof value === 'string'`.
   Phone numbers, card numbers and precise geolocation pass as numbers.
6. **Blocklist asymmetry.** `BLOCKED_KEY_PATTERN` contains `lat|lng|latitude|longitude` but
   **not `lon`**, so `lat_deg` is dropped and `lon_deg` survives; `x_deg`/`y_deg` both
   survive. Precise coordinates enter the store under neutral key names.
7. **The event name is an unredacted 64-character free-text channel.**
   `EVENT_NAME_PATTERN` allows `[a-z0-9_.:-]`, and `ingest()` never passes the name through
   `redactProperties`. `user.5551234567.ada.lovelace` is accepted and stored verbatim.

This is first-party-plane exposure (pre-gate), not co-op leakage, so it is a breach-surface
and DPA problem rather than an anonymisation one — which is why it sits at Medium.

**Fix,** all in `src/core/redaction.ts` unless noted:

- Run `redactString` over key names as well as values; drop the property when a key matches.
- `String.prototype.normalize('NFKC')` before matching (this alone kills full-width `＠`),
  and rewrite the email pattern with the `u` flag and `\p{L}\p{N}` instead of `\w`.
- Coerce numbers to strings and run the `phone` / `card` / `ipv4` patterns over them.
- Add `lon|long|geo|coord|gps|x_deg|y_deg` to `BLOCKED_KEY_PATTERN:22`.
- Add a base64/hex heuristic: decode candidate high-entropy strings of length ≥ 16 and
  re-run the pattern set on the decoded text.
- In `src/core/ingest.ts:43`, tighten `EVENT_NAME_PATTERN` to a registered event-name
  allowlist per workspace, or at minimum run the name through `redactString`.

**Holds** (defence in depth working): value-level patterns still catch `userEmail` and
`emailAddress` even though the key blocklist misses camelCase; nested keys are composed
before blocklisting so `{user:{email}}` is dropped as `user_email`; depth > 1 is discarded
rather than stringified; arrays collapse to a count with no membership leak.

---

### F-14 — Epoch rotation provides no forward secrecy

**Severity: Low.** `src/core/identity.ts:22, 42-64, 90-106`.

identity.ts claims "after an epoch flips, yesterday's key can no longer be joined to
today's". That holds against an attacker *without* the root secret. But the epoch is a
plaintext counter mixed into the HMAC **message**; the key material is a single long-lived
`rootSecret` that is never rotated and never destroyed.

`subjectKeysForRetentionWindow` is a ready-made relinking oracle: given a raw identifier it
regenerates every pseudonym that identifier has ever held across the full 400-day retention
window. Verified: a one-year-old key is reproduced exactly. And because the epoch derives
from a client-supplied `occurredAt`, any past epoch can be addressed by backdating.

So "we do not build persistent profiles" is a policy claim, not a construction claim.
Anyone holding the secret — the operator, an insider, a subpoena, a backup leak — can join
a person's rows across every epoch in the retention window.

**Holds, and it is the strongest claim in 04-data-governance.md:** cross-workspace
unlinkability is real. `HMAC(rootSecret, "workspace:" + id)` scoping means the same human in
three apps yields three unrelated keys, and nothing in the codebase inverts it.

**Tests:** `VULN-13` (2 vuln + 2 holds).

**Fix.** `src/core/identity.ts` — derive a per-epoch subkey
`HMAC(rootSecret, "epoch:" + n)`, hold it in an HSM or KMS, and **destroy** subkeys older
than the retention window so historical pseudonyms genuinely become underivable. Restrict
`subjectKeysForRetentionWindow` to the erasure path with audit logging. Update
identity.ts's docblock: today it overstates the guarantee.

---

### F-15 — The budget is in-process, non-durable, and never rolls over

**Severity: Low** (operational). `src/api/server.ts:41`,
`src/core/privacy/differential-privacy.ts:75`.

`PrivacyBudget` holds a private `Map` in a module-level singleton. A process restart, a
deploy, or a second replica behind a load balancer resets every cohort's spend to zero.
There is also no period-rollover implementation — the refresh the refusal message promises
("It refreshes next period") happens only because `period` is part of the key, and `period`
is caller-supplied (F-3).

**Fix.** Persist spend to Postgres keyed by `(populationHash, metricId, period)` with a
transactional check-and-decrement, per the storage tier in
[03-architecture.md](03-architecture.md). An in-memory budget across replicas is not a
budget.

---

## What did not work

These attacks were attempted and failed. Several are the only reason the failures above are
not worse, and each is now a regression guard.

| Attack | Result |
|---|---|
| Pad a thin cohort with non-consented rows to clear k | **Failed.** The gate filters first (`release-gate.ts:81`) and every downstream computation reads `eligible`. 50 non-consented workspaces with 1000 subjects each were completely invisible to the counts, thresholds and distribution. `HOLDS-1/2` |
| Shift the published distribution using non-consented rows | **Failed.** Same reason. Counts identical to the consented-only release, to the unit. |
| Learn anything from the "nobody consented" refusal | **Failed.** That branch returns before k-anonymity and carries no `verdict`. `HOLDS-3` |
| Overspend inside a fixed budget key | **Failed.** Exactly 10 releases at ε = 0.1 against a 1.0 budget, then refusal. `HOLDS-4` |
| Buy low noise with a huge `epsilonPerQuery` | **Failed.** `trySpend` refuses ε > remaining, capping a single query at the cohort budget. |
| Force an out-of-domain output to reveal the noise draw's sign and magnitude | **Failed.** Clamping holds on all six statistics across 1200 draws. `HOLDS-7` |
| Poison the aggregate with a value of 1e9 | **Failed.** `clamp` runs before measurement, exactly as the docblock claims. `HOLDS-8` |
| Predict or subtract the noise stream | **Failed.** `randomInt` from `node:crypto`; 60 interior draws, zero repeats. `HOLDS-5` |
| Rewrite consent history | **Failed.** The hash chain detects mutation at the exact entry. `HOLDS-6` |
| Link the same person across workspaces | **Failed.** Per-workspace HMAC scoping. This is the claim 04-data-governance.md leans hardest on and it survives. the `HOLDS` case in `VULN-13` |
| Grant consent via a prototype-shaped jurisdiction (`__proto__`, `constructor`, `toString`) | **Failed,** fail-closed. Note the lookup returns `undefined`, which is not a valid `ConsentState` — it fails closed by luck rather than by design. Worth a `hasOwnProperty` guard in `consent.ts:126` and a type fix. |
| Slip an email past redaction under a camelCase key | **Failed.** The key blocklist misses `userEmail`, but the value scan catches it. |
| Hide PII in a nested object | **Failed.** Keys are composed before blocklisting; depth > 1 is dropped, not stringified. |
| Leak list membership through an array property | **Failed.** Collapsed to a count; no `@` survives anywhere in the output. |
| Run with a weak root secret | **Failed.** Both `identity.ts:48` and `server.ts:32` refuse to proceed. |

---

## Recommended order of work

1. **F-2** — wire per-subject `coop_licensing` into the release predicate. Nothing should be
   licensed until this lands; it is the difference between a co-op and a data broker.
2. **F-1 / F-11** — replace the quantile mechanism with a DP histogram over a public bin
   grid. One change fixes the DP violation, the sensitivity inversion, the `.sort()` bias
   and the k=10 uselessness.
3. **F-3 / F-4** — per-workspace epsilon ledger keyed on population, not label.
4. **F-6 / F-7** — stop returning exact counts on both the refusal and the release path.
5. **F-8** — one value per workspace, weighted by subjects.
6. **F-5 / F-9 / F-10** — independent-party verification, threshold floors, signed
   provenance over the full payload.
7. **F-12 / F-13 / F-14 / F-15** — ingest hardening and operational durability.

Until at least items 1–4 are done, `docs/04-data-governance.md`'s claim that co-op releases
are "outside GDPR material scope (Recital 26)" should be withdrawn from customer-facing and
buyer-facing material. The open question the document already flags for counsel — *"Does our
anonymisation clear the EDPB bar?"* — currently has a demonstrable answer, and it is no.

## Reproduction

```
cd percentile
npm run typecheck
npm test
```

`test/adversarial.test.ts` contributes 52 tests. Statistical attacks use enough trials that
each assertion margin is several standard errors wide; the suite was run 10+ consecutive
times with no flakes. A `VULN-n` test that starts *failing* most likely means the hole was
fixed — delete the test and record the fix rather than repairing the assertion.
