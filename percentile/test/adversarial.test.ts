/**
 * Adversarial / red-team suite for the release gate.
 *
 * Every test here is written from the position of an attacker who has bought the dataset
 * (or enrolled in the co-op) and is trying to read an individual app's or an individual
 * person's private data back out of it.
 *
 * READ THIS BEFORE EDITING:
 *
 *   Tests named `VULN-n` PASS BECAUSE THE ATTACK WORKS. A green run of this file is not
 *   a clean bill of health — it is a reproduction of every confirmed leak. If one of them
 *   starts failing, the corresponding hole has probably been fixed; delete the test and
 *   record the fix, do not "repair" it.
 *
 *   Tests named `HOLDS-n` are ordinary regression guards: the defence works and must keep
 *   working.
 *
 * Findings are written up in docs/11-privacy-audit.md.
 *
 * Statistical tests use enough trials that the assertion margin is many standard errors
 * wide; none of them depend on a lucky draw.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gateRelease, cohortKeyString, type MetricSpec } from '../src/core/privacy/release-gate.ts';
import { PrivacyBudget } from '../src/core/privacy/differential-privacy.ts';
import { checkKAnonymity, explainSuppression } from '../src/core/privacy/k-anonymity.ts';
import { ConsentLedger } from '../src/core/consent.ts';
import { ingest } from '../src/core/ingest.ts';
import { redactProperties } from '../src/core/redaction.ts';
import {
  deriveSubjectKey,
  epochFor,
  EPOCH_DAYS,
  subjectKeysForRetentionWindow,
} from '../src/core/identity.ts';
import { MemoryStore } from '../src/api/store.ts';
import { coarsen, matchesCohort } from '../src/core/aggregate/rollup.ts';
import type { AggregateRelease, CohortKey, RawEvent, WorkspaceObservation } from '../src/core/types.ts';

const COHORT: CohortKey = {
  builder: 'lovable',
  vertical: 'b2b_saas',
  sizeBucket: '1k-10k',
  period: '2026-W30',
};

const METRIC: MetricSpec = { name: 'activation_rate', lo: 0, hi: 1 };

const SECRET = { rootSecret: 'r'.repeat(48) };

function obs(
  workspaceId: string,
  value: number,
  subjectCount = 5,
  cohort: CohortKey = COHORT,
): WorkspaceObservation {
  return { workspaceId, cohort, metric: METRIC.name, value, subjectCount };
}

/** Run the gate and insist it released, so attack code stays readable. */
function mustRelease(
  observations: readonly WorkspaceObservation[],
  cohort: CohortKey = COHORT,
  metric: MetricSpec = METRIC,
  budget: PrivacyBudget = new PrivacyBudget(),
): AggregateRelease {
  const out = gateRelease(cohort, metric, observations, () => true, 'ledger-head', { budget });
  if (!out.released) throw new Error(`expected release, gate refused: ${out.reason}`);
  return out.release;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------------------------------------------------------------------------
// VULN-1 — quantile sensitivity is understated by a factor of n.
// ---------------------------------------------------------------------------

describe('VULN-1: the noise scale is computed for a mean and applied to quantiles', () => {
  /**
   * release-gate.ts:120 sets `sensitivity = (hi - lo) / contributorCount` and uses that
   * single number for all five percentiles as well as the mean.
   *
   * That is the correct global sensitivity for a *mean* over n bounded contributions. It is
   * flatly wrong for a *quantile*: changing one contributor's value can move an order
   * statistic by the whole gap to its neighbour, which is up to (hi - lo) and does NOT
   * shrink with n. So the true sensitivity of p10 here is ~1.0 while the declared
   * sensitivity is 1/1000 = 0.001.
   *
   * The perverse consequence: because the declared sensitivity shrinks as 1/n, LARGER
   * cohorts get LESS noise while the real quantile sensitivity stays constant. Privacy gets
   * monotonically worse as the cohort grows — the exact opposite of the design intent.
   *
   * Below: a 1000-workspace cohort that clears every k-anonymity check by a wide margin.
   * One single workspace changes its value from 1 to 0. The published p10 moves from ~0.9
   * to ~0.0 and an attacker classifies which world they are in with ~100% accuracy from a
   * SINGLE release. This is a total failure of differential privacy, not a degradation.
   */
  const N = 1000;

  function stepCohort(lowCount: number): WorkspaceObservation[] {
    return Array.from({ length: N }, (_, i) => obs(`w${i}`, i < lowCount ? 0 : 1, 5));
  }

  test('precondition: both worlds clear every k-anonymity threshold comfortably', () => {
    for (const zeros of [100, 101]) {
      const verdict = checkKAnonymity(stepCohort(zeros));
      assert.equal(verdict.ok, true);
      assert.equal(verdict.ok === true && verdict.contributorCount, 1000);
      assert.equal(verdict.ok === true && verdict.subjectCount, 5000);
    }
  });

  test('VULN: one workspace flipping its value is readable from a single published p10', () => {
    const TRIALS = 60;
    // Decision rule an attacker would use: p10 above 0.45 => the flipping workspace is high.
    let correct = 0;
    for (let i = 0; i < TRIALS; i++) {
      if (mustRelease(stepCohort(100)).percentiles.p10 > 0.45) correct++;
      if (mustRelease(stepCohort(101)).percentiles.p10 <= 0.45) correct++;
    }
    const accuracy = correct / (TRIALS * 2);

    // A mechanism honouring epsilon = 0.1/6 per statistic would cap the attacker's
    // advantage at roughly exp(0.017) - 1, i.e. accuracy indistinguishable from 0.5.
    assert.ok(
      accuracy > 0.9,
      `attacker accuracy ${accuracy}; >0.9 is evidence the DP guarantee does not hold`,
    );
  });

  test('VULN: the two worlds are separated far beyond the claimed noise scale', () => {
    const high = mean(Array.from({ length: 40 }, () => mustRelease(stepCohort(100)).percentiles.p10));
    const low = mean(Array.from({ length: 40 }, () => mustRelease(stepCohort(101)).percentiles.p10));
    // Declared noise scale b = sensitivity/(eps/6) = 0.001/(0.1/6) = 0.06.
    assert.ok(
      high - low > 0.5,
      `single-workspace change moved published p10 by ${(high - low).toFixed(3)} ` +
        `against a declared noise scale of 0.06`,
    );
  });
});

// ---------------------------------------------------------------------------
// VULN-2 — sybil cohort: manufacture the population, read out the one honest member.
// ---------------------------------------------------------------------------

describe('VULN-2: a sybil cohort recovers an honest contributor\'s exact metric', () => {
  /**
   * k-anonymity counts *workspaces*, not *parties*. Registering 999 workspaces is a
   * business-rules problem, not a cryptographic one, and nothing in the gate models
   * collusion. The dominance check counts subjects per workspace, so 999 sybils with one
   * subject each look like the healthiest cohort in the dataset.
   *
   * The attacker picks sybil values so that the victim sits exactly at the p50 index:
   * 499 sybils at lo, 500 sybils at hi. Then
   *      p50 = victim + (hi - victim) * 0.5   =>   victim = 2 * p50 - 1
   * and the noise scale is only 0.06 because there are 1000 "contributors".
   *
   * Combine with VULN-3 (the budget key is attacker-controlled) to average the noise away.
   */
  function sybilProbe(victimValue: number): number {
    const list: WorkspaceObservation[] = [];
    for (let i = 0; i < 499; i++) list.push(obs(`sybil_lo_${i}`, 0, 5));
    list.push(obs('victim', victimValue, 5));
    for (let i = 0; i < 500; i++) list.push(obs(`sybil_hi_${i}`, 1, 5));
    return mustRelease(list).percentiles.p50;
  }

  test('precondition: the sybil cohort passes k, subjects and dominance', () => {
    const list: WorkspaceObservation[] = [];
    for (let i = 0; i < 499; i++) list.push(obs(`sybil_lo_${i}`, 0, 5));
    list.push(obs('victim', 0.4, 5));
    for (let i = 0; i < 500; i++) list.push(obs(`sybil_hi_${i}`, 1, 5));
    const verdict = checkKAnonymity(list);
    assert.equal(verdict.ok, true, 'the gate sees a textbook-healthy 1000-app cohort');
  });

  test('VULN: 60 differently-keyed queries recover the victim value to ~2pp', () => {
    const TRUE_VALUE = 0.4;
    const estimate = 2 * mean(Array.from({ length: 60 }, () => sybilProbe(TRUE_VALUE))) - 1;
    const error = Math.abs(estimate - TRUE_VALUE);

    // Measured over 25 independent runs of this attack: median |error| 0.022, max 0.043.
    assert.ok(
      error < 0.12,
      `recovered a single competitor's private metric as ${estimate.toFixed(3)} ` +
        `(true ${TRUE_VALUE}), error ${error.toFixed(3)}`,
    );
  });

  test('VULN: the estimator tracks the victim across the whole domain', () => {
    // If this were noise, the estimates would not be ordered. They are.
    const estimates = [0.1, 0.4, 0.8].map(
      (v) => 2 * mean(Array.from({ length: 30 }, () => sybilProbe(v))) - 1,
    );
    assert.ok(
      estimates[0]! < estimates[1]! && estimates[1]! < estimates[2]!,
      `estimates ${estimates.map((e) => e.toFixed(3)).join(', ')} track the victim monotonically`,
    );
  });
});

// ---------------------------------------------------------------------------
// VULN-3 — the epsilon budget is keyed on attacker-supplied metadata.
// ---------------------------------------------------------------------------

describe('VULN-3: the privacy budget key is metadata, not population', () => {
  /**
   * release-gate.ts:107 —  budgetKey = `${cohortKeyString(cohort)}::${metric.name}`.
   *
   * `cohort` and `observations` are two independent parameters. Nothing checks that the
   * cohort key describes the population it is handed. The `period` component is a free
   * string (and in src/api/server.ts it comes straight off `?period=` in the query string),
   * and `metric.name` is a free string too.
   *
   * So an unlimited number of fresh epsilon budgets exist over one population, and every
   * one of them answers with independent noise on the same underlying values.
   */
  const population = Array.from({ length: 1000 }, (_, i) => obs(`w${i}`, i / 1000, 5));

  test('VULN: 50 releases of one population out of a budget that permits 10', () => {
    const budget = new PrivacyBudget(); // 1.0 total, 0.1 per query => 10 releases
    let released = 0;
    for (let i = 0; i < 50; i++) {
      const out = gateRelease(
        { ...COHORT, period: `2026-W30-variant-${i}` },
        METRIC,
        population,
        () => true,
        'head',
        { budget },
      );
      if (out.released) released++;
    }
    assert.equal(released, 50, 'every re-keyed query got a fresh 1.0 budget');
  });

  test('VULN: renaming the metric alone mints a fresh budget for the same statistic', () => {
    const budget = new PrivacyBudget();
    let released = 0;
    for (let i = 0; i < 50; i++) {
      const out = gateRelease(
        COHORT,
        { name: `activation_rate ${' '.repeat(i)}`, lo: 0, hi: 1 },
        population,
        () => true,
        'head',
        { budget },
      );
      if (out.released) released++;
    }
    assert.equal(released, 50, 'whitespace in a metric name buys another 1.0 of epsilon');
  });

  test('VULN: budget keys collide only on exact string equality, so cohorts never compose', () => {
    // Two cohort keys describing overlapping populations are simply different strings.
    const a = cohortKeyString(COHORT);
    const b = cohortKeyString({ ...COHORT, sizeBucket: '10k-100k' });
    assert.notEqual(a, b);
    const budget = new PrivacyBudget();
    assert.equal(budget.trySpend(`${a}::m`, 1.0), true);
    assert.equal(
      budget.trySpend(`${b}::m`, 1.0),
      true,
      'a coarser or adjacent bucket over the same apps carries a completely separate budget',
    );
  });
});

// ---------------------------------------------------------------------------
// VULN-3b — the coarsening ladder multiplies the budget over nested populations.
// ---------------------------------------------------------------------------

describe('VULN-3b: every rung of the coarsening ladder gets its own full epsilon', () => {
  /**
   * `coarsen()` in src/core/aggregate/rollup.ts produces four strictly nested cohorts:
   * exact ⊂ all_builders ⊂ all_builders_all_sizes ⊂ all_ai_built_apps. Every rung is a
   * distinct `cohortKeyString`, and rollup.ts documents that as deliberate:
   *
   *     "two rungs sharing a key would let a broad query drain a narrow cohort's budget"
   *
   * That reasoning is inverted. The workspaces in the narrow rung are members of all four
   * populations, so they are exposed to 4 x 1.0 = 4.0 of epsilon while the accounting
   * reports 1.0 per cohort. Under sequential composition, epsilon over a *person* is what
   * matters, and no ledger in this codebase tracks it.
   *
   * The rungs are also perfectly nested, which makes them an ideal differencing lattice:
   * with the exact counts of VULN-6, subtracting adjacent rungs yields the exact subject
   * count of each set difference for free.
   */
  const period = '2026-W30';
  const target: CohortKey = { builder: 'lovable', vertical: 'b2b_saas', sizeBucket: '1k-10k', period };

  const inCohort = (c: CohortKey, prefix: string, n: number, subjects: number) =>
    Array.from({ length: n }, (_, i) => obs(`${prefix}${i}`, 0.2 + (i % 20) * 0.03, subjects, c));

  const world: WorkspaceObservation[] = [
    ...inCohort(target, 'core_', 40, 40),
    ...inCohort({ ...target, builder: 'bolt' }, 'ob_', 40, 25),
    ...inCohort({ ...target, builder: 'v0', sizeBucket: '100-1k' }, 'os_', 40, 30),
    ...inCohort({ ...target, vertical: 'marketplace', sizeBucket: '10k-100k' }, 'ov_', 40, 35),
  ];

  test('precondition: the four rungs are strictly nested populations', () => {
    const rungs = coarsen(target);
    assert.equal(rungs.length, 4);
    const sizes = rungs.map((r) => world.filter((o) => matchesCohort(o.cohort, r)).length);
    assert.deepEqual(sizes, [40, 80, 120, 160], 'each rung strictly contains the previous one');
    // Distinct budget keys is exactly what makes the attack work.
    assert.equal(new Set(rungs.map((r) => cohortKeyString(r.cohort))).size, 4);
  });

  test('VULN: one population absorbs 4.0 of epsilon while every ledger reads 1.0', () => {
    const budget = new PrivacyBudget();
    const rungs = coarsen(target);
    let released = 0;
    for (const rung of rungs) {
      const members = world.filter((o) => matchesCohort(o.cohort, rung));
      for (let q = 0; q < 10; q++) {
        const out = gateRelease(rung.cohort, METRIC, members, () => true, 'head', { budget });
        if (out.released) released++;
      }
    }
    assert.equal(released, 40, '40 noisy answers, all of them containing the same 40 core apps');
    for (const rung of rungs) {
      const key = `${cohortKeyString(rung.cohort)}::${METRIC.name}`;
      assert.ok(budget.remaining(key) < 1e-9, `rung ${rung.breadth} drained a full 1.0 budget`);
    }
  });

  test('VULN: adjacent rungs difference to the exact subject count of the ring between them', () => {
    const rungs = coarsen(target);
    const counts = rungs.map((rung) => {
      const members = world.filter((o) => matchesCohort(o.cohort, rung));
      return mustRelease(members, rung.cohort).subjectCount;
    });
    assert.deepEqual(counts, [1600, 2600, 3800, 5200]);
    // 40 bolt-built apps x 25 subjects, recovered exactly and for free.
    assert.equal(counts[1]! - counts[0]!, 1000);
    assert.equal(counts[2]! - counts[1]!, 1200);
    assert.equal(counts[3]! - counts[2]!, 1400);
  });
});

// ---------------------------------------------------------------------------
// VULN-4 — row stuffing defeats the dominance check.
// ---------------------------------------------------------------------------

describe('VULN-4: dominance is measured in subjects, influence is measured in rows', () => {
  /**
   * checkKAnonymity sums `subjectCount` per workspace and caps any workspace at 34% of
   * subjects. But release-gate.ts:119 builds the distribution from *observations*, one
   * value per row, unweighted. A workspace that submits 600 rows of one subject each holds
   * 10.7% of the subjects (passes dominance) and 37.5% of the rows (owns the median).
   *
   * MemoryStore.putObservation appends without any per-workspace deduplication or cap, so
   * nothing anywhere limits how many rows one workspace contributes to a cohort.
   *
   * Read the other way round, this is also the *victim* side of VULN-2: an attacker who
   * can induce a target to report per-segment or per-day observations amplifies that
   * target's weight in the ladder while the dominance check reports a healthy mix.
   */
  const STUFFER_VALUE = 0.62;

  function stuffed(): WorkspaceObservation[] {
    const list: WorkspaceObservation[] = [];
    for (let i = 0; i < 600; i++) list.push(obs('stuffer', STUFFER_VALUE, 1));
    for (let i = 0; i < 999; i++) list.push(obs(`w${i}`, i / 999, 5));
    return list;
  }

  test('precondition: the stuffed cohort reports as healthy', () => {
    const verdict = checkKAnonymity(stuffed());
    assert.equal(verdict.ok, true);
    assert.equal(verdict.ok === true && verdict.contributorCount, 1000);
    // 600 / 5595 = 10.7%, well inside the 34% dominance cap.
    assert.ok(verdict.ok === true && 600 / verdict.subjectCount < 0.34);
  });

  test('VULN: the published median is one workspace\'s private value', () => {
    const p50 = mean(Array.from({ length: 80 }, () => mustRelease(stuffed()).percentiles.p50));
    assert.ok(
      Math.abs(p50 - STUFFER_VALUE) < 0.15,
      `published p50 ${p50.toFixed(3)} is the stuffing workspace's own value ${STUFFER_VALUE}, ` +
        `republished as a 1000-app industry benchmark`,
    );
  });
});

// ---------------------------------------------------------------------------
// VULN-5 — the suppression path is a free, exact, unbudgeted oracle.
// ---------------------------------------------------------------------------

describe('VULN-5: refusals leak exact counts and cost zero epsilon', () => {
  /**
   * Gate order is k-anonymity (step 2) then budget (step 3), so a refusal never touches the
   * budget. And the refusal carries exact numbers: `verdict.contributorCount`,
   * `verdict.subjectCount` and `shortfall`, plus `explainSuppression()` renders the
   * shortfall into prose that src/api/server.ts returns to the caller verbatim.
   *
   * Net effect: the sub-k region of the dataset — the region k-anonymity exists to protect
   * — answers unlimited exact queries for free, while the super-k region answers ten noisy
   * ones. The gate is strictly more informative below threshold than above it.
   */
  test('VULN: a refusal reveals a single rival workspace\'s exact subject count', () => {
    const out = gateRelease(COHORT, METRIC, [obs('rival', 0.5, 137)], () => true, 'head', {
      budget: new PrivacyBudget(),
    });
    assert.equal(out.released, false);
    if (out.released) return;
    assert.equal(out.verdict?.subjectCount, 137, 'exact, unnoised subject count of one app');
    assert.equal(out.verdict?.contributorCount, 1);
  });

  test('VULN: the human-readable explanation alone recovers the exact subject count', () => {
    const many = Array.from({ length: 12 }, (_, i) => obs(`w${i}`, 0.3, 0));
    many.push(obs('target', 0.3, 361));
    const out = gateRelease(COHORT, METRIC, many, () => true, 'head', {
      budget: new PrivacyBudget(),
    });
    assert.equal(out.released, false);
    if (out.released) return;
    const shortfall = Number(/needs (\d+) more/.exec(out.explanation)?.[1]);
    // MIN_SUBJECTS is public (k-anonymity.ts:22), so subjectCount = 500 - shortfall.
    assert.equal(500 - shortfall, 361, 'the in-product prose is an exact count disclosure');
  });

  test('VULN: the dominance shortfall discloses the largest contributor\'s subject count', () => {
    const list = [
      ...Array.from({ length: 9 }, (_, i) => obs(`w${i}`, 0.3, 60)),
      obs('whale', 0.5, 900),
    ];
    const out = gateRelease(COHORT, METRIC, list, () => true, 'head', {
      budget: new PrivacyBudget(),
    });
    assert.equal(out.released, false);
    if (out.released) return;
    const v = out.verdict!;
    assert.equal(v.ok, false);
    if (v.ok) return;
    // shortfall = ceil(largest / 0.34) - subjectCount, and 0.34 is a published constant.
    const recovered = Math.round((v.shortfall + v.subjectCount) * 0.34);
    assert.ok(
      Math.abs(recovered - 900) <= 2,
      `recovered the dominant app's subject count as ~${recovered} (true 900)`,
    );
    assert.ok(explainSuppression(v)!.length > 0);
  });

  test('VULN: an unlimited number of sub-k probes spends no budget at all', () => {
    const budget = new PrivacyBudget();
    const key = `${cohortKeyString(COHORT)}::${METRIC.name}`;
    for (let i = 0; i < 200; i++) {
      gateRelease(COHORT, METRIC, [obs('rival', 0.5, 137 + i)], () => true, 'head', { budget });
    }
    assert.equal(budget.spent(key), 0, '200 exact disclosures for epsilon = 0');
    assert.equal(budget.remaining(key), 1.0);
  });
});

// ---------------------------------------------------------------------------
// VULN-6 — contributorCount and subjectCount are published exactly.
// ---------------------------------------------------------------------------

describe('VULN-6: released counts carry no noise and no budget', () => {
  /**
   * AggregateRelease publishes `contributorCount` and `subjectCount` as exact integers.
   * differential-privacy.ts exports `noisyCount()` for precisely this job — and nothing in
   * the repository calls it. Grep for it: zero call sites.
   *
   * Because these counts are exact, ordinary set differencing works: any two releases whose
   * populations differ by one workspace disclose that workspace's exact subject count. And
   * VULN-3 means an attacker can always obtain both releases.
   */
  test('VULN: differencing two releases yields one workspace\'s exact subject count', () => {
    const base = Array.from({ length: 40 }, (_, i) => obs(`w${i}`, 0.3 + i * 0.01, 40));
    const withRival = [...base, obs('rival', 0.55, 317)];

    const before = mustRelease(base);
    const after = mustRelease(withRival, { ...COHORT, period: '2026-W31' });

    assert.equal(after.subjectCount - before.subjectCount, 317, 'exact, to the person');
    assert.equal(after.contributorCount - before.contributorCount, 1);
  });

  test('VULN: the counts are byte-identical across repeated releases (no noise at all)', () => {
    const population = Array.from({ length: 40 }, (_, i) => obs(`w${i}`, 0.3 + i * 0.01, 40));
    const counts = new Set(
      Array.from({ length: 20 }, (_, i) =>
        mustRelease(population, { ...COHORT, period: `p${i}` }).subjectCount,
      ),
    );
    assert.equal(counts.size, 1, 'a noised count would vary; this one never does');
  });
});

// ---------------------------------------------------------------------------
// VULN-7 — the provenance stamp certifies nothing about the data.
// ---------------------------------------------------------------------------

describe('VULN-7: the provenance hash does not commit to the released numbers', () => {
  /**
   * release-gate.ts:155 hashes [ledgerHead, cohortKey, metricName, contributorCount,
   * subjectCount, epsilon]. It does not hash the percentiles, the mean, the observation
   * set, the consent predicate that was used, or the thresholds that were applied.
   *
   * So the stamp proves only that *some* release with these counts was made against a
   * ledger head. It cannot detect altered numbers, a fabricated distribution, a weakened
   * k threshold (VULN-8), or a release built from non-consented rows. A buyer's compliance
   * team verifying this hash is verifying a tautology.
   */
  test('VULN: two releases with completely different numbers share one provenance hash', () => {
    // 1000 contributors keeps the noise scale at 0.06 so the two distributions stay
    // visibly different; the point of the test is that the stamps do not.
    const low = Array.from({ length: 1000 }, (_, i) => obs(`w${i}`, 0.02, 100));
    const high = Array.from({ length: 1000 }, (_, i) => obs(`w${i}`, 0.98, 100));

    const a = mustRelease(low);
    const b = mustRelease(high, COHORT, METRIC, new PrivacyBudget());

    assert.equal(
      a.provenanceHash,
      b.provenanceHash,
      'identical stamp for opposite distributions — the hash binds metadata only',
    );
    assert.ok(Math.abs(a.percentiles.p50 - b.percentiles.p50) > 0.2);
  });

  test('VULN: a tampered release still verifies against its own stamp', () => {
    const release = mustRelease(Array.from({ length: 20 }, (_, i) => obs(`w${i}`, 0.2, 100)));
    const stamp = release.provenanceHash;
    // A reseller marks the cohort up to make their client look worse than the market.
    release.percentiles.p50 = 0.99;
    release.mean = 0.99;
    assert.equal(release.provenanceHash, stamp, 'nothing about the stamp detects this');
  });
});

// ---------------------------------------------------------------------------
// VULN-8 — the k thresholds are caller-supplied with no floor.
// ---------------------------------------------------------------------------

describe('VULN-8: gateRelease accepts weaker-than-policy thresholds without complaint', () => {
  /**
   * ReleaseGateOptions exposes minContributors, minSubjects and maxContributorShare as
   * optional overrides with `?? MIN_CONTRIBUTORS` style defaults and no lower bound. The
   * file header claims "any future 'just this once' bypass has to be written as an obvious
   * exception" — but the bypass already exists as a documented, type-checked option object.
   *
   * The release that comes back is structurally indistinguishable from a compliant one and
   * its provenance hash (VULN-7) records nothing about which thresholds were applied.
   */
  test('VULN: a single workspace with three subjects is released on request', () => {
    const out = gateRelease(COHORT, METRIC, [obs('solo', 0.37, 3)], () => true, 'head', {
      budget: new PrivacyBudget(),
      minContributors: 1,
      minSubjects: 1,
      maxContributorShare: 1,
      epsilonPerQuery: 1.0,
    });
    assert.equal(out.released, true, 'k=1 release: one app, three people, no suppression');
    if (!out.released) return;
    assert.equal(out.release.contributorCount, 1);
    assert.equal(out.release.subjectCount, 3);
    assert.equal(out.release.provenanceHash.length, 64, 'and it carries a full provenance stamp');
  });

  test('HOLDS: the budget still caps a single query at the cohort budget', () => {
    // A caller cannot buy arbitrarily low noise: trySpend refuses epsilon > remaining.
    const budget = new PrivacyBudget();
    const out = gateRelease(COHORT, METRIC, [obs('solo', 0.37, 3)], () => true, 'head', {
      budget,
      minContributors: 1,
      minSubjects: 1,
      maxContributorShare: 1,
      epsilonPerQuery: 25,
    });
    assert.equal(out.released, false);
    assert.equal(out.released === false && out.reason, 'privacy_budget_exhausted');
  });
});

// ---------------------------------------------------------------------------
// VULN-9 — post-hoc sort() manufactures dispersion that is not in the data.
// ---------------------------------------------------------------------------

describe('VULN-9: the re-sorted ladder is a biased estimator', () => {
  /**
   * release-gate.ts:132 noises the five percentiles independently and then `.sort()`s them
   * so the ladder reads monotonically. Sorting is legitimate DP post-processing — it leaks
   * nothing extra — but it is not free: it turns the reported p10 into the MINIMUM of five
   * noisy draws and the reported p90 into the MAXIMUM.
   *
   * On a tight cohort where the true ladder is nearly flat, the published ladder is pure
   * order statistics of the noise. Buyers read that as market dispersion. It is not a
   * privacy leak; it is a correctness and misrepresentation problem, and it means the
   * ladder cannot be used to reason about the cohort at all.
   */
  test('VULN: a cohort with zero dispersion is published with a wide spread', () => {
    const flat = Array.from({ length: 200 }, (_, i) => obs(`w${i}`, 0.5, 5)); // every value 0.5
    const runs = Array.from({ length: 150 }, () => mustRelease(flat).percentiles);
    const p10 = mean(runs.map((r) => r.p10));
    const p90 = mean(runs.map((r) => r.p90));

    assert.ok(
      p90 - p10 > 0.3,
      `true p90 - p10 is exactly 0; published spread is ${(p90 - p10).toFixed(3)}`,
    );
    assert.ok(p10 < 0.4, `p10 biased down to ${p10.toFixed(3)}`);
    assert.ok(p90 > 0.6, `p90 biased up to ${p90.toFixed(3)}`);
  });

  test('VULN: at the minimum legal cohort size the output is mostly clamped to the bounds', () => {
    // 10 contributors => sensitivity 0.1, epsilon/6 = 0.0167 => Laplace scale b = 6.0
    // on a [0, 1] domain. Almost every draw leaves the domain and is clamped.
    const minimal = Array.from({ length: 10 }, (_, i) => obs(`w${i}`, 0.4, 50));
    const draws = Array.from({ length: 300 }, () => mustRelease(minimal).percentiles.p50);
    const atBound = draws.filter((v) => v === 0 || v === 1).length / draws.length;
    assert.ok(
      atBound > 0.5,
      `${(atBound * 100).toFixed(0)}% of published medians are exactly 0 or 1 — ` +
        `at k = 10 the released statistic carries essentially no signal`,
    );

    // Sharper: a cohort whose true median is 0.05 still publishes a median above 0.9 on a
    // large fraction of queries. Theory: P(clamp to hi) = 0.5 * exp(-0.95 / 6) = 0.427.
    const lowTruth = Array.from({ length: 10 }, (_, i) => obs(`w${i}`, 0.05, 50));
    const lowDraws = Array.from({ length: 300 }, () => mustRelease(lowTruth).percentiles.p50);
    const wildlyHigh = lowDraws.filter((v) => v >= 0.9).length / lowDraws.length;
    assert.ok(
      wildlyHigh > 0.25,
      `true median 0.05, but ${(wildlyHigh * 100).toFixed(0)}% of releases report >= 0.9`,
    );
  });
});

// ---------------------------------------------------------------------------
// VULN-10 — the wired consent predicate never consults the consent ledger.
// ---------------------------------------------------------------------------

describe('VULN-10: co-op release ignores per-subject consent entirely', () => {
  /**
   * The gate's consent filter is correct and is proved correct in HOLDS-1 below. The
   * problem is the predicate the one production caller passes it.
   *
   * src/api/server.ts:204 —  (o) => store.hasCoopConsent(o.workspaceId)
   * src/api/store.ts:52    —  returns profile.coopEnrolled
   *
   * That is a per-WORKSPACE boolean set by the developer. It never reads the ConsentLedger,
   * so the entire three-tier purpose model (product_analytics / benchmark_contribution /
   * coop_licensing), sticky withdrawal, the jurisdiction defaults and the GPC/DNT handling
   * in the /v1/events path all have zero effect on what is licensed to third parties.
   *
   * docs/04-data-governance.md, "Decision 3", describes a control that is not wired up.
   */
  test('VULN: a subject who explicitly withdrew is still co-op eligible', () => {
    const ledger = new ConsentLedger();
    const store = new MemoryStore();
    store.upsertProfile({
      workspaceId: 'ws1',
      builder: 'lovable',
      vertical: 'b2b_saas',
      sizeBucket: '1k-10k',
      coopEnrolled: true,
    });

    const subject = deriveSubjectKey(SECRET, 'ws1', 'alice', '2026-07-15T00:00:00Z');
    ledger.withdrawAll('ws1', subject, 'EU', '2026-07-16T00:00:00Z');

    assert.equal(ledger.resolve('ws1', subject, 'coop_licensing', 'EU'), 'withdrawn');
    assert.equal(
      store.hasCoopConsent('ws1'),
      true,
      'the release-gate predicate says yes for a subject who said no',
    );
  });

  test('VULN: observations carry no consent state for the gate to filter on', () => {
    // WorkspaceObservation has no subject list and no purpose field, so even a corrected
    // predicate has nothing subject-level to filter. The leak is structural, not a typo.
    const o = obs('ws1', 0.4, 500);
    assert.deepEqual(Object.keys(o).sort(), [
      'cohort',
      'metric',
      'subjectCount',
      'value',
      'workspaceId',
    ]);
  });
});

// ---------------------------------------------------------------------------
// VULN-11 — jurisdiction is self-declared by the client.
// ---------------------------------------------------------------------------

describe('VULN-11: the strict EU posture is opt-out by string', () => {
  /**
   * ingest.ts:60 —  const jurisdiction = raw.context?.jurisdiction || 'unknown';
   *
   * That value comes from the SDK payload. `ipToCountry` exists in redaction.ts and the IP
   * is present on the same request, but nothing cross-checks them. A workspace that labels
   * its EU traffic 'US' converts the fail-closed EU posture (analytics unknown, benchmark
   * denied) into US defaults (analytics granted, benchmark granted) for free.
   */
  const raw = (jurisdiction: string): RawEvent => ({
    workspaceId: 'ws1',
    eventId: `e_${jurisdiction}`,
    name: 'signup_completed',
    occurredAt: '2026-07-15T10:00:00Z',
    identifier: 'alice',
    properties: {},
    context: { jurisdiction, ip: '145.100.1.1', builder: 'lovable' },
  });

  test('VULN: one string flip moves the same user from denied to benchmark-eligible', () => {
    const deps = { identity: SECRET, ledger: new ConsentLedger() };
    const eu = ingest(raw('EU'), deps);
    const us = ingest(raw('US'), deps);

    assert.equal(eu.accepted, false);
    assert.equal(eu.accepted === false && eu.reason, 'no_analytics_consent');
    assert.equal(us.accepted, true);
    assert.deepEqual(
      us.accepted === true && us.event.permittedPurposes,
      ['product_analytics', 'benchmark_contribution'],
      'same person, same IP, same request — relabelled and now in the benchmark pool',
    );
  });

  test('HOLDS: coop_licensing still defaults to denied in every posture', () => {
    const ledger = new ConsentLedger();
    for (const j of ['EU', 'UK', 'US', 'US-CA', 'ZZ', 'unknown']) {
      assert.equal(ledger.resolve('w', 's', 'coop_licensing', j), 'denied', `jurisdiction ${j}`);
    }
  });

  test('HOLDS: prototype-shaped jurisdictions do not grant anything', () => {
    // DEFAULT_POSTURE is a plain object literal, so DEFAULT_POSTURE['__proto__'] is truthy
    // and short-circuits the `?? FALLBACK_POSTURE`. The lookup then yields undefined, which
    // fails the `=== 'granted'` test — fail-closed by luck rather than by design, but it
    // does fail closed. Note the returned value is not a valid ConsentState.
    const ledger = new ConsentLedger();
    for (const j of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      assert.deepEqual(ledger.permittedPurposes('w', 's', j), [], `jurisdiction ${j}`);
    }
  });
});

// ---------------------------------------------------------------------------
// VULN-12 — redaction bypasses.
// ---------------------------------------------------------------------------

describe('VULN-12: PII channels that walk straight past redactProperties', () => {
  test('VULN: property KEY names are never scanned for PII, only blocklisted', () => {
    // redactProperties tests the key against BLOCKED_KEY_PATTERN and then uses it verbatim
    // as an output key. The value patterns are never applied to keys.
    const { properties } = redactProperties({ 'jane.doe@acme.com': 1, 'ip_10.0.0.7': true });
    assert.equal(properties['jane.doe@acme.com'], 1, 'an email address survives as a key name');
    assert.equal(properties['ip_10.0.0.7'], true);
  });

  test('VULN: non-ASCII and full-width emails defeat the email pattern', () => {
    // JS \w is ASCII-only, so any accented character breaks [\w.+-]+@[\w-]+\.[\w.-]{2,}.
    const { properties, findings } = redactProperties({
      a: 'josé@exämple.com',
      b: 'user＠example.com', // full-width commercial at
      c: 'ada [at] example [dot] com',
    });
    assert.equal(properties.a, 'josé@exämple.com');
    assert.equal(properties.b, 'user＠example.com');
    assert.equal(properties.c, 'ada [at] example [dot] com');
    assert.equal(findings.filter((f) => f.rule === 'email').length, 0);
  });

  test('VULN: trivially reversible encodings are invisible to every pattern', () => {
    const encoded = Buffer.from('ada.lovelace@example.com').toString('base64');
    const { properties } = redactProperties({ payload: encoded, hexed: Buffer.from('4111111111111111').toString('hex') });
    assert.equal(properties.payload, encoded);
    assert.equal(
      Buffer.from(properties.payload as string, 'base64').toString(),
      'ada.lovelace@example.com',
      'the buyer decodes it in one line',
    );
  });

  test('VULN: PII split across sibling keys is reassembled downstream', () => {
    const { properties, findings } = redactProperties({
      local_part: 'ada.lovelace',
      domain_part: 'example.com',
      given: 'Ada',
      family: 'Lovelace',
    });
    assert.equal(`${properties.local_part}@${properties.domain_part}`, 'ada.lovelace@example.com');
    assert.equal(findings.length, 0, 'redaction reported nothing to remove');
  });

  test('VULN: numeric PII is stored untouched — patterns only ever run on strings', () => {
    const { properties, findings } = redactProperties({
      account_ref: 5551234567, // a phone number
      pan: 4111111111111111, // a card number
      y_deg: 52.379189, // precise geolocation, key dodges lat|lng|latitude|longitude
      x_deg: 4.899431,
      lon_deg: 4.899431, // "lon" is not in BLOCKED_KEY_PATTERN; "lat" and "lng" are
    });
    assert.equal(properties.account_ref, 5551234567);
    assert.equal(properties.pan, 4111111111111111);
    assert.equal(properties.y_deg, 52.379189);
    assert.equal(properties.lon_deg, 4.899431, 'lat is blocked, lon is not — asymmetric list');
    assert.equal(findings.length, 0);
  });

  test('VULN: the event NAME is a 64-character unredacted free-text channel', () => {
    // EVENT_NAME_PATTERN allows [a-z0-9_.:-], which is enough for names, phone digits and
    // dotted email local parts. ingest() never passes the name through redactProperties.
    const out = ingest(
      {
        workspaceId: 'ws1',
        eventId: 'e1',
        name: 'user.5551234567.ada.lovelace',
        occurredAt: '2026-07-15T10:00:00Z',
        identifier: 'x',
        properties: {},
        context: { jurisdiction: 'US' },
      },
      { identity: SECRET, ledger: new ConsentLedger() },
    );
    assert.equal(out.accepted, true);
    assert.equal(out.accepted === true && out.event.name, 'user.5551234567.ada.lovelace');
  });

  test('HOLDS: value-level patterns still catch camelCase keys the blocklist misses', () => {
    // BLOCKED_KEY_PATTERN needs an underscore or a boundary, so `userEmail` is not blocked —
    // but the value scan catches the address anyway. Defence in depth working as intended.
    const { properties } = redactProperties({ userEmail: 'ada@example.com', emailAddress: 'x@y.com' });
    assert.equal(properties.userEmail, '[redacted:email]');
    assert.equal(properties.emailAddress, '[redacted:email]');
  });

  test('HOLDS: nested keys are composed before blocklisting, and depth >1 is dropped', () => {
    const { properties, findings } = redactProperties({
      user: { email: 'ada@example.com', plan: 'pro' },
      deep: { a: { b: 'ada@example.com' } },
    });
    assert.equal(properties.user_email, undefined);
    assert.equal(properties.user_plan, 'pro');
    assert.equal(properties.deep_a, undefined);
    assert.ok(findings.some((f) => f.key === 'user_email' && f.rule === 'blocked_key'));
    assert.ok(findings.some((f) => f.rule === 'unsupported_type'));
  });

  test('HOLDS: array membership is collapsed to a count, not stringified', () => {
    const { properties } = redactProperties({ invitees: ['a@b.com', 'c@d.com', 'e@f.com'] });
    assert.equal(properties.invitees, undefined);
    assert.equal(properties.invitees_count, 3);
    assert.ok(!JSON.stringify(properties).includes('@'));
  });
});

// ---------------------------------------------------------------------------
// VULN-13 — epoch rotation provides no forward secrecy.
// ---------------------------------------------------------------------------

describe('VULN-13: pseudonym "rotation" is a counter, not a rotating secret', () => {
  /**
   * identity.ts claims "after an epoch flips, yesterday's key can no longer be joined to
   * today's". That is true only for an attacker without the root secret. The epoch is a
   * plaintext counter mixed into the HMAC message; the key material is a single long-lived
   * `rootSecret` that is never rotated and never destroyed.
   *
   * subjectKeysForRetentionWindow is a ready-made relinking oracle: give it a raw
   * identifier and it regenerates every pseudonym that identifier has ever had across the
   * whole 400-day retention window. Anyone with the secret — the operator, an insider, a
   * subpoena, a backup leak — can join a person's rows across every epoch.
   */
  test('VULN: a 400-day sweep reconstructs a year-old pseudonym exactly', () => {
    const yearOld = deriveSubjectKey(SECRET, 'ws1', 'alice', '2025-07-01T00:00:00Z');
    const sweep = subjectKeysForRetentionWindow(SECRET, 'ws1', 'alice', '2026-07-27T00:00:00Z', 400);
    assert.ok(sweep.includes(yearOld), 'every historical pseudonym is recomputable on demand');
    assert.ok(sweep.length >= 14);
  });

  test('VULN: backdating occurredAt regenerates any past epoch\'s key', () => {
    // The epoch index is a pure function of a client-supplied timestamp, so a workspace can
    // address any historical epoch it likes simply by asserting an old occurredAt.
    const oldEpoch = epochFor('2024-01-15T00:00:00Z');
    const insideOldEpoch = new Date(oldEpoch * EPOCH_DAYS * 86_400_000 + 86_400_000).toISOString();
    const alsoInside = new Date(oldEpoch * EPOCH_DAYS * 86_400_000 + 5 * 86_400_000).toISOString();

    assert.equal(epochFor(insideOldEpoch), oldEpoch, 'test precondition');
    assert.equal(epochFor(alsoInside), oldEpoch, 'test precondition');
    assert.equal(
      deriveSubjectKey(SECRET, 'ws1', 'alice', insideOldEpoch),
      deriveSubjectKey(SECRET, 'ws1', 'alice', alsoInside),
      'rotation is deterministic in a client-supplied timestamp',
    );
    assert.notEqual(
      deriveSubjectKey(SECRET, 'ws1', 'alice', insideOldEpoch),
      deriveSubjectKey(SECRET, 'ws1', 'alice', '2026-07-27T00:00:00Z'),
    );
  });

  test('HOLDS: cross-workspace linkage really is impossible by construction', () => {
    // This is the claim docs/04 leans hardest on, and it survives: the per-workspace HMAC
    // scoping means the same human in two apps yields two unrelated keys, and nothing in
    // the codebase can invert it without the root secret.
    const keys = new Set(
      ['ws_a', 'ws_b', 'ws_c'].map((w) =>
        deriveSubjectKey(SECRET, w, 'alice@example.com', '2026-07-01T00:00:00Z'),
      ),
    );
    assert.equal(keys.size, 3);
  });

  test('HOLDS: a weak root secret is refused rather than silently downgrading pseudonymity', () => {
    assert.throws(() => deriveSubjectKey({ rootSecret: 'short' }, 'w', 'u', '2026-07-01T00:00:00Z'));
  });
});

// ---------------------------------------------------------------------------
// Defences that held under attack. These are regression guards.
// ---------------------------------------------------------------------------

describe('HOLDS: defences that survived the audit', () => {
  test('HOLDS-1: non-consented rows influence nothing at all', () => {
    // Attempted attack: pad a thin cohort with non-consented rows so it clears k, or shift
    // the published distribution with rows nobody agreed to license. Both fail — the gate
    // filters first and every downstream computation reads `eligible`.
    const consenting = new Set(Array.from({ length: 20 }, (_, i) => `w${i}`));
    const clean = Array.from({ length: 20 }, (_, i) => obs(`w${i}`, 0.4, 100));
    const padded = [
      ...clean,
      ...Array.from({ length: 50 }, (_, i) => obs(`nc${i}`, 0.99, 1000)),
    ];

    const a = mustRelease(clean);
    const outB = gateRelease(COHORT, METRIC, padded, (o) => consenting.has(o.workspaceId), 'head', {
      budget: new PrivacyBudget(),
    });
    assert.equal(outB.released, true);
    if (!outB.released) return;

    assert.equal(a.contributorCount, outB.release.contributorCount);
    assert.equal(a.subjectCount, outB.release.subjectCount);
    assert.equal(outB.release.contributorCount, 20, 'the 50 non-consented workspaces are invisible');
    assert.equal(outB.release.subjectCount, 2000);
  });

  test('HOLDS-2: non-consented rows cannot lift a sub-k cohort over the threshold', () => {
    const consenting = new Set(['w0', 'w1']);
    const list = Array.from({ length: 30 }, (_, i) => obs(`w${i}`, 0.4, 500));
    const out = gateRelease(COHORT, METRIC, list, (o) => consenting.has(o.workspaceId), 'head', {
      budget: new PrivacyBudget(),
    });
    assert.equal(out.released, false);
    assert.equal(out.released === false && out.reason, 'too_few_contributors');
    assert.equal(out.verdict?.contributorCount, 2, 'threshold arithmetic saw only the consented rows');
  });

  test('HOLDS-3: an empty consented set is refused before anything else runs', () => {
    const out = gateRelease(COHORT, METRIC, [obs('w', 0.4, 10_000)], () => false, 'head', {
      budget: new PrivacyBudget(),
    });
    assert.equal(out.released, false);
    assert.equal(out.released === false && out.reason, 'no_consented_observations');
    assert.equal(out.verdict, undefined, 'no counts leak on this path');
  });

  test('HOLDS-4: within one budget key the budget is honoured exactly', () => {
    const budget = new PrivacyBudget(1.0);
    const population = Array.from({ length: 40 }, (_, i) => obs(`w${i}`, 0.4, 40));
    const released = Array.from({ length: 25 }, () =>
      gateRelease(COHORT, METRIC, population, () => true, 'head', { budget, epsilonPerQuery: 0.1 }),
    ).filter((r) => r.released).length;
    assert.equal(released, 10, 'exactly 1.0 / 0.1 releases, then it refuses');
  });

  test('HOLDS-5: noise is drawn from a CSPRNG, not a predictable stream', () => {
    // A seeded or Math.random-backed stream would be reproducible across processes and the
    // noise would be subtractable. Sanity check that draws are unique and well spread.
    const population = Array.from({ length: 200 }, (_, i) => obs(`w${i}`, i / 200, 5));
    const draws = Array.from({ length: 60 }, (_, i) =>
      mustRelease(population, { ...COHORT, period: `p${i}` }).mean,
    );
    // Clamping makes 0 and 1 legitimately repeat; every interior draw must be unique.
    const interior = draws.filter((v) => v > 0 && v < 1);
    assert.ok(interior.length > 20, 'test precondition: enough unclamped draws to judge');
    assert.equal(new Set(interior).size, interior.length, 'interior draws must never repeat');
  });

  test('HOLDS-6: the consent ledger detects rewritten history', () => {
    const ledger = new ConsentLedger();
    const rec = {
      workspaceId: 'ws',
      subjectKey: 's',
      source: 'explicit_ui' as const,
      recordedAt: '2026-07-01T00:00:00Z',
      jurisdiction: 'EU',
      noticeVersion: 'v1',
    };
    ledger.append({ ...rec, purpose: 'coop_licensing', state: 'denied' });
    ledger.append({ ...rec, subjectKey: 's2', purpose: 'coop_licensing', state: 'denied' });
    assert.deepEqual(ledger.verify(), { ok: true });

    (ledger.entries()[0]!.record as { state: string }).state = 'granted';
    const v = ledger.verify();
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.brokenAt, 0);
  });

  test('HOLDS-7: released values never escape the declared public domain', () => {
    // Attempted attack: force the mechanism to emit an out-of-range value that would reveal
    // the direction and magnitude of the noise draw. Clamping holds on every statistic.
    const population = Array.from({ length: 12 }, (_, i) => obs(`w${i}`, i / 12, 50));
    for (let i = 0; i < 200; i++) {
      const r = mustRelease(population, { ...COHORT, period: `p${i}` });
      for (const v of [...Object.values(r.percentiles), r.mean]) {
        assert.ok(v >= 0 && v <= 1, `value ${v} escaped [0, 1]`);
      }
    }
  });

  test('HOLDS-8: out-of-domain input values are clamped before they are measured', () => {
    // A poisoning workspace reporting value 1e9 cannot drag the aggregate: clamp runs first.
    const poisoned = [
      ...Array.from({ length: 20 }, (_, i) => obs(`w${i}`, 0.4, 100)),
      obs('poison', 1e9, 100),
    ];
    for (let i = 0; i < 50; i++) {
      const r = mustRelease(poisoned, { ...COHORT, period: `p${i}` });
      assert.ok(r.mean >= 0 && r.mean <= 1);
    }
  });
});
