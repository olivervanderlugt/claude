# Legal review — Layer 3 (the data co-op)

Reviewed: 27 July 2026. Scope: whether the co-op plane is genuinely outside GDPR material
scope and outside CCPA "personal information", and what breaks first if it is not.

This document reviews the **implementation**, not the design document.
[04-data-governance.md](04-data-governance.md) describes a defensible architecture. The
code in `src/` does not currently implement it. Most of what follows is about that gap.

---

## Executive verdict

**No, not as it stands. Conditionally yes, after seven blocking fixes and one structural
re-framing.**

Three separate things are wrong, and they are wrong at different levels.

**1. The consent gate the whole thesis rests on is not wired up.** `docs/04` says step 1 of
the release gate is "only observations with `coop_licensing` consent". It is not. The only
production call site passes `(o) => store.hasCoopConsent(o.workspaceId)`, and that function
returns `profile.coopEnrolled` — whether the *developer* signed the addendum. The end
user's `coop_licensing` decision is collected, hash-chained, tested, and then never read by
anything. `benchmark_contribution` is never read either. Until this is fixed, every
statement in `docs/04` about consent-filtered aggregates is false, and so is the Recital 26
argument built on top of it, and so is the co-op addendum's warranty chain, and so is the
CNIL analytics exemption. This is one predicate function. It is also the entire company.

**2. The differential-privacy guarantee is not sound, so "we apply ε-differential privacy"
is currently a claim you cannot substantiate.** Laplace noise is applied to *percentiles* at
sensitivity `(hi−lo)/contributorCount`. That is not the sensitivity of a quantile. Separately
the ε budget is keyed per *(cohort, metric)* rather than per cohort, the period is
caller-controlled, and the budget lives in a process-local `Map` that resets on every deploy.
This is a substantiation problem before it is a privacy problem: an unsound guarantee sold to
buyers is a misrepresentation exposure independent of whether anyone is ever re-identified.
(I was not able to research the FTC's current positions on "anonymised" and "aggregated"
claims — see the final section. Do that before publishing any DP claim.)

**3. The law moved three weeks ago and moved against the framing.** On **7 July 2026** the
EDPB adopted [Guidelines 02/2026 on Anonymisation](https://www.edpb.europa.eu/public-consultations/guidelines-022026-on-anonymisation_en)
([PDF](https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202602_anonymisation_v1_en_0.pdf)),
the first replacement for WP216 in twelve years, open for consultation until 30 October
2026. It takes the position that **anonymisation is itself a processing activity requiring
its own Article 6 legal basis** — and an Article 9(2) exemption where special categories are
involved. That directly undercuts the "we are a controller of anonymous data, therefore
outside material scope" line in `docs/04`. The *output* being anonymous never excused the
*act of producing it*, and the EDPB has now said so explicitly. See
[Freshfields](https://www.freshfields.com/en/our-thinking/blogs/technology-quotient/anonymous-or-not-the-edpbs-new-draft-guidelines-on-anonymisation-102nbv5)
and [Eversheds Sutherland](https://www.eversheds-sutherland.com/en/united-states/insights/edp-bs-new-guidelines-on-anonymisation-a-more-nuanced-approach-for-the-ai-era).
⚠️ This proposition is drawn from commentary rather than the text — see §2 and the final
section. It is the one headline claim here that should be checked first.

The good news is real and worth stating: the *shape* of the design survives all three. The
release gate as a single choke point is right. The layered consent model is right. The
per-workspace pseudonym keying is right and is genuinely hard to retrofit, which is the
moat `docs/08` claims it is. Nothing here requires an architectural rewrite. It requires
finishing the architecture that is already documented.

**What I would tell a board:** Layer 3 is not licensable today and should not be sold to a
design partner as if it were. It is roughly one engineering month plus one written counsel
opinion away from being licensable in the US, and one further quarter away from being
licensable on EU-sourced data. Do not let a term sheet set that order.

---

## 1. Does k=10 workspaces + 500 subjects + ε=1.0 clear the EU anonymisation bar?

**Verdict: the thresholds are not the binding constraint, and arguing about them is a
distraction from the two things that actually fail.** As numbers in isolation they are
inside the range a regulator would engage with rather than dismiss. As implemented they do
not deliver what they claim, for reasons that have nothing to do with the choice of 10 or
500 or 1.0.

### The legal test

[WP216](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp216_en.pdf)
(Opinion 05/2014, adopted 10 April 2014;
[IAPP mirror](https://iapp.org/media/pdf/resource_center/wp216_Anonymisation-Techniques_04-2014.pdf))
sets three cumulative criteria: **singling out**, **linkability**, and **inference** — the
last being the ability to deduce an individual's attributes from other values in the
dataset. WP216 is explicit that k-anonymity addresses singling out but **does not defend
against inference**: its stated weakness is that aggregation can be performed over too small
a group, allowing inferences to be drawn. l-diversity and t-closeness remain vulnerable to
linkability.

WP216 is now superseded in substance by **EDPB Guidelines 02/2026 on Anonymisation (7 July
2026)**, which offer two routes: a **contextual approach** that accounts for differences in
capability between potential attackers, and a **simplified approach** that is more
convenient but, in the EDPB's own framing, goes beyond what the legal standard strictly
requires. The Guidelines also impose a **documentation obligation**: controllers must be
able to evidence both the compliance of the anonymisation process and its effectiveness,
including testing of the supposedly anonymous output.

The identifiability standard itself is now clearly relative rather than absolute. In
**Case C-413/23 P, EDPS v SRB, judgment of 4 September 2025**
([EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:62023CJ0413),
[Court press release](https://curia.europa.eu/site/upload/docs/application/pdf/2025-09/cp250107en.pdf))
the CJEU held for the first time that strongly pseudonymised data may be personal data for
the transferring controller and **not** personal data for a recipient who cannot reverse the
pseudonymisation and has no other means of identification. Identifiability turns on "all
the means reasonably likely to be used" **by the specific actor**, assessed on technical,
legal and practical grounds. Analyses:
[FPF](https://fpf.org/blog/rethinking-personal-data-the-cjeus-contextual-turn-in-edps-vs-srb/),
[Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2025/09/analysis-of-the-cjeu-judgment),
[Clifford Chance](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2025/09/pseudonymized-data-after-edps-v-srb.html),
[Skadden](https://www.skadden.com/insights/publications/2025/11/in-a-landmark-decision-eu-court-clarifies).

**Do not over-read SRB.** Two limbs of that judgment cut against us:

- At paragraph 84 the Court states that data which are **in themselves impersonal may become
  personal** where the controller puts them at the disposal of others who have means
  reasonably likely to enable identification. That is a warning about *recipients*, not a
  safe harbour. A hedge fund with its own app-usage panel is a materially better-equipped
  adversary than Deloitte was.
- On the **transparency** ground the Court held the General Court **erred** in requiring the
  recipient's point of view: identifiability for the purposes of the duty to inform is
  assessed **at the time of collection and from the controller's perspective**. So even a
  perfectly anonymous published aggregate does not relieve the disclosure obligation owed to
  end users at collection — the notice must already name the category of recipient.

Also note the counter-current: the Commission's Digital Omnibus would write a contextual
test into Article 4(1) GDPR, and the EDPB and EDPS pushed back hard in
[Joint Opinion 2/2026 (10 February 2026)](https://www.edpb.europa.eu/our-work-tools/our-documents/edpbedps-joint-opinion/edpb-edps-joint-opinion-22026-proposal_en),
recommending deletion of the proposed provision as going far beyond a technical amendment
and narrowing the concept of personal data. Building the business on the assumption that
the relative approach will keep widening is a bet on a live political fight.

### Applying it to what the code does

There is no published EU threshold for k. Regulators assess the pipeline, not the constant.
On the pipeline:

| Criterion | Verdict | Why |
|---|---|---|
| Singling out | **Probably met** | 10 workspaces, 500 subjects, ≤34% dominance, and only a five-point ladder plus a mean is published. Nothing in `AggregateRelease` isolates a record. |
| Linkability | **Met, and this is the design's real strength** | Per-workspace HMAC keying (`identity.ts`) means the same human in two apps yields two unlinkable keys. This is a genuine structural defence, not a policy. |
| Inference | **Not met as implemented** | This is where it fails, and WP216 named it as k-anonymity's specific weakness. |

The inference failure has three concrete causes, all in `src/core/privacy/`:

1. **Laplace noise on quantiles is not a valid mechanism.** `release-gate.ts:120-122` sets
   `sensitivity = (metric.hi - metric.lo) / verdict.contributorCount` and applies
   `laplaceNoise(sensitivity, epsilon/6)` to `p10, p25, p50, p75, p90` and the mean. The
   sensitivity of a *mean* over n clamped values is indeed `(hi−lo)/n`. The sensitivity of a
   *quantile* is not: removing one record shifts a quantile by the gap between adjacent
   order statistics, which for a sparse or bimodal cohort approaches `hi−lo`. Quantiles
   require the exponential mechanism or a smooth-sensitivity construction. As written, the
   ladder carries no ε-DP guarantee at all — only the mean does.

2. **The stated unit of protection contradicts the dominance rule.** The comment at
   `release-gate.ts:117-118` says "one workspace is the unit of contribution … so
   sensitivity is scaled by the number of contributors". But `MAX_CONTRIBUTOR_SHARE = 0.34`
   permits a single workspace to supply 34% of subjects. Such a workspace can move the
   statistic by roughly `0.34 × (hi−lo)`, which is more than three times the assumed
   sensitivity of `(hi−lo)/10`. Workspace-level DP does not hold either. Since the whole
   commercial promise of `MIN_CONTRIBUTORS` is "a competitor cannot read a rival's
   conversion rate off the dataset", this is the defect that matters most to buyers.

3. **Exact counts are published un-noised and un-charged.** `contributorCount` and
   `subjectCount` go out verbatim (`release-gate.ts:142-143`) and cost zero ε. Exact
   population counts republished every period are the cleanest differencing channel in the
   system — precisely the attack `differential-privacy.ts` opens by warning about.

And the budget does not do what `docs/04` says:

- `budgetKey = ${cohortKeyString(cohort)}::${metric.name}` (`release-gate.ts:107`). ε=1.0 is
  therefore spent **per metric**, not per cohort. Total ε exposure for a cohort scales
  linearly with the metric catalogue. `docs/04` claims "ε ≤ 1.0 per cohort per period".
- `CohortKey.period` is part of the key, and `/v1/benchmarks` reads `period` straight from
  the query string (`server.ts:196`). A caller mints a fresh ε=1.0 budget per period on
  demand, unbounded over time.
- `PrivacyBudget` stores spend in an in-process `Map` (`differential-privacy.ts:76`)
  instantiated at module scope (`server.ts:41`). **Every deploy resets every budget to
  zero.** For a product that ships continuously this means the budget is close to
  decorative — the exact failure mode `differential-privacy.ts:9-11` calls out.

On ε=1.0 itself: it is a defensible per-release figure and I would not change it. The
problem is composition, not the constant. A cohort queried across 12 metrics and 52 weekly
periods currently permits cumulative ε in the hundreds, and cumulative ε is the only number
that means anything.

### What the thresholds should be

Raising k will not fix an unsound mechanism, and `docs/08` correctly identifies cohort
density as the existential risk — so do not raise k reflexively. My recommendation is to
**hold k=10 and 500 subjects, tighten dominance, and fix the mechanism and the accounting**:

| Constant | Now | Recommend | Reason |
|---|---|---|---|
| `MIN_CONTRIBUTORS` | 10 | **10** (hold) | Defensible; raising it kills coverage without addressing inference. |
| `MIN_SUBJECTS` | 500 | **500** (hold) | Adequate given the five-point ladder. |
| `MAX_CONTRIBUTOR_SHARE` | 0.34 | **0.15** | Makes the workspace-level sensitivity assumption approximately true instead of false by a factor of three. This is the single highest-value constant change. |
| `DEFAULT_EPSILON_BUDGET` | 1.0 per (cohort, metric), in-memory | **1.0 per cohort per period, persisted, all metrics sharing it** | Matches what `docs/04` already claims. |
| Quantile mechanism | Laplace at mean-sensitivity | **Exponential mechanism**, or publish only DP means and DP counts | Restores an actual guarantee. |
| Published counts | exact | **noised and ε-charged**, or bucketed to the size ladder | Closes the differencing channel. |

**Bottom line for Q1:** with the dominance change, a correct quantile mechanism, persisted
cross-metric budget accounting, and the consent filter actually connected, the aggregates
are defensible as anonymous under the contextual approach in Guidelines 02/2026, and the
per-workspace keying gives a genuinely strong linkability story. Without the consent filter
the question does not arise, because the input is unlawful regardless of how good the output
is.

---

## 2. Is the "processor for Layer 1, controller of anonymous data for Layer 3" split sustainable?

**Verdict: the two-plane framing is right; the label on the second plane is wrong, and
`docs/04` should be rewritten. This is the risk the founder is most likely to under-rate,
because it survives every technical fix in this document.**

The table in `docs/04` describes the co-op plane as "Controller of anonymous data — outside
GDPR material scope". That elides a step. There are three processing operations, not two:

1. Collecting and storing pseudonymous events for the developer — **processor**, correctly
   identified.
2. **Reading that personal data and computing an aggregate from it, for Percentile's own
   commercial benefit.** This is processing of personal data. It has a purpose determined by
   Percentile, not by the developer. Percentile is a **controller** for it.
3. Licensing the resulting aggregate — genuinely outside scope, if the aggregate is
   genuinely anonymous.

Step 2 is the exposure and it is not currently modelled anywhere.

The supporting law is now unusually clear:

- **EDPB Guidelines 02/2026** state that anonymisation is itself a processing activity
  requiring an Article 6 legal basis, and an Article 9(2) exemption where special categories
  are in play. This is a change from WP216, which treated anonymisation as further processing
  compatible with the original purpose and therefore **not** requiring its own basis
  ([IAPP on the old position](https://iapp.org/news/a/does-anonymization-or-de-identification-require-consent-under-the-gdpr)).
  Anyone relying on the older position — as `docs/04` implicitly does — is relying on
  guidance the EDPB has just replaced.

  ⚠️ **This specific proposition comes from law-firm commentary on the Guidelines, not from
  the text itself, which I could not open.** It is the most consequential unverified claim
  in this review. It is asserted consistently across
  [Freshfields](https://www.freshfields.com/en/our-thinking/blogs/technology-quotient/anonymous-or-not-the-edpbs-new-draft-guidelines-on-anonymisation-102nbv5),
  [Eversheds Sutherland](https://www.eversheds-sutherland.com/en/united-states/insights/edp-bs-new-guidelines-on-anonymisation-a-more-nuanced-approach-for-the-ai-era)
  and others, which is why I have relied on it — but **verify it against the PDF before the
  counsel engagement**, because if it is wrong, most of this section relaxes considerably.
- **[EDPB Guidelines 07/2020 on controller and processor](https://www.edpb.europa.eu/system/files/documents/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf)**:
  a processor that goes beyond the controller's instructions and determines its own purposes
  "will then be considered a controller in respect of that processing and may be subject to
  sanctions". Article 28(10) says the same. The developer's authorisation in a DPA does not
  convert Percentile's own purpose into the developer's purpose.

So the honest structure is **joint or successive controllership for the aggregation step**,
with the developer as controller of the source data and Percentile as controller of the
aggregation. That is not fatal. It is a paperwork and lawful-basis problem, and there are
two workable routes:

**Route A — consent (what the code already models).** `coop_licensing` as a distinct,
unbundled, purpose-specific consent obtained from the end user. This is the architecture
already built. It just is not connected. Preferred, because it is the only route that also
satisfies CCPA's opt-in for under-16s and keeps the "consent-first" positioning honest.

**Route B — legitimate interest, with statistical-purpose framing.** Article 5(1)(b) treats
further processing for statistical purposes as **not incompatible** with the original
purpose, subject to Article 89(1) safeguards — and where that presumption applies, no
separate Article 6(4) compatibility test is needed. **Recital 162** conditions "statistical
purposes" on the result being **aggregate** and **not used for measures or decisions
regarding any particular natural person**. A k-anonymised, DP-noised cohort statistic fits
that description unusually well. Benchmarks fit; per-user targeting would not.

And **Case C-621/22 (KNLTB), 4 October 2024** confirms purely commercial interests are not
categorically excluded from being legitimate interests
([A&O Shearman](https://www.aoshearman.com/en/insights/ao-shearman-on-data/cjeu-commercial-interests-of-controller-can-serve-as-a-legitimate-interest),
[Hogan Lovells](https://www.hoganlovells.com/en/publications/cjeu-clears-the-air-dutch-dpas-interpretation-of-legitimate-interests-is-too-strict)).
The CNIL's [June 2025 guidance](https://www.cnil.fr/en/relying-legal-basis-legitimate-interests-develop-ai-system)
also accepts legitimate interest for "improving a product or service to increase its
performance", provided data subjects are informed of the risks and can **object in advance
and at any time without that affecting their use of the service**.

This is a real option for **Layer 2 benchmarks**, where the benefit flows back to the same
population and the Recital 162 framing is honest. I would **not** rely on it for Layer 3: the
balancing test fails on reasonable expectations once a third party pays for the output,
which is exactly the argument `docs/04` itself makes at "Legitimate interest does not stretch
this far" — and that argument is correct. Note also that the Article 5(1)(b) presumption
will **not** carry reuse for AI-model training, which is not "statistical purposes" because
the object is not to produce aggregate data.

Note that Route B does not avoid the transparency duty either. Under SRB, the duty to
identify recipients is assessed at collection from the controller's perspective, before any
pseudonymisation or aggregation.

### What the DPA must say

- Name Percentile as **processor for Layer 1 and controller for the aggregation step**.
  Do not describe the co-op as "processing on the developer's behalf" — it is not, and a
  regulator reading the DPA against `docs/04` will notice.
- Record the **Article 6 basis for the anonymisation operation itself**, per Guidelines
  02/2026, and the Article 9(2) position (see §7).
- Article 28(3)(a) instructions must **expressly authorise** the aggregation and state that
  Percentile acts as controller for it.
- Retention: 400 days (`.env.example`) is the developer's call as controller and must be
  configurable per workspace, not a platform constant.
- Sub-processor list, SCCs, audit rights, breach terms — standard, not the interesting part.

### What the co-op addendum must say

- The **end user's** `coop_licensing` consent is a condition precedent to any observation
  entering a cohort — with the developer warranting that its consent flow actually collects
  it (see §4).
- Percentile's controllership of the aggregation, and the lawful basis relied on.
- The developer's Article 13/14 notice obligations, including **naming Percentile and the
  category of recipients at the point of collection**, which SRB makes non-negotiable.
- The revenue share, and an acknowledgement that it does not make the developer a
  joint controller of the released aggregates.
- Termination: what happens to already-published aggregates on withdrawal. `docs/04` already
  answers this honestly ("previously published aggregates are anonymous and are not
  recalled") and that answer is correct — put it in the contract, not only in an API
  response.

---

## 3. California: Delete Act, data-broker status, and DROP

**Verdict: on a correct implementation the design does avoid data-broker status. Register
anyway. The asymmetry is not close, and `docs/04` already reaches this conclusion in its
open questions — it is right.**

### The definition

[Cal. Civ. Code § 1798.99.80](https://codes.findlaw.com/ca/civil-code/civ-sect-1798-99-80/):
a "data broker" is *"a business that knowingly collects and sells to third parties the
personal information of a consumer with whom the business does not have a direct
relationship"*. Exemptions are narrow — FCRA, GLBA, the Insurance Information and Privacy
Protection Act, and HIPAA-covered processing via § 1798.146. None applies here.

Percentile plainly has no direct relationship with end users. So everything turns on
**"personal information"**.

- [§ 1798.140(v)](https://codes.findlaw.com/ca/civil-code/civ-sect-1798-140/): personal
  information *does not include* consumer information that is **deidentified** or
  **aggregate consumer information**.
- **§ 1798.140(b)**: "aggregate consumer information" means information relating to a group
  or category of consumers, individual identities removed, not linked or reasonably linkable
  to any consumer or household including via a device — and expressly *"does not mean one or
  more individual consumer records that have been deidentified"*.
- [§ 1798.145(a)(5)](https://california-ccpa.org/section-1798-145-exemptions/): nothing in
  the CCPA restricts a business's ability to collect, use, retain, sell, or disclose
  deidentified or aggregate consumer information.

A five-point percentile ladder plus a mean over ≥500 subjects across ≥10 workspaces is
squarely "aggregate consumer information" and not a deidentified individual record. That is
the strongest single argument in this review, and it is stronger than the GDPR argument.

But **§ 1798.140(m)** attaches three conditions that are currently unmet, and they are
conditions on the *business*, not on the data:

| Condition | Status |
|---|---|
| (1) reasonable measures to ensure the information cannot be associated with a consumer or household | Partially — the gate exists, but the DP defects in §1 undercut "reasonable measures" |
| (2) **publicly commit** to maintain and use the information in deidentified form and not attempt reidentification | **Not done.** No public commitment exists anywhere in the repository |
| (3) **contractually obligate** any recipients to comply with all provisions of this subdivision | **Not done.** No licence template exists |

Condition (2) is cheap and blocking. It is a paragraph on the website.

### DROP

- The [DROP platform](https://cppa.ca.gov/data_brokers) went live for consumers **1 January
  2026** (regulations approved by OAL 13 November 2025 —
  [Orrick](https://infobytes.orrick.com/2025-11-19/california-finalizes-delete-act-regulations-enabling-one-click-data-deletion/)).
- Registered brokers must access DROP **at least every 45 days and process deletion
  requests from 1 August 2026** — five days from this review
  ([Alston & Bird](https://www.alstonprivacy.com/drop-is-coming-due-what-californias-delete-act-means-for-data-brokers-in-august/),
  [Fenwick](https://www.fenwick.com/insights/publications/dont-drop-ball-upcoming-changes-california-delete-act-five-key-steps-companies)).
- **§ 1798.99.86(d)(1)**: $200 per deletion request per day for failure to delete.
  **§ 1798.99.82(d)**: $200 per day for failure to register. Registration fee is **$6,000**,
  due by **31 January** annually.
- Enforcement is live, not theoretical. CalPrivacy (the rebranded CPPA) has run a **Data
  Broker Strike Force**
  ([Crowell](https://www.crowell.com/en/insights/client-alerts/california-privacy-agency-launches-data-broker-strike-force-amid-delete-act-crackdown))
  and by December 2025 had brought at least eight public actions — Accurate Append, Key
  Marketing Advantage, Growbots, UpLead, ROR Partners — with fines in the ~$34k–$56k range.
  Those are registration failures, which is the cheap end.

### Should you register defensively?

**Yes.** Reasoning:

- Cost of registering when you need not: $6,000/year plus filing effort, plus DROP
  processing you can satisfy trivially because you hold no PI about non-customers.
- Cost of not registering when you should have: $200/day accruing from the moment you first
  licensed, plus $200/request/day against a DROP queue, plus investigation costs, plus the
  reputational damage of a privacy-positioned company being listed as an unregistered
  broker.
- The judgement call is not a close one and it does not depend on winning the aggregate
  argument.

One caveat that cuts the other way and needs counsel: registering is a **public
representation that you are a data broker**, which a plaintiff or a European regulator may
later quote back when you argue that the same data is anonymous and out of scope. Have
counsel draft the registration narrative so it is consistent with the anonymity position —
register as a precaution while stating the aggregate-only basis, rather than conceding the
characterisation.

### SB 361 — the item nobody has modelled

[SB 361, the "Defending Californians' Data Act"](https://legiscan.com/CA/text/SB361/id/3272628),
signed **8 October 2025**, effective **1 January 2026**, expands broker disclosure to
include whether the broker has shared or sold information to **foreign actors, government
entities, law enforcement, or AI developers**
([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/california-expands-data-broker-registration-requirements),
[Finnegan](https://www.finnegan.com/en/insights/articles/defending-californians-data-act.html)).

Percentile's stated buyer set is VCs, dev-tool vendors and hedge funds — and cohort
datasets about AI-built apps are training-adjacent by construction. If you register, the
"sold to AI developers" disclosure is a live question and should be answered deliberately
rather than discovered at filing.

Also note the CCPA regulations effective **1 January 2026** (OAL approval 23 September 2025)
require a **risk assessment before processing that presents significant risk**, expressly
including selling or sharing personal information and processing sensitive personal
information
([MoFo](https://www.mofo.com/resources/insights/251007-ccpa-regulations-on-cybersecurity-risk-assessments),
[Skadden](https://www.skadden.com/insights/publications/2025/10/california-finalizes-cppa-regulations)).
Layer 1 processing may well trip this even if Layer 3 does not.

### Other state registries — and this is worse than California

The California analysis does **not** transfer. The other registries do not share California's
definitional architecture, and two of them have no deidentification carve-out at all.

| State | Definition core | Deidentified / aggregate carve-out | Fee | Penalty |
|---|---|---|---|---|
| **Texas** — [Bus. & Com. Code ch. 510](https://tcss.legis.texas.gov/resources/BC/htm/BC.510.htm) (SB 2105; redesignated from ch. 509 by HB 1620, eff. 1 Sep 2025) | Collects, processes or transfers personal data not collected directly from the individual. SB 2121 (eff. 1 Sep 2025) **removed** the "principal source of revenue" limiter. Thresholds: >50% of revenue, **or** data of >50,000 individuals. No scienter | **Yes — the broadest.** Excludes deidentified data (reasonable technical measures + public commitment to process/transfer only in deidentified form + commitment not to reidentify), publicly available information, and inferences drawn exclusively from multiple independent public sources | $300 | AG: ≥$100/day, capped $10,000 per 12 months |
| **Oregon** — [ORS 646A.593](https://oregon.public.law/statutes/ors_646a.593) | Collects, sells or licenses **"brokered personal data"** — data elements about a resident **categorised or organised for sale or licensing**. No scienter, no revenue or volume threshold | **None found.** Only a narrow activity exemption for publicly available business/professional information and health/safety alert services | $600 | DCBS: up to $500/violation + $500/day, cap $10,000/yr |
| **Vermont** — [9 V.S.A. § 2430](https://legislature.vermont.gov/statutes/section/09/062/02430) | **Knowingly** collects and sells or licenses brokered personal information of a consumer with whom it has **no direct relationship** | **None found.** The publicly-available exclusion is limited "to the extent that it is related to a consumer's business or profession" | $100 → **$900 + $20,000 surety bond from 1 Jan 2027** | $50/day, cap $10,000/yr → **$200/day, no cap, from 1 Jan 2027** |

**Oregon is the sharpest risk in this review outside the consent gate.** "Brokered personal
data" is defined by the *act of categorising or organising data for sale or licensing* —
which is a description of what the co-op plane does. There is no scienter element, no
revenue or volume threshold, and no deidentification exclusion to fall back on. The
California argument ("it is not personal information, therefore not a sale") has no obvious
Oregon analogue.

Vermont is less bad only because it retains both a "knowingly" element and a
direct-relationship limb — but it also has no deidentification carve-out, and **Act 138
(signed 16 June 2026, effective 1 January 2027)** raises the fee to $900, adds a **$20,000
surety bond**, moves the penalty to **$200/day uncapped**, and adds disclosures about sales
to generative-AI developers, government and foreign actors
([Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/vermont-enacts-significant-amendments-to-data-broker-legislation)).

**Two new registries land before this business would scale:**

- **Connecticut** — SB 4 / Public Act 26-64. Registration from **1 January 2027**, plus a
  universal deletion mechanism on the California model
  ([Proskauer](https://privacylaw.proskauer.com/2026/06/articles/data-privacy-laws/from-data-brokers-to-dna-connecticut-enacts-sweeping-privacy-amendments/)).
- **New Jersey** — A5328 / P.L. 2026 c.25, enacted **30 June 2026**, registry effective
  **27 March 2027**. Uniquely registers data brokers **and first-party "data collectors"** —
  which would reach **Layer 1**, not just Layer 3. Fees scale **$5,000–$1,500,000** by
  volume, with **$2,500/day** penalties and **$50,000 per record** for prohibited
  sensitive-data sales
  ([FPF](https://fpf.org/blog/data-brokers-beyond-navigating-new-jerseys-data-broker-data-collector-registration-law/),
  [Troutman](https://www.troutmanprivacy.com/2026/07/new-jersey-enacts-the-nations-costliest-data-broker-law-yet/)).

New Jersey deserves specific attention: a first-party data-collector registry means the
"we are only a processor for Layer 1" position stops being protective there.

Note also **CalPrivacy Enforcement Advisory 2025-01 (17 December 2025)**: registration does
**not** flow from parent to subsidiary or between affiliates — each entity registers
separately ([PDF](https://cppa.ca.gov/pdf/enfadvisory202501.pdf)). Relevant if Percentile
ever puts the licensing entity in a separate company, which is the obvious structuring
instinct here.

### GPC is being enforced, and the California rule names pseudonymous profiles

Twelve states now mandate honouring a universal opt-out mechanism, with **Delaware and
Oregon joining on 1 January 2026**. California's rule,
[11 CCR § 7025](https://regulations.justia.com/states/california/title-11/division-6/chapter-1/article-3/section-7025/),
requires a business that sells or shares to process a conforming opt-out preference signal
and treat it as a valid § 1798.120 request for that browser or device **"and any consumer
profile associated with that browser or device, including pseudonymous profiles"**. That
phrase is aimed precisely at architectures like this one: a per-workspace HMAC pseudonym is
a pseudonymous profile, and honouring GPC for the request only (see §6(d)) does not satisfy
it.

Enforcement is no longer theoretical:

- **Todd Snyder, Inc.** — CPPA, 6 May 2025, **$345,178**. A misconfigured banner left GPC and
  other opt-out signals unprocessed for 40 days
  ([Covington](https://www.insideprivacy.com/ccpa/clothing-retailer-todd-snyder-inc-settles-cppa-allegations-regarding-california-consumer-privacy-act-violations/)).
- **Healthline Media** — California AG, 1 July 2025, **$1.55 million**, the largest CCPA
  settlement to date, for continuing to share data on consumers who had opted out including
  via GPC ([AG release](https://oag.ca.gov/news/press-releases/attorney-general-bonta-announces-largest-ccpa-settlement-date-secures-155)).
- A coordinated **CA/CO/CT opt-out-signal sweep** reported September 2025
  ([Goodwin](https://www.goodwinlaw.com/en/insights/publications/2025/09/alerts-technology-dpc-multistate-privacy-enforcement-sweep)).

Note that Todd Snyder was a *configuration* failure, not a policy failure — which is exactly
the category the defect in §6(d) falls into. Also forthcoming: **AB 566, the California Opt
Me Out Act**, signed 8 October 2025 and operative **1 January 2027**, requiring browsers to
ship a configurable opt-out signal
([CPPA](https://cppa.ca.gov/announcements/2025/20251008_2.html)) — GPC volume will rise
sharply, so a per-request implementation degrades rather than holds.

---

## 4. Is the co-op addendum enforceable? Does the developer hold the rights it grants?

**Verdict: not currently, and not fixable by drafting alone. The chain has a hole in the
middle, and it is the same hole as §1.**

The chain the addendum needs is:

```
end user  --consent-->  developer (controller)  --addendum-->  Percentile
```

Today the second arrow exists (`coopEnrolled`) and the first arrow is collected but never
checked. So the developer is warranting rights it has no mechanism to have obtained, and
Percentile is relying on a warranty it never verifies. A warranty against a solo developer
who shipped a Lovable app is worth approximately nothing when the counterparty is a Dutch
DPA — indemnities do not survive contact with an insolvent indemnitor.

**Can the developer grant these rights at all?** Only conditionally. Under Article 28(10)
and Guidelines 07/2020, a controller cannot authorise a processor to pursue its own purposes
by contract; the processor becomes a controller and needs its own basis (§2). What the
developer *can* do is (a) obtain purpose-specific end-user consent that names the co-op, and
(b) provide Article 13 notice identifying Percentile and the recipient categories. Under
**SRB**, that notice duty is assessed at the time of collection and from the controller's
perspective — it is not cured by the output being anonymous.

**What must be true in the developer's own privacy policy and consent flow:**

1. A **separate, unbundled** consent for co-op licensing. Not "analytics and research".
   Consent must be specific; bundling licensing-to-hedge-funds under "analytics" is the
   textbook invalid consent.
2. The **notice must name Percentile** and describe the recipient categories (investors,
   tooling vendors, research/alt-data buyers) — *before* collection.
3. Withdrawal must be as easy as granting, and must actually propagate (§6 — it does not).
4. A statement that aggregates already published are not recalled, matching what
   `/v1/erasure` returns.
5. For any app with EU users, the developer's own Article 30 record must cover the
   disclosure.

**How to make this enforceable rather than aspirational** — the answer is technical, not
contractual:

- Wire the gate to subject-level consent (BLOCKING-1). Then the addendum warranty becomes
  self-enforcing: an app whose users did not consent simply contributes nothing, and the
  developer earns nothing from the revenue share. The incentive and the compliance control
  become the same mechanism.
- **Ship the consent banner.** `docs/08` already lists "give the developer a pre-built
  consent banner" as a mitigation and calls their consent UX "our supply chain". That is
  exactly right and it should be reclassified from a growth tactic to a compliance control.
  A hosted, versioned banner that writes `noticeVersion` into the ledger is the only way to
  know what any given user was actually shown. `ConsentRecord.noticeVersion` already exists
  and the SDK currently defaults it to the string `'v1'` — which will be worthless in a
  dispute.
- Require the developer to attest to the privacy-policy language at enrolment, and store the
  attestation in the ledger.

On the revenue share specifically: paying developers 30% of net does not, on my reading,
create a CCPA financial-incentive problem (§ 1798.125(b)) because the payment runs to the
*developer*, not to the consumer, and the licensed data is aggregate. And it does not
contaminate the "freely given" analysis under Article 7(4) for the same reason — the end
user is not being paid. **But I could not verify this against current guidance** and it is
a genuine open question if you ever pass value through to end users. Do not build an
end-user-facing data dividend without asking counsel first.

---

## 5. EU Data Act and EU AI Act

### Data Act — Regulation (EU) 2023/2854

**Verdict: yes, this creates obligations the design has not modelled, but they are
contractual and mundane rather than existential. Nobody has looked at them, which is the
actual finding.**

In force 11 January 2024, applicable since **12 September 2025**
([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/2854/oj/eng)).

- **Connected products / related services (Chapter II)** — out of scope. Percentile is not a
  physical product and does not attach to one.
- **Chapter VI, "data processing service" (Art. 2(8))** — **likely in scope**. The definition
  covers services enabling on-demand network access to a shared pool of configurable,
  scalable, elastic computing resources, and is explicitly intended to cover IaaS, PaaS
  **and SaaS**. Not every SaaS qualifies, but a multi-tenant analytics backend with an
  ingest API and customer-held data is a poor candidate for arguing it does not
  ([Addleshaw Goddard](https://www.addleshawgoddard.com/en/insights/insights-briefings/2025/data-protection/eu-data-act-gamechanger-saas-contracts/),
  [BCLP](https://www.bclplaw.com/en-US/events-insights-news/the-impact-of-the-eu-data-act-on-data-processing-services-agreements.html)).

  Consequences, with dates:

  | Date | Obligation |
  |---|---|
  | 12 Sep 2025 | Full transparency on all switching and migration costs |
  | 12 Jan 2026 | Switching penalties prohibited; migration charges reduced to strict minimum |
  | **12 Jan 2027** | **Switching charges entirely prohibited, including under existing contracts** |

  SaaS providers are **not** required to deliver "functional equivalence" (that is an IaaS
  obligation under Art. 30(1)) but **are** required to provide open interfaces free of
  charge to customers and to destination providers
  ([Osborne Clarke](https://www.osborneclarke.com/insights/data-act-part-4-data-act-regulates-cloud-switching-and-influences-contractual-relationship)).
  **This is the biggest scoping win available** — the obligation is export plus open API, not
  reproducing the product elsewhere.

  **Article 25 contractual mechanics** are specific and none of them is currently in the
  terms: maximum notice period to initiate a switch **2 months**; mandatory maximum
  transitional period **30 calendar days** after the notice period; where 30 days is
  technically unfeasible, notify the customer within **14 working days**, justify it, and
  propose an alternative not exceeding **7 months**; and the customer may port to another
  provider **or to on-premises infrastructure**.

  The **Article 31 derogation** for custom-built services does not help: it requires both
  that the majority of main features be custom-built for an individual customer **and** that
  the service not be offered at broad commercial scale via a service catalogue. A self-serve
  SDK with a public sign-up fails the second limb outright.

  Practically: Percentile needs a documented, free export path for a workspace's first-party
  data. Right now `/v1/insights` returns a metrics summary and there is no export endpoint
  at all.

- **Article 13, unfair B2B contractual terms** — applies to contracts concluded after
  12 September 2025. A unilaterally imposed term about access to and use of data is not
  binding if it "grossly deviates from good commercial practice" contrary to good faith. The
  co-op addendum is exactly such a term, imposed unilaterally on solo developers with no
  negotiating power. **A term granting Percentile broad rights over customer data with a
  take-it-or-leave-it 30% share is a plausible Article 13 target.** Mitigations: make co-op
  enrolment genuinely optional (it is — `coopEnrolled` defaults false, which helps a lot),
  make withdrawal one click, and make the share rate transparent.
- The Commission published **model contractual terms and cloud SCCs by Recommendation of
  20 November 2025**
  ([BCLP](https://www.bclplaw.com/en-US/events-insights-news/eu-data-act-new-model-contract-terms-and-standard-clauses-to-facilitate-data-sharing-and-cloud-switching.html)).
  Non-binding, but drafting against them is cheap insurance against an Art. 13 challenge.
- **Chapter V (Arts 14–22) B2G access** on exceptional need — low probability, but the
  obligation to be able to respond exists and there is no process for it.

### AI Act — Regulation (EU) 2024/1689

**Verdict: no material obligations for Percentile as it stands. The exposure is
downstream, in what buyers do with the datasets, and in what the SB 361 disclosure will
force you to say about it.**

**Timing note:** the amending regulation — **Regulation (EU) 2026/1744, the "Digital Omnibus
on AI"** — was published in the Official Journal on 24 July 2026 and **enters into force
today, 27 July 2026**, three days after publication, expressly because the application date
it amends falls on 2 August
([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng),
[Lewis Silkin](https://www.lewissilkin.com/insights/2026/07/27/the-digital-omnibus-on-ai-enters-into-force-today-102nedo)).
Anything written about AI Act deadlines before this week is out of date.

- Per the [Commission guidelines of 6 February 2025 on the Article 3(1) definition](https://digital-strategy.ec.europa.eu/en/library/commission-publishes-guidelines-ai-system-definition-facilitate-first-ai-acts-rules-application),
  simple deterministic tools, **basic statistical estimators**, plain data visualisation and
  classical heuristics are excluded from "AI system". A percentile ladder with Laplace noise
  is a basic statistical estimator. Percentile is neither provider nor deployer on the
  current feature set. **This changes if benchmarking moves to ML-based propensity, churn
  prediction or clustering** — then Percentile is the *provider*.
- Timeline as it now stands: **Annex III stand-alone high-risk deferred to 2 December 2027**,
  Annex I embedded high-risk to **2 August 2028**; **GPAI obligations and the 2 August 2026
  enforcement date are untouched** (fines to €15M/3% under Art. 101; general breaches to
  €35M/7% under Art. 99). Article 4 AI literacy was softened from "ensure" to "take measures
  to support", and a new Article 5 prohibition on AI-generated non-consensual intimate
  imagery and CSAM was added
  ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/),
  [Freshfields](https://www.freshfields.com/en/our-thinking/blogs/technology-quotient/eu-ai-act-unpacked-34-the-final-digital-omnibus-on-ai-key-amendments-to-the-a-102nber)).
- **The AI Act regulates AI systems and GPAI models — it does not regulate datasets.**
  Selling training-adjacent data does not make you a provider or deployer, and there is no
  AI Act transparency obligation on dataset sellers. The exposure is **contractual
  flow-down**: buyers who train GPAI models carry Article 53 obligations including a
  sufficiently detailed public summary of training content, so they will demand provenance
  warranties, lawful-basis representations and indemnities. Price that deliberately — and
  note the consent ledger is exactly the artefact that makes it answerable, which is a
  genuine commercial advantage as `docs/04` argues.
- **One trap in Article 6(3).** The filter that lets an Annex III system escape high-risk
  classification where it poses no significant risk is **unavailable to systems that perform
  profiling of natural persons** — those remain high-risk regardless. Cohort profiling is
  the product. This does not bite today because nothing here is an AI system, but it removes
  the escape hatch the moment the ML path in the first bullet is taken. Mitigate with an
  acceptable-use policy prohibiting Annex III deployments (hiring, credit, insurance,
  essential services) by licensees.
- The MCP server (`src/mcp/server.ts`) puts an agent in the loop. If Percentile ever ships
  model-generated recommendations influencing hiring, credit or access decisions, Annex III
  becomes live directly.
- Also relevant: [EDPB Opinion 28/2024 (17 December 2024)](https://www.edpb.europa.eu/system/files/2024-12/edpb_opinion_202428_ai-models_en.pdf)
  holds that an AI model trained on personal data is not automatically anonymous, assessed
  case by case on whether extraction is insignificantly likely and whether queries yield
  identifiable data. If a buyer trains on your cohorts and a regulator works backwards, your
  provenance chain is what protects you.

---

## 6. The consent architecture and ePrivacy Article 5(3)

**Verdict: `product_analytics: 'unknown'` for the EU is the right posture and the code
resolves it correctly. Three other things in the consent path are wrong, and one of them
is the most serious defect in the repository after the missing gate filter.**

### Is 'unknown' correct?

Yes, and for a stronger reason than `docs/04` gives. `ConsentLedger.permittedPurposes`
filters on `state === 'granted'`, so `'unknown'` resolves to *not permitted*, and
`ingest.ts:69` then rejects the event outright. EU traffic without explicit consent is
dropped. That is correct and there is a test for it.

The pan-EU position: **[EDPB Guidelines 2/2023 on the technical scope of Article 5(3)](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf)**,
v2.0 adopted 7 October 2024, confirm Article 5(3) bites on *storage of, or access to,
information on terminal equipment* regardless of whether that information is personal data,
and covers far more than cookies. `localStorage` is squarely in scope.

Member-state divergence is real and does not help:

- **France.** The CNIL's [deliberation of 4 July 2025](https://www.cnil.fr/sites/default/files/2025-07/outil_d_auto-evaluation_mesure_d_audience.pdf),
  applicable from **1 January 2026**, exempts audience-measurement trackers only where they
  are used for a purpose **strictly limited to measuring the audience of that site or app,
  exclusively for the publisher's account**, and **solely to produce anonymised statistical
  data** — and must **not** result in cross-referencing with other processing or transmission
  of non-anonymised data to third parties, and must **not** enable tracking across different
  sites or apps. The public list of approved solutions was withdrawn on 1 January 2026 and
  replaced by a self-assessment grid (5 objectives, 14 criteria)
  ([CNIL](https://www.cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience),
  [analysis](https://www.quantic-avocats.com/2025/10/03/deliberationcnilcookiesaudience/)).

  **Read that against this product.** "Exclusively for the publisher's account" and "no
  cross-referencing with other processing" are precisely what cross-workspace benchmarking
  is. A tracker that feeds the co-op **cannot** claim the CNIL exemption for the same
  collection. If you want an exemption-eligible mode in France it must be a genuinely
  separate, siloed, co-op-excluded configuration, enforced technically and per workspace —
  and since the public list was withdrawn on 1 January 2026, **the burden of proving the
  exemption now sits with Percentile and its customers**, in pre-sales and on audit. That
  is a product decision and a documentation obligation, not a banner tweak.
- **Germany.** TDDDG § 25 requires consent for analytics. The DSK's guidance is that reach
  measurement may be used without consent only where it does **not** rely on external
  third-party services. Percentile is by definition an external third party. **Consent
  required, no exemption available.**
- **Spain / Italy / Denmark.** AEPD operates a narrow CNIL-like exemption; the Garante's
  cookie guidelines have applied since January 2022; Danish cookie consent is a declared
  2026 enforcement priority. None of these is a pan-EU exemption.

**Conclusion:** keep `'unknown'` as the EU default. Do not build any feature that depends on
a consent exemption for first-party analytics — the only jurisdiction where it was
plausible has now written a condition into it that this architecture cannot satisfy.

### Three defects in the consent path

**(a) The SDK stores and transmits before consent exists.** `Percentile`'s constructor calls
`#loadIdentifier()`, which writes a device id to `localStorage` (`browser.ts:103`), then
`#installAutoCapture()` fires `capturePage()` immediately (`browser.ts:114`), and the flush
timer ships the batch. Server-side rejection at `ingest.ts:69` does not cure this: the
Article 5(3) breach is complete at the moment of storage, and the identifier and URL path
have already left the device. This contradicts the SDK's own stated design constraint that
"non-consented events never leave the device at all". The SDK must hold everything in
memory, write nothing to `localStorage`, and transmit nothing until a `granted` state exists
for the resolved jurisdiction.

**(b) Jurisdiction is guessed client-side from the browser timezone.** `detectJurisdiction()`
(`browser.ts:43-54`) maps `Intl.DateTimeFormat().resolvedOptions().timeZone`, and
`ingest.ts:60` trusts `raw.context.jurisdiction` verbatim. A German user on a US VPN, a
European on holiday, or anyone whose timezone reads `America/*` receives the `US` posture —
where `product_analytics` and `benchmark_contribution` both default to **`granted`** with no
consent record at all. EU subjects can therefore be swept into cross-workspace aggregates on
the strength of a client-supplied string. Jurisdiction must be resolved **server-side** from
the IP the ingest tier already sees, and where the client hint and the server determination
disagree, the **stricter** posture must win.

**(c) Withdrawal expires after 30 days, and in the US it fails open.** This is the serious
one. Consent is keyed on `subjectKey`, which is `HMAC(rootSecret, workspace)` over
`identifier|epoch` with `EPOCH_DAYS = 30`. `ConsentLedger.resolve` looks up by `subjectKey`
and, on a miss, returns `DEFAULT_POSTURE[jurisdiction]`. **After an epoch flip, every
subject is a miss.** In the EU that fails closed, which is survivable. Under `US` and
`US-CA` the defaults are `product_analytics: 'granted'` and `benchmark_contribution:
'granted'` — so a Californian who withdrew is silently re-enrolled thirty days later.
`withdrawAll` only writes entries for the keys produced by
`subjectKeysForRetentionWindow`, which walks **backwards** through past epochs; nothing
carries a withdrawal forward.

`docs/04` states "withdrawal is sticky: once withdrawn, only an explicit new grant can
re-enable". That is true within an epoch and false across one. This is the exact failure
mode the Delete Act prices at $200/request/day, and it is also a CCPA opt-out failure.
Withdrawals must be stored against an epoch-independent key.

**(d) GPC is honoured per-request but never persisted.** `optedOutBySignal` (`server.ts:57`)
filters purposes for that request only and writes nothing to the ledger. If the header stops
arriving — a different browser, a proxy stripping it, the SDK failing to read
`navigator.globalPrivacyControl` — co-op inclusion silently resumes. In states where GPC is
a binding opt-out, it must be recorded as a durable consent event, which is what
`ConsentSource` already anticipates with its `'gpc'` value. Write it.

---

## 7. Special-category and children's data: is exclusion-by-policy enough?

**Verdict: no. Not close. There is currently no technical enforcement of either exclusion —
a grep across `src/` returns zero matches for age, child, minor, or special category — and
for special-category data in particular, policy exclusion is not a defence the law
recognises.**

### Special category

**Case C-184/20 (OT v Vyriausioji tarnybinės etikos komisija), 1 August 2022** holds that
data liable **indirectly** to reveal special-category information falls within Article 9;
where an organisation can draw such an inference by an "intellectual operation involving
comparison or deduction", that is processing of special-category data
([Inside Privacy](https://www.insideprivacy.com/eu-data-protection/special-category-data-by-inference-cjeu-significantly-expands-the-scope-of-article-9-gdpr/),
[Ganado](https://ganado.com/insights/publications/cjeu-widens-the-scope-of-sensitive-personal-data-under-the-gdpr/)).
Article 9 is a prohibition subject to exemptions — it does not turn on intent, and "our
policy says we do not accept it" is not one of the Article 9(2) gateways.

Now look at what the SDK actually collects. `#installAutoCapture` tracks `page_view` with
`{ path: location.pathname }` (`browser.ts:112`) from **arbitrary third-party applications**,
and `track()` accepts free-form event names and property bags.
`redaction.ts` blocks property *key names* against `BLOCKED_KEY_PATTERN` and scrubs value
*patterns* (emails, tokens, card numbers) — but nothing stops `/therapy/anxiety-assessment`,
`/clinic/hiv-results`, `/match/same-sex`, or an event named `pregnancy_test_ordered` from
becoming a metric in a cohort. The stated customer base is people who "cannot read the code
they shipped", so assuming disciplined event taxonomy is not a safe assumption — it is the
opposite of the assumption `redaction.ts` is otherwise built on. The module's own opening
comment makes this argument better than I can: *"Our customers did not intend to send that
and cannot be relied on to prevent it."* That reasoning was applied to emails and tokens
and not to health and sexuality.

Combined with EDPB Guidelines 02/2026 requiring an **Article 9(2) exemption for the
anonymisation operation itself** where special categories are involved (§2), this is
blocking for EU co-op releases.

**Minimum technical control:**

- A denylist of sensitive path segments and event-name tokens applied at ingest, with the
  event quarantined from `benchmark_contribution` and `coop_licensing` rather than dropped
  (the developer still gets their own analytics — this preserves Layer 1 utility while
  protecting Layer 3).
- Path tokenisation: retain the route shape, discard high-entropy segments.
- A per-workspace `sensitiveDomain` flag set at onboarding that hard-excludes the workspace
  from the co-op plane.
- Surface quarantines through the existing `redactions` response channel, exactly as
  `dedupeFindings` already does. The mechanism exists; it needs one more rule class.

### Children

`docs/04` says apps directed at under-16s are excluded from the co-op entirely. Nothing
implements this: `RawEvent` and `CleanEvent` carry no age signal, and `WorkspaceProfile` has
no child-directed flag.

The standards differ by regime and none of them is "we had a policy":

- **CCPA § 1798.120(c)** requires **opt-in** for consumers under 16 (parental consent under
  13), triggered by **actual knowledge** — and the CCPA expressly treats wilful disregard of
  a consumer's age as actual knowledge. A vendor that ingests from apps it never screens is
  arguing about wilful disregard, which is a bad argument to have.
- **GDPR Article 8** sets a digital age of consent that member states may fix between 13 and
  16, so there is no single EU threshold to code against.

**Minimum technical control:** a mandatory, attested `childDirected` declaration on
`WorkspaceProfile` at enrolment, defaulting to *unknown*, where anything other than an
explicit "no" excludes the workspace from the co-op. This mirrors the fail-closed posture
already used for jurisdiction and costs almost nothing.

I could not verify the current COPPA amended-rule compliance dates or the member-state
Article 8 age table (see below), and both should be confirmed by counsel before any
child-adjacent app is admitted at all.

---

## Recommended changes

Ordered BLOCKING → IMPORTANT → ADVISORY. "Blocking" means: do not sign a data licence until
this is done.

| # | Priority | Change | File / value |
|---|---|---|---|
| B1 | **BLOCKING** | Gate on the **subject's** `coop_licensing` consent, not the workspace's enrolment flag. Add a consent-derived field to `WorkspaceObservation`; build observations only from events whose `permittedPurposes` include the relevant purpose. Workspace enrolment becomes a necessary, not sufficient, condition | `src/api/server.ts:204`, `src/api/store.ts:52-54`, `src/core/types.ts:120-127` |
| B2 | **BLOCKING** | Make withdrawal epoch-independent. Store withdrawals against a stable per-(workspace, identifier) key so an epoch flip cannot resurrect consent. Today a withdrawn US subject is re-enrolled after 30 days | `src/core/consent.ts:118-130`, `src/core/identity.ts:22` |
| B3 | **BLOCKING** | SDK must write nothing to `localStorage` and transmit nothing before a `granted` state exists. Queue in memory only | `src/sdk/browser.ts:95-108, 110-114` |
| B4 | **BLOCKING** | Resolve jurisdiction **server-side** from IP; where client hint and server determination differ, apply the stricter posture. Stop trusting `raw.context.jurisdiction` | `src/sdk/browser.ts:43-54`, `src/core/ingest.ts:60` |
| B5 | **BLOCKING** | Replace Laplace-on-quantiles with the exponential mechanism, **or** publish only DP means and DP counts and drop the percentile ladder from licensed output | `src/core/privacy/release-gate.ts:119-132` |
| B6 | **BLOCKING** | Persist the ε budget (Postgres, not a `Map`); key it **per cohort per period across all metrics**; reject caller-supplied `period` values outside the current window | `src/core/privacy/differential-privacy.ts:76`, `release-gate.ts:107`, `src/api/server.ts:41,196` |
| B7 | **BLOCKING** | Publish the CCPA § 1798.140(m)(2) **public commitment** not to reidentify, and add § 1798.140(m)(3) **contractual obligations** to the licence template. Both are preconditions for the deidentified/aggregate exemption you are relying on | website + new licence template |
| I1 | IMPORTANT | `MAX_CONTRIBUTOR_SHARE`: **0.34 → 0.15**. Makes the workspace-level sensitivity assumption true rather than wrong by 3× | `src/core/privacy/k-anonymity.ts:28` |
| I2 | IMPORTANT | Noise and ε-charge `contributorCount` and `subjectCount`, or bucket them to the `SizeBucket` ladder. Exact counts are the differencing channel | `src/core/privacy/release-gate.ts:142-143` |
| I3 | IMPORTANT | Persist GPC/DNT as a ledger entry with `source: 'gpc'`, not a per-request filter | `src/api/server.ts:57-59, 88-90` |
| I4 | IMPORTANT | Sensitive-path/event denylist at ingest; quarantine from co-op purposes rather than dropping. Add per-workspace `sensitiveDomain` flag | `src/core/redaction.ts`, `src/api/store.ts:21-28` |
| I5 | IMPORTANT | Mandatory attested `childDirected` field on `WorkspaceProfile`, defaulting to unknown; anything but explicit "no" excludes from the co-op | `src/api/store.ts:21-28` |
| I6 | IMPORTANT | Register with CalPrivacy defensively by the next 31 January window (~$6,000; sources differ, $6,600 also reported). Have counsel draft the narrative so it does not concede the anonymity position | — |
| I9 | IMPORTANT | **Get an Oregon opinion before licensing to or from any Oregon-resident data.** ORS 646A.593 defines "brokered personal data" by the act of organising data for sale or licensing, with no scienter, no threshold and no deidentification carve-out found. The California argument does not transfer | — |
| I10 | IMPORTANT | Calendar the new registries: Vermont Act 138 (1 Jan 2027, $20k bond, $200/day uncapped), Connecticut PA 26-64 (1 Jan 2027), **New Jersey P.L. 2026 c.25 (27 Mar 2027) — which registers first-party data collectors and therefore reaches Layer 1** | — |
| I11 | IMPORTANT | Add Data Act Art. 25 terms: 2-month switching notice cap, 30-day transitional period, 14-working-day unfeasibility notice, right to port on-premises | contract |
| I7 | IMPORTANT | Rewrite the `docs/04` role table: Percentile is **controller of the aggregation step**, not merely "controller of anonymous data". Record the Art. 6 basis for anonymisation per Guidelines 02/2026 | `docs/04-data-governance.md:52` |
| I8 | IMPORTANT | Ship the hosted consent banner as a compliance control, with real `noticeVersion` values written to the ledger. Today the SDK defaults it to `'v1'` | `src/sdk/browser.ts:163` |
| A1 | ADVISORY | Stop hardcoding `{ lo: 0, hi: 1 }` for every metric; carry real domain bounds in a metric registry. Any metric outside [0,1] is currently silently destroyed | `src/api/server.ts:203` |
| A2 | ADVISORY | Add a Data Act export endpoint and switching/exit terms; switching charges are fully prohibited from **12 January 2027** | `src/api/server.ts`, terms |
| A3 | ADVISORY | Draft the co-op addendum against the Commission's 20 November 2025 model contractual terms to reduce Data Act Art. 13 exposure | contract |
| A4 | ADVISORY | Make `PERCENTILE_RETENTION_DAYS` (400) a per-workspace setting — it is the developer's call as controller | `.env.example`, store |
| A5 | ADVISORY | Fund the external re-identification audit `docs/08` already proposes, **after** B5/B6, and publish it. Stakeholders at the EDPB's December 2025 event stressed third-party audits and re-evaluation every 2–3 years | — |
| A6 | ADVISORY | Respond to the Guidelines 02/2026 consultation (open to **30 October 2026**). A consent-first co-op is a sympathetic fact pattern and the contextual approach is exactly what you need upheld | — |

---

## What requires paid outside counsel

Research cannot resolve these. All are cheap relative to the downside.

1. **A written EU anonymisation opinion** against Guidelines 02/2026, on the *fixed*
   pipeline, using the contextual approach — including the Article 6 basis for the
   anonymisation operation itself. `docs/04` calls this "the single highest-value legal
   opinion to buy" and that is right, but the deliverable has changed since it was written:
   it must now address the anonymisation-as-processing point.
2. **The controller/processor characterisation of the aggregation step**, and whether joint
   controllership under Article 26 is the correct construction. This drives the DPA, the
   addendum, and the Article 30 records.
3. **Data-broker analysis in Oregon and Vermont** against the actual output schema — the
   highest-value item on this list after the EU opinion. Neither appears to have a
   deidentification carve-out, and Oregon's definition describes the co-op product almost
   literally. Texas is comparatively safe but conditions its carve-out on a public
   no-reidentification commitment, same as California. Add New Jersey before March 2027,
   because its first-party data-collector registry reaches Layer 1.
4. **The CalPrivacy registration narrative** — how to register defensively without conceding
   the aggregate-only position in a way that is later quoted against you in the EU.
5. **The SB 361 "sold to AI developers" disclosure** — what to say, given the buyer set.
6. **The co-op addendum**, drafted for enforceability against under-capitalised
   counterparties and stress-tested against Data Act Article 13 unfairness.
7. **The licence template**, including CCPA § 1798.140(m)(3) recipient obligations,
   anti-reidentification covenants, and audit rights.
8. **Children's data**: current COPPA amended-rule obligations and the member-state Article 8
   age table, before any child-adjacent app is admitted.
9. **A cryptographer or DP specialist**, not a lawyer, to review B5 and B6. This is the one
   item on the list where counsel is the wrong professional.

---

## What I could not determine

Stated plainly, because a review that hides its gaps is worse than useless.

- **I could not open a single primary source.** This environment's egress proxy returned
  HTTP 403 policy denials for `eur-lex.europa.eu`, `curia.europa.eu`, `edpb.europa.eu`,
  `ec.europa.eu`, `cnil.fr`, `cppa.ca.gov`, `law.cornell.edu` and every other legal host
  attempted. Everything above rests on web-search results and reputable secondary analysis
  (law-firm briefings, IAPP, FPF). **The URLs are real and appeared in live search results,
  but I have not read the underlying documents.** Quoted statutory language should be
  re-verified against the source before anyone relies on it in a filing. This applies most
  acutely to §3, where I have quoted CCPA definitions second-hand.
- **Paragraph-level precision in EDPS v SRB.** I have the holding and one paraphrase of
  paragraph 84 but not the judgment text. The distinction between the Court's transparency
  reasoning and its identifiability reasoning is load-bearing in §2 and should be checked.
- **The content of Guidelines 02/2026 beyond its headline structure.** I have the adoption
  date (7 July 2026), the consultation deadline (30 October 2026), the contextual/simplified
  split, the documentation duty, and the anonymisation-requires-a-legal-basis position. I do
  not have its treatment of k-anonymity, differential privacy, or acceptable ε — which is
  precisely what would settle §1. **Read this document before the counsel engagement.** It
  is the single most important source in this review and it is three weeks old.
- **Whether EDPB Guidelines 01/2025 on pseudonymisation have been finalised.** Adopted for
  consultation 16 January 2025, consultation closed 28 February 2025 — *before* the SRB
  judgment. The EDPB held a stakeholder event on 12 December 2025 and published a report on
  18 February 2026, and both anonymisation and pseudonymisation guidelines sit in the
  2026–2027 work programme. A final pseudonymisation text may have issued; I could not
  confirm.
- **Whether EDPB Guidelines 1/2024 on legitimate interest are final.** Relevant to Route B
  in §2.
- **Oregon's and Vermont's absence of a deidentification carve-out is a *negative* finding
  from search summaries, not a confirmed reading of the statute.** "No carve-out found" is
  not "no carve-out exists". This is the single most important thing on this page to verify
  directly, because it decides whether deidentification works as a compliance strategy
  outside California and Texas. Also unconfirmed: the exact subsection for the California
  deletion-request penalty (§ 1798.99.86(d)(1) vs § 1798.99.82(c)(2)), the registration fee
  ($6,000 vs $6,600), and AB 566's codified Civil Code section.
- **Colorado's registry status** (sources conflict) and any New York budget-bill broker
  provisions.
- **FTC positions on "anonymised" and "aggregated" claims.** Not researched — the search
  budget ran out. Kochava, X-Mode/Outlogic, InMarket, Gravy Analytics/Venntel, Mobilewalla
  and the FTC's business-blog posts on the limits of hashing are all real matters that bear
  directly on marketing an unsound DP guarantee (§1), and **none of it is covered in this
  review**. Someone should run it before any buyer-facing claim about differential privacy
  is published. The material sits at `ftc.gov/business-guidance/blog` and
  `ftc.gov/legal-library/browse/cases-proceedings`; Kochava is litigated rather than settled,
  so its status needs the docket.
- **COPPA amended rule compliance dates and the third-party-disclosure consent change**, and
  the **member-state Article 8 age table**. Search budget ran out before these; treat §7's
  children analysis as directionally right but unverified on dates.
- **CCPA financial-incentive rules (§ 1798.125(b)) applied to the 30% share**, and EDPB
  Opinion 08/2024 on "consent or pay" as it bears on Article 7(4). My reading in §4 is that
  neither bites because the payment runs to the developer, but this is reasoning, not a
  verified source.
- **Whether any regulator has accepted or rejected a specific k value.** I found no published
  threshold from any EU DPA. I believe none exists; I cannot prove a negative.
- **Whether the aggregation pipeline that produces `WorkspaceObservation` records exists at
  all.** Nothing in `src/` writes them except `MemoryStore.putObservation`, which is only
  called from tests. The consent-filtering defect (B1) may therefore be a gap in unwritten
  code rather than a bug in written code — which makes it cheaper to fix and no less
  blocking.

---

## One thing worth saying plainly

The instinct in `docs/04` — that the naive version of this business is unbuildable and that
the privacy architecture has to *be* the business architecture — is correct, and it is the
reason this review has a path to "yes" rather than "no". The release gate as a single
auditable choke point is a genuinely good decision that made this review possible in a day.
Per-workspace pseudonym keying is a real moat.

The problem is that the document describes a system nobody has finished building, and it
describes it in the present tense. The gap between "only observations with `coop_licensing`
consent" and `(o) => store.hasCoopConsent(o.workspaceId)` is the entire compliance argument.
Fix that one line and most of this review becomes maintenance.

Do not sell a Layer 3 licence before B1–B7 are done. The asset is worth more later; the
liability is unbounded now.
