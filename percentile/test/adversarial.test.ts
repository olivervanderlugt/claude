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
 *   starts failing, the corresponding hole has probably been fixed; convert it to a
 *   `HOLDS-n` guard and record the fix, do not weaken the assertion.
 *
 *   Tests named `HOLDS-n` are regression guards: the defence works and must keep working.
 *
 * Findings are written up in docs/11-privacy-audit.md.
 *
 * Statistical tests use enough trials that the assertion margin is several standard errors
 * wide; none of them depend on a lucky draw.
 *
 * ---------------------------------------------------------------------------
 * Second pass, after the quantile-mechanism / count-generalisation / provenance fixes.
 *
 *   FIXED and now guarded : the Laplace-on-a-quantile DP violation (HOLDS-Q*), the sybil
 *                           percentile readout (HOLDS-S*), naive count differencing
 *                           (HOLDS-C1), the provenance stamp (HOLDS-P1).
 *   STILL LIVE            : VULN-3, VULN-3b, VULN-4, VULN-5, VULN-8, VULN-9, VULN-10..13.
 *   NEW / RESHAPED        : VULN-4 moved from the percentile channel to the mean and is
 *                           now the headline DP violation; VULN-6 is a new adaptive break
 *                           of count generalisation; VULN-9 is the same commercial problem
 *                           with a completely different signature.
 * ---------------------------------------------------------------------------
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  gateRelease,
  cohortKeyString,
  generaliseCount,
  type MetricSpec,
} from '../src/core/privacy/release-gate.ts';
import { PrivacyBudget, exponentialQuantile } from '../src/core/privacy/differential-privacy.ts';
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

// ===========================================================================
// FIXED — the quantile mechanism. Was the Critical finding of the first pass.
// ===========================================================================

describe('HOLDS-Q: the exponential mechanism closed the quantile channel', () => {
  /**
   * First pass: `release-gate.ts` added Laplace noise scaled `(hi - lo) / n` to each
   * percentile. That is the sensitivity of a *mean*, not of an order statistic, and it
   * decays as 1/n while the real quantile sensitivity stays flat — so a 1000-workspace
   * cohort leaked a single workspace's value from ONE release with 100% accuracy.
   *
   * The gate now uses `exponentialQuantile` (Smith, STOC 2011) for all five rungs. These
   * tests re-run the original attack verbatim and confirm it is dead, and separately
   * confirm the mechanism is a real quantile estimator rather than a random-number
   * generator that happens to defeat the attack.
   */
  const N = 1000;

  function stepCohort(lowCount: number): WorkspaceObservation[] {
    return Array.from({ length: N }, (_, i) => obs(`w${i}`, i < lowCount ? 0 : 1, 5));
  }

  test('precondition: both worlds still clear every k-anonymity threshold', () => {
    for (const zeros of [100, 101]) {
      const verdict = checkKAnonymity(stepCohort(zeros));
      assert.equal(verdict.ok, true);
      assert.equal(verdict.ok === true && verdict.contributorCount, 1000);
      assert.equal(verdict.ok === true && verdict.subjectCount, 5000);
    }
  });

  test('HOLDS-Q1: the single-release neighbouring-dataset classifier is back at chance', () => {
    // Under Laplace this scored 100%. A correct eps = 0.0167 mechanism caps the advantage
    // at ~exp(0.0167) - 1, i.e. indistinguishable from a coin.
    const TRIALS = 200;
    let correct = 0;
    for (let i = 0; i < TRIALS; i++) {
      if (mustRelease(stepCohort(100)).percentiles.p10 > 0.45) correct++;
      if (mustRelease(stepCohort(101)).percentiles.p10 <= 0.45) correct++;
    }
    const accuracy = correct / (TRIALS * 2);
    assert.ok(
      accuracy < 0.62,
      `attacker accuracy ${accuracy.toFixed(3)}; chance is 0.5 and Laplace scored 1.00`,
    );
  });

  test('HOLDS-Q2: no published statistic separates the two worlds under averaging', () => {
    // The stronger version: average every published statistic over many releases and look
    // for any channel that still moves when one workspace flips.
    const T = 150;
    const A = Array.from({ length: T }, () => mustRelease(stepCohort(100)));
    const B = Array.from({ length: T }, () => mustRelease(stepCohort(101)));

    for (const k of ['p10', 'p25', 'p50', 'p75', 'p90'] as const) {
      const gap = Math.abs(mean(A.map((r) => r.percentiles[k])) - mean(B.map((r) => r.percentiles[k])));
      assert.ok(gap < 0.1, `${k} separated the neighbouring datasets by ${gap.toFixed(3)}`);
    }
    const meanGap = Math.abs(mean(A.map((r) => r.mean)) - mean(B.map((r) => r.mean)));
    assert.ok(meanGap < 0.1, `mean separated the neighbouring datasets by ${meanGap.toFixed(3)}`);
  });

  test('HOLDS-Q3: given real budget the mechanism tracks the true quantile', () => {
    // Guards against a "fix" that simply returns noise. At eps = 6 the exponential
    // mechanism must land on the true quantile essentially exactly.
    const values = Array.from({ length: 1000 }, (_, i) => (i + 0.5) / 1000);
    for (const q of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const draws = Array.from({ length: 100 }, () =>
        exponentialQuantile({ values, q, lo: 0, hi: 1, epsilon: 6 }),
      );
      const worst = Math.max(...draws.map((v) => Math.abs(v - q)));
      assert.ok(worst < 0.02, `q=${q} worst error ${worst.toFixed(4)} at eps=6`);
    }
  });

  test('HOLDS-Q4: fully degenerate input never returns a raw data value', () => {
    // The `maxLog === -Infinity` branch in exponentialQuantile returns z[0] unprotected.
    // It is unreachable while hi > lo, because the gaps sum to (hi - lo) and so at least
    // one gap is always positive. Verified over every degenerate shape.
    for (const values of [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [0.5, 0.5, 0.5], [0, 1]]) {
      const draws = Array.from({ length: 300 }, () =>
        exponentialQuantile({ values, q: 0.5, lo: 0, hi: 1, epsilon: 0.1 / 6 }),
      );
      const exactHits = draws.filter((d) => values.includes(d)).length;
      assert.equal(exactHits, 0, `input ${JSON.stringify(values)} was echoed back verbatim`);
      assert.ok(new Set(draws).size > 250, 'output must be a continuous draw, not a point mass');
    }
  });

  test('HOLDS-Q5: output never escapes the public domain bounds', () => {
    const values = [-5, 0.2, 0.4, 3, 99];
    for (let i = 0; i < 500; i++) {
      const v = exponentialQuantile({ values, q: 0.5, lo: 0, hi: 1, epsilon: 0.1 / 6 });
      assert.ok(v >= 0 && v <= 1, `escaped domain: ${v}`);
    }
  });
});

// ===========================================================================
// FIXED — the sybil percentile readout.
// ===========================================================================

describe('HOLDS-S: the sybil percentile readout is dead', () => {
  /**
   * First pass: 499 sybils at lo + 500 at hi pinned the victim at the p50 index, so
   * `victim = 2 * p50 - 1` recovered a named competitor's private metric to 2.2pp with 40
   * queries.
   *
   * Under the exponential mechanism the only positive-width gaps in that construction are
   * [lo, victim] and [victim, hi], selected with probability proportional to their widths.
   * The published value is therefore distributed uniformly on [lo, hi] whatever the victim
   * did, and E[p50] = 1/2 identically. The estimator has no signal left to average.
   *
   * NOTE: the *root cause* of this finding — k counts workspaces, not independent parties
   * (`k-anonymity.ts:19`) — is untouched. Only the channel it was exploited through is
   * closed. See VULN-4, which exploits the same collusion assumption through the mean.
   */
  function sybilProbe(victimValue: number): number {
    const list: WorkspaceObservation[] = [];
    for (let i = 0; i < 499; i++) list.push(obs(`sybil_lo_${i}`, 0, 5));
    list.push(obs('victim', victimValue, 5));
    for (let i = 0; i < 500; i++) list.push(obs(`sybil_hi_${i}`, 1, 5));
    return mustRelease(list).percentiles.p50;
  }

  test('precondition: the sybil cohort still passes k, subjects and dominance', () => {
    const list: WorkspaceObservation[] = [];
    for (let i = 0; i < 499; i++) list.push(obs(`sybil_lo_${i}`, 0, 5));
    list.push(obs('victim', 0.4, 5));
    for (let i = 0; i < 500; i++) list.push(obs(`sybil_hi_${i}`, 1, 5));
    assert.equal(checkKAnonymity(list).ok, true, 'the gate still sees a healthy 1000-app cohort');
  });

  test('HOLDS-S1: the recovered estimate no longer tracks the victim', () => {
    const T = 200;
    const lowV = mean(Array.from({ length: T }, () => sybilProbe(0.1)));
    const highV = mean(Array.from({ length: T }, () => sybilProbe(0.8)));
    // Under Laplace these differed by 0.7 x 0.5 = 0.35 in p50 space. Now both sit at 1/2.
    assert.ok(
      Math.abs(highV - lowV) < 0.12,
      `p50 still moved ${Math.abs(highV - lowV).toFixed(3)} between victim=0.1 and victim=0.8`,
    );
    for (const [label, v] of [['low', lowV], ['high', highV]] as const) {
      assert.ok(Math.abs(v - 0.5) < 0.12, `${label} average p50 ${v.toFixed(3)} drifted off 1/2`);
    }
  });

  test('HOLDS-S2: 200 queries of budget buy no better than one', () => {
    const one = 2 * sybilProbe(0.4) - 1;
    const many = 2 * mean(Array.from({ length: 200 }, () => sybilProbe(0.4))) - 1;
    // The first-pass attack got to |error| 0.022 with 40 queries. Averaging now converges
    // on 0 (the estimator's fixed point), not on the victim's 0.4.
    assert.ok(
      Math.abs(many - 0.4) > 0.15,
      `200-query estimate ${many.toFixed(3)} landed too close to the true 0.4`,
    );
    void one;
  });
});

// ===========================================================================
// STILL LIVE — budget keying.
// ===========================================================================

describe('VULN-3: the privacy budget key is metadata, not population', () => {
  /**
   * Unchanged by the fixes. `release-gate.ts:128` —
   *   budgetKey = `${cohortKeyString(cohort)}::${metric.name}`
   * `cohort` and `observations` are independent parameters; nothing checks that the label
   * describes the population. `period` reaches the gate from `?period=` in
   * `src/api/server.ts:196`, and `metric.name` is a free string.
   *
   * This is now load-bearing for two other findings: VULN-4's averaging attack and VULN-6's
   * adaptive binary search both need many queries, and this is where they get them.
   */
  const population = Array.from({ length: 1000 }, (_, i) => obs(`w${i}`, i / 1000, 5));

  test('VULN: 50 releases of one population out of a budget that permits 10', () => {
    const budget = new PrivacyBudget();
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

describe('VULN-3b: every rung of the coarsening ladder still gets its own full epsilon', () => {
  /**
   * `coarsen()` in src/core/aggregate/rollup.ts produces four strictly nested cohorts.
   * Members of the narrow rung belong to all four populations and therefore absorb
   * 4 x 1.0 of epsilon while every per-cohort ledger reports 1.0. Unchanged.
   *
   * PARTIAL IMPROVEMENT: the first pass also showed adjacent rungs differencing to the
   * exact subject total of the ring between them (1000 / 1200 / 1400). Count
   * generalisation has blunted that — two of the four rungs now collide on the same
   * published figure. That improvement is asserted below so it cannot silently regress.
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

  test('HOLDS-C0: generalisation blunted the rung-differencing lattice', () => {
    const rungs = coarsen(target);
    const counts = rungs.map((rung) =>
      mustRelease(world.filter((o) => matchesCohort(o.cohort, rung)), rung.cohort).subjectCount,
    );
    // True totals are 1600 / 2600 / 3800 / 5200 — previously published verbatim.
    assert.deepEqual(counts, [1000, 2500, 2500, 5000]);
    assert.equal(counts[1], counts[2], 'two adjacent rungs now collide, disclosing nothing');
  });
});

// ===========================================================================
// STILL LIVE, AND NOW THE HEADLINE — the unit of privacy is a row, not a workspace.
// ===========================================================================

describe('VULN-4: the privacy unit is one row; the declared unit is one workspace', () => {
  /**
   * `checkKAnonymity` sums `subjectCount` per workspace and caps any workspace at 34% of
   * subjects. `release-gate.ts:146` then builds `values` from *observations* — one entry
   * per row, unweighted — and `MemoryStore.putObservation` (`src/api/store.ts:87`) appends
   * without deduplication or any per-workspace cap.
   *
   * Both mechanisms are calibrated per element of `values`:
   *   - `meanSensitivity = (hi - lo) / values.length`  (release-gate.ts:169)
   *   - exponentialQuantile's utility has sensitivity 1 per element
   *
   * So a workspace holding R of the N rows enjoys an effective epsilon of R x the declared
   * epsilon. With 600 of 1599 rows that is a 600-fold understatement.
   *
   * REGRESSION NOTE: before the fix, `meanSensitivity` used `verdict.contributorCount`.
   * It now uses `values.length`, which is rows — strictly further from the declared unit of
   * contribution. The percentile channel closing has left the mean as the readable one.
   */
  const STUFFER_VALUE = 0.62;

  function stuffed(v: number): WorkspaceObservation[] {
    const list: WorkspaceObservation[] = [];
    for (let i = 0; i < 600; i++) list.push(obs('stuffer', v, 1));
    for (let i = 0; i < 999; i++) list.push(obs(`w${i}`, i / 999, 5));
    return list;
  }

  test('precondition: the stuffed cohort reports as healthy', () => {
    const verdict = checkKAnonymity(stuffed(STUFFER_VALUE));
    assert.equal(verdict.ok, true);
    assert.equal(verdict.ok === true && verdict.contributorCount, 1000);
    assert.ok(verdict.ok === true && 600 / verdict.subjectCount < 0.34, 'inside the 34% cap');
  });

  test('VULN: one workspace changing its value is readable from a single mean', () => {
    // Neighbouring datasets differing in exactly one WORKSPACE — the gate's own declared
    // unit of contribution. Declared noise scale b = (1/1599)/(0.1/6) = 0.0375; the true
    // shift is 0.233, i.e. 6.2 scales.
    const T = 200;
    let correct = 0;
    for (let i = 0; i < T; i++) {
      if (mustRelease(stuffed(STUFFER_VALUE)).mean > 0.43) correct++;
      if (mustRelease(stuffed(0)).mean <= 0.43) correct++;
    }
    const accuracy = correct / (T * 2);
    assert.ok(
      accuracy > 0.85,
      `single-release classifier ${(accuracy * 100).toFixed(1)}% on a one-workspace change`,
    );
  });

  test('VULN: 40 queries recover the stuffing workspace\'s exact value', () => {
    // The attacker knows the other 999 values (they are the cohort's public ladder, or in
    // the sybil framing they are his own), so he inverts the published mean directly.
    const othersSum = Array.from({ length: 999 }, (_, i) => i / 999).reduce((a, b) => a + b, 0);
    const invert = (m: number): number => (1599 * m - othersSum) / 600;

    const estimate = invert(mean(Array.from({ length: 40 }, () => mustRelease(stuffed(STUFFER_VALUE)).mean)));
    const error = Math.abs(estimate - STUFFER_VALUE);
    // Measured over 30 independent runs: median |error| 0.020, worst 0.043.
    assert.ok(
      error < 0.12,
      `recovered ${estimate.toFixed(3)} against a true ${STUFFER_VALUE}, error ${error.toFixed(3)}`,
    );
  });

  test('VULN: at scale the percentile channel reopens too', () => {
    // 6000 of 10000 rows from one workspace collapse the ranks around the p50 target into
    // a zero-width region, so the mechanism is forced into the gap immediately adjacent to
    // that workspace's value. The exponential mechanism is intact; the privacy unit is not.
    function bigStuff(v: number): WorkspaceObservation[] {
      const list: WorkspaceObservation[] = [];
      for (let i = 0; i < 6000; i++) list.push(obs('stuffer', v, 1));
      for (let i = 0; i < 4000; i++) list.push(obs(`w${i}`, i / 4000, 5));
      return list;
    }
    const high = mean(Array.from({ length: 40 }, () => mustRelease(bigStuff(0.62)).percentiles.p50));
    const low = mean(Array.from({ length: 40 }, () => mustRelease(bigStuff(0.2)).percentiles.p50));
    assert.ok(Math.abs(high - 0.62) < 0.12, `p50 tracked the stuffer to ${high.toFixed(3)}`);
    assert.ok(Math.abs(low - 0.2) < 0.12, `p50 tracked the stuffer to ${low.toFixed(3)}`);
    assert.ok(high - low > 0.25, 'the published median follows one workspace, not the cohort');
  });
});

// ===========================================================================
// STILL LIVE — the suppression oracle.
// ===========================================================================

describe('VULN-5: refusals leak exact counts and cost zero epsilon', () => {
  /**
   * Untouched by the fixes, and the gap has widened: released counts are now generalised
   * to a coarse public ladder (10, 25, 50, ...) while *refused* cohorts still return exact
   * `contributorCount`, exact `subjectCount` and an exact `shortfall`, for free, forever.
   *
   * The sub-k region — the region k-anonymity exists to protect — is now strictly more
   * informative than the super-k region by a wide margin.
   */
  test('VULN: a refusal reveals a single rival workspace\'s exact subject count', () => {
    const out = gateRelease(COHORT, METRIC, [obs('rival', 0.5, 137)], () => true, 'head', {
      budget: new PrivacyBudget(),
    });
    assert.equal(out.released, false);
    if (out.released) return;
    assert.equal(out.verdict?.subjectCount, 137, 'exact, unnoised, un-generalised');
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

// ===========================================================================
// PARTLY FIXED, NEWLY BROKEN — published counts.
// ===========================================================================

describe('HOLDS-C: count generalisation killed the naive differencing attack', () => {
  /**
   * First pass: `contributorCount` and `subjectCount` were published exact, so subtracting
   * two releases whose populations differed by one workspace disclosed that workspace's
   * subject count to the person (verified: 317).
   *
   * `generaliseCount` now snaps published figures down to a public ladder. A single
   * workspace joining or leaving is invisible unless it happens to straddle a rung.
   */
  test('HOLDS-C1: adding one 317-subject workspace no longer moves the published figure', () => {
    const base = Array.from({ length: 40 }, (_, i) => obs(`w${i}`, 0.3 + i * 0.01, 40));
    const withRival = [...base, obs('rival', 0.55, 317)];

    const before = mustRelease(base);
    const after = mustRelease(withRival, { ...COHORT, period: '2026-W31' });

    assert.equal(before.subjectCount, 1000, 'true 1600 -> published 1000');
    assert.equal(after.subjectCount, 1000, 'true 1917 -> published 1000');
    assert.equal(after.subjectCount - before.subjectCount, 0, 'the difference discloses nothing');
    assert.equal(after.contributorCount, before.contributorCount);
  });

  test('HOLDS-C2: the ladder is coarse and monotone, and floors below 10 to zero', () => {
    assert.deepEqual(
      [9, 10, 24, 25, 499, 500, 999, 1000, 2499, 2500].map(generaliseCount),
      [0, 10, 10, 25, 250, 500, 500, 1000, 1000, 2500],
    );
  });
});

describe('VULN-6: generalisation is fully invertible by an adversary who can shape the cohort', () => {
  /**
   * This is the attack `generaliseCount` has to survive to be worth anything, and it does
   * not. Generalisation is deterministic: the published figure is a known function of the
   * true count. An attacker who contributes to the cohort controls the argument to that
   * function, so he can binary-search a ladder boundary until it brackets the victim.
   *
   * Setup: 200 sybil workspaces whose subject counts the attacker sets exactly, plus one
   * honest victim with unknown subject count v. Published subjectCount is
   * `generaliseCount(S + v)`. The attacker finds the smallest S for which the published
   * figure reaches ladder rung L, and then v = L - S. Every probe needs a fresh budget,
   * which VULN-3 supplies without limit.
   *
   * This is the structural difference between generalisation and differential privacy:
   * DP degrades gracefully under composition, deterministic generalisation does not degrade
   * at all — it simply falls over once the adversary can move the input.
   */
  const LADDER = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000];

  /** Publish subjectCount for a cohort of 200 attacker-controlled sybils plus the victim. */
  function probe(sybilSubjects: number, victim: number): number | null {
    const list: WorkspaceObservation[] = [];
    const base = Math.floor(sybilSubjects / 200);
    const rem = sybilSubjects % 200;
    for (let i = 0; i < 200; i++) list.push(obs(`s${i}`, 0.5, base + (i < rem ? 1 : 0)));
    list.push(obs('victim', 0.5, victim));
    const out = gateRelease(COHORT, METRIC, list, () => true, 'head', {
      budget: new PrivacyBudget(),
    });
    return out.released ? out.release.subjectCount : null;
  }

  function recover(victim: number): { vhat: number; queries: number; boundary: number } {
    let queries = 0;
    for (const L of LADDER) {
      // The boundary must sit high enough that the victim stays inside the 34% cap.
      if (L < 3 * victim) continue;
      let lo = 0;
      let hi = L;
      let feasible = true;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        queries++;
        const published = probe(mid, victim);
        if (published === null) {
          feasible = false;
          break;
        }
        if (published >= L) hi = mid;
        else lo = mid;
      }
      if (feasible) return { vhat: L - hi, queries, boundary: L };
    }
    return { vhat: -1, queries, boundary: -1 };
  }

  test('VULN: ~13 adaptive queries recover the victim\'s EXACT subject count', () => {
    for (const victim of [317, 842, 1163, 4471]) {
      const r = recover(victim);
      assert.equal(
        r.vhat,
        victim,
        `victim ${victim} recovered as ${r.vhat} in ${r.queries} queries at rung ${r.boundary}`,
      );
      assert.ok(r.queries <= 16, `${r.queries} queries is still trivially cheap`);
    }
  });

  test('VULN: passive watching detects ladder crossings to the period', () => {
    // No sybils needed for the weaker version — just subscribe and watch. A crossing is a
    // dated, exact statement about the cohort's growth.
    const watch = (total: number): number | null => {
      const list = Array.from({ length: 20 }, (_, i) => obs(`w${i}`, 0.5, Math.floor(total / 20)));
      list[0]!.subjectCount += total % 20;
      const out = gateRelease(COHORT, METRIC, list, () => true, 'head', {
        budget: new PrivacyBudget(),
      });
      return out.released ? out.release.subjectCount : null;
    };
    assert.equal(watch(499), null, 'below MIN_SUBJECTS the cohort is suppressed — itself a signal');
    assert.equal(watch(500), 500);
    assert.equal(watch(999), 500);
    assert.equal(watch(1000), 1000, 'the exact period of the 1000th subject is disclosed');
    assert.equal(watch(2499), 1000);
    assert.equal(watch(2500), 2500);
  });
});

// ===========================================================================
// MOSTLY FIXED — provenance.
// ===========================================================================

describe('HOLDS-P / VULN-7: the provenance stamp now binds the numbers, but is unsigned', () => {
  /**
   * First pass: the preimage covered only [ledgerHead, cohortKey, metricName, counts,
   * epsilon], so two releases built from opposite distributions produced byte-identical
   * stamps and a post-hoc edit of p50 was undetectable.
   *
   * `release-gate.ts:212` now commits to the metric bounds, all five percentiles, the mean,
   * the published counts and the threshold options. That is a real fix.
   *
   * What remains: it is an unsigned SHA-256 over a preimage that is entirely public, so
   * anyone can mint a stamp that verifies for numbers they invented. It also still omits
   * the contributing workspace set and the consent predicate, and no verification function
   * is exported anywhere in the repository — a buyer has to reimplement the preimage from
   * this source file to check anything.
   */
  test('HOLDS-P1: opposite distributions no longer collide', () => {
    const low = Array.from({ length: 1000 }, (_, i) => obs(`w${i}`, 0.02, 100));
    const high = Array.from({ length: 1000 }, (_, i) => obs(`w${i}`, 0.98, 100));
    assert.notEqual(mustRelease(low).provenanceHash, mustRelease(high).provenanceHash);
  });

  test('HOLDS-P2: the stamp changes when any published statistic changes', () => {
    const pop = Array.from({ length: 1000 }, (_, i) => obs(`w${i}`, i / 1000, 100));
    const hashes = new Set(Array.from({ length: 20 }, () => mustRelease(pop).provenanceHash));
    assert.equal(hashes.size, 20, 'independent draws must produce independent stamps');
  });

  test('HOLDS-P3: the consent-ledger head is still bound in', () => {
    const pop = Array.from({ length: 20 }, (_, i) => obs(`w${i}`, 0.4, 100));
    const a = gateRelease(COHORT, METRIC, pop, () => true, 'headA', { budget: new PrivacyBudget() });
    const b = gateRelease(COHORT, METRIC, pop, () => true, 'headB', { budget: new PrivacyBudget() });
    assert.ok(a.released && b.released);
    if (!a.released || !b.released) return;
    assert.notEqual(a.release.provenanceHash, b.release.provenanceHash);
  });

  test('VULN: the stamp is unsigned, so a reseller can mint one for invented numbers', async () => {
    const { createHash } = await import('node:crypto');
    const real = mustRelease(Array.from({ length: 20 }, (_, i) => obs(`w${i}`, 0.2, 100)));

    // Fabricate a release that makes the buyer's competitors look worse, then compute a
    // stamp for it from the public preimage recipe. No key is involved anywhere.
    const forged = { ...real, percentiles: { ...real.percentiles, p50: 0.99 }, mean: 0.99 };
    forged.provenanceHash = createHash('sha256')
      .update(
        [
          'ledger-head',
          cohortKeyString(forged.cohort),
          forged.metric,
          METRIC.lo,
          METRIC.hi,
          forged.contributorCount,
          forged.subjectCount,
          forged.percentiles.p10,
          forged.percentiles.p25,
          forged.percentiles.p50,
          forged.percentiles.p75,
          forged.percentiles.p90,
          forged.mean,
          forged.epsilonSpent,
          '',
          '',
          '',
        ].join(' '),
      )
      .digest('hex');

    // The forged stamp is internally consistent and indistinguishable from a real one.
    assert.equal(forged.provenanceHash.length, 64);
    assert.notEqual(forged.provenanceHash, real.provenanceHash);
    assert.equal(forged.percentiles.p50, 0.99, 'fabricated number carrying a valid-looking stamp');
  });
});

// ===========================================================================
// STILL LIVE — threshold overrides.
// ===========================================================================

describe('VULN-8: gateRelease accepts weaker-than-policy thresholds without complaint', () => {
  /**
   * Unchanged. `ReleaseGateOptions` exposes minContributors / minSubjects /
   * maxContributorShare with `?? DEFAULT` resolution and no lower bound.
   *
   * Count generalisation has made this *harder* to spot, not easier: a k=1 release now
   * publishes contributorCount 0 rather than 1, and every cohort between 10 and 24
   * contributors publishes the same 10, so the counts no longer distinguish a compliant
   * release from a marginal one. The thresholds ARE in the provenance preimage now, but
   * only as opaque bytes — there is no verifier to check them against policy.
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
    assert.equal(out.release.contributorCount, 0, 'generalisation reports 0, not 1');
    assert.equal(out.release.subjectCount, 0);
    assert.equal(out.release.provenanceHash.length, 64, 'and it carries a full provenance stamp');
  });

  test('VULN: published counts cannot distinguish k=10 from k=24', () => {
    const at10 = Array.from({ length: 10 }, (_, i) => obs(`w${i}`, 0.4, 60));
    const at24 = Array.from({ length: 24 }, (_, i) => obs(`w${i}`, 0.4, 25));
    assert.equal(mustRelease(at10).contributorCount, 10);
    assert.equal(mustRelease(at24).contributorCount, 10);
  });

  test('HOLDS: the budget still caps a single query at the cohort budget', () => {
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

// ===========================================================================
// STILL LIVE, DIFFERENT SIGNATURE — the ladder carries no information.
// ===========================================================================

describe('VULN-9: below ~10,000 contributors the published ladder is pure noise', () => {
  /**
   * First pass, under Laplace: at k=10 the noise scale was 6.0 on a [0,1] domain, so 85% of
   * published medians were exactly 0 or 1. The exponential mechanism has removed the
   * bound-piling and the DP violation — but NOT the underlying problem, which is the
   * epsilon allocation, not the mechanism.
   *
   * The exponential mechanism's error is measured in RANKS, with scale 2/epsilon. At
   * epsilon/6 = 0.0167 that is 120 ranks. A cohort must have n >> 120 contributors before
   * the rank error is small as a fraction of the population. It does not.
   *
   * Consequence, measured below: at n <= 1000 the published ladder is statistically
   * identical to the order statistics of five uniform draws on [lo, hi]. A cohort of ten
   * apps with values 0.0 .. 0.9 and a cohort of ten apps that all report exactly 0.5
   * publish the same ladder. `compare()` in src/core/aggregate/benchmarks.ts will report a
   * confident percentile rank from it either way.
   *
   * This is a correctness and misrepresentation finding, not a disclosure one — but it
   * decides the minimum viable cohort size, so it is commercially load-bearing.
   */
  test('VULN: a flat cohort publishes the order statistics of five uniform draws', () => {
    const flat = Array.from({ length: 200 }, (_, i) => obs(`w${i}`, 0.5, 5)); // zero dispersion
    const runs = Array.from({ length: 300 }, () => mustRelease(flat).percentiles);
    // Theory for min/median/max of five iid U(0,1): 1/6, 3/6, 5/6.
    for (const [k, theory] of [['p10', 1 / 6], ['p50', 3 / 6], ['p90', 5 / 6]] as const) {
      const got = mean(runs.map((r) => r[k]));
      assert.ok(
        Math.abs(got - theory) < 0.05,
        `${k} = ${got.toFixed(3)}, uniform-order-statistic theory says ${theory.toFixed(3)}`,
      );
    }
  });

  test('VULN: at k=10 a spread cohort and a flat cohort are indistinguishable', () => {
    const spread = Array.from({ length: 10 }, (_, i) => obs(`w${i}`, i / 10, 50)); // true p50 0.45
    const flat = Array.from({ length: 10 }, (_, i) => obs(`w${i}`, 0.5, 50)); // true spread 0
    const T = 300;
    const S = Array.from({ length: T }, () => mustRelease(spread).percentiles);
    const F = Array.from({ length: T }, () => mustRelease(flat).percentiles);

    for (const k of ['p10', 'p50', 'p90'] as const) {
      const gap = Math.abs(mean(S.map((r) => r[k])) - mean(F.map((r) => r[k])));
      assert.ok(gap < 0.1, `${k} differed by only ${gap.toFixed(3)} between the two cohorts`);
    }
  });

  test('VULN: at k=10 the published median ignores the truth and reports the domain midpoint', () => {
    // True p50 is 0.275. The mechanism reports ~0.49 whatever the data says.
    const cohort10 = Array.from({ length: 10 }, (_, i) => obs(`w${i}`, 0.05 + i * 0.05, 50));
    const draws = Array.from({ length: 300 }, () => mustRelease(cohort10).percentiles.p50);
    assert.ok(
      Math.abs(mean(draws) - 0.5) < 0.08,
      `published median averaged ${mean(draws).toFixed(3)}; the true p50 is 0.275`,
    );
    assert.ok(
      mean(draws.map((v) => Math.abs(v - 0.275))) > 0.15,
      'mean absolute error must be large — this test exists to record that it is',
    );
  });

  test('HOLDS: the ladder does become usable, but only around n = 10,000', () => {
    // Recorded so the crossover is a fact in the suite rather than an opinion in a doc.
    const big = Array.from({ length: 10_000 }, (_, i) => obs(`w${i}`, (i + 0.5) / 10_000, 1));
    const draws = Array.from({ length: 40 }, () => mustRelease(big).percentiles.p50);
    assert.ok(
      mean(draws.map((v) => Math.abs(v - 0.5))) < 0.05,
      `n=10000 mean |error| ${mean(draws.map((v) => Math.abs(v - 0.5))).toFixed(4)}`,
    );
  });

  test('HOLDS: the fix is the epsilon allocation, not the mechanism', () => {
    // Same mechanism, same n = 1000, budget spent on ONE quantile instead of split six
    // ways: error drops from ~0.10 to ~0.02. This is the cheapest available remedy.
    const values = Array.from({ length: 1000 }, (_, i) => (i + 0.5) / 1000);
    const split = mean(
      Array.from({ length: 200 }, () =>
        Math.abs(exponentialQuantile({ values, q: 0.5, lo: 0, hi: 1, epsilon: 0.1 / 6 }) - 0.5),
      ),
    );
    const whole = mean(
      Array.from({ length: 200 }, () =>
        Math.abs(exponentialQuantile({ values, q: 0.5, lo: 0, hi: 1, epsilon: 0.1 }) - 0.5),
      ),
    );
    assert.ok(split > 0.05, `six-way split error ${split.toFixed(4)}`);
    assert.ok(whole < 0.05, `un-split error ${whole.toFixed(4)}`);
    assert.ok(split / whole > 2, 'spending the whole query budget on one rung is much better');
  });
});

// ===========================================================================
// STILL LIVE — consent, jurisdiction, redaction, identity. Unchanged by the fixes.
// ===========================================================================

describe('VULN-10: co-op release ignores per-subject consent entirely', () => {
  /**
   * The gate's consent filter is correct and is proved correct in HOLDS-1 below. The
   * problem is the predicate the one production caller passes it.
   *
   * src/api/server.ts:204 —  (o) => store.hasCoopConsent(o.workspaceId)
   * src/api/store.ts:52    —  returns profile.coopEnrolled
   *
   * A per-WORKSPACE boolean set by the developer. It never reads the ConsentLedger, so the
   * three-tier purpose model, sticky withdrawal, the jurisdiction defaults and the GPC/DNT
   * handling in the /v1/events path all have zero effect on what is licensed.
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

describe('VULN-11: the strict EU posture is opt-out by string', () => {
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
    const ledger = new ConsentLedger();
    for (const j of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      assert.deepEqual(ledger.permittedPurposes('w', 's', j), [], `jurisdiction ${j}`);
    }
  });
});

describe('VULN-12: PII channels that walk straight past redactProperties', () => {
  test('VULN: property KEY names are never scanned for PII, only blocklisted', () => {
    const { properties } = redactProperties({ 'jane.doe@acme.com': 1, 'ip_10.0.0.7': true });
    assert.equal(properties['jane.doe@acme.com'], 1, 'an email address survives as a key name');
    assert.equal(properties['ip_10.0.0.7'], true);
  });

  test('VULN: non-ASCII and full-width emails defeat the email pattern', () => {
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
    const { properties } = redactProperties({
      payload: encoded,
      hexed: Buffer.from('4111111111111111').toString('hex'),
    });
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
      account_ref: 5551234567,
      pan: 4111111111111111,
      y_deg: 52.379189,
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

describe('VULN-13: pseudonym "rotation" is a counter, not a rotating secret', () => {
  test('VULN: a 400-day sweep reconstructs a year-old pseudonym exactly', () => {
    const yearOld = deriveSubjectKey(SECRET, 'ws1', 'alice', '2025-07-01T00:00:00Z');
    const sweep = subjectKeysForRetentionWindow(SECRET, 'ws1', 'alice', '2026-07-27T00:00:00Z', 400);
    assert.ok(sweep.includes(yearOld), 'every historical pseudonym is recomputable on demand');
    assert.ok(sweep.length >= 14);
  });

  test('VULN: backdating occurredAt regenerates any past epoch\'s key', () => {
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

// ===========================================================================
// Defences that held under attack. Regression guards.
// ===========================================================================

describe('HOLDS: defences that survived the audit', () => {
  test('HOLDS-1: non-consented rows influence nothing at all', () => {
    // Attempted attack: pad a thin cohort with non-consented rows so it clears k, or shift
    // the published distribution with rows nobody agreed to license.
    //
    // The padding is chosen so that a leak would be unmistakable AFTER generalisation:
    // 20 consented workspaces / 2000 subjects publish as 10 / 1000, whereas 70 workspaces /
    // 52000 subjects would publish as 50 / 50000. Equality of the published figures is
    // therefore evidence about the underlying counts, not an artefact of the ladder.
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

    assert.equal(a.contributorCount, 10, 'true 20 contributors -> published 10');
    assert.equal(a.subjectCount, 1000, 'true 2000 subjects -> published 1000');
    assert.equal(outB.release.contributorCount, a.contributorCount);
    assert.equal(outB.release.subjectCount, a.subjectCount);
    // If the 50 non-consented workspaces had leaked into the counts:
    assert.equal(generaliseCount(70), 50);
    assert.equal(generaliseCount(52_000), 50_000);
    assert.notEqual(outB.release.contributorCount, generaliseCount(70));
    assert.notEqual(outB.release.subjectCount, generaliseCount(52_000));
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
    const population = Array.from({ length: 200 }, (_, i) => obs(`w${i}`, i / 200, 5));
    const draws = Array.from({ length: 60 }, (_, i) =>
      mustRelease(population, { ...COHORT, period: `p${i}` }).mean,
    );
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
    const population = Array.from({ length: 12 }, (_, i) => obs(`w${i}`, i / 12, 50));
    for (let i = 0; i < 200; i++) {
      const r = mustRelease(population, { ...COHORT, period: `p${i}` });
      for (const v of [...Object.values(r.percentiles), r.mean]) {
        assert.ok(v >= 0 && v <= 1, `value ${v} escaped [0, 1]`);
      }
    }
  });

  test('HOLDS-8: out-of-domain input values are clamped before they are measured', () => {
    const poisoned = [
      ...Array.from({ length: 20 }, (_, i) => obs(`w${i}`, 0.4, 100)),
      obs('poison', 1e9, 100),
    ];
    for (let i = 0; i < 50; i++) {
      const r = mustRelease(poisoned, { ...COHORT, period: `p${i}` });
      assert.ok(r.mean >= 0 && r.mean <= 1);
    }
  });

  test('HOLDS-9: the percentile ladder is monotone in every release', () => {
    const population = Array.from({ length: 500 }, (_, i) => obs(`w${i}`, i / 500, 5));
    for (let i = 0; i < 100; i++) {
      const p = mustRelease(population, { ...COHORT, period: `p${i}` }).percentiles;
      assert.ok(p.p10 <= p.p25 && p.p25 <= p.p50 && p.p50 <= p.p75 && p.p75 <= p.p90);
    }
  });

  test('HOLDS-10: the mean is correctly calibrated when one row means one workspace', () => {
    // The complement of VULN-4. With exactly one observation per workspace,
    // (hi - lo) / values.length IS the per-workspace sensitivity, and a single workspace
    // moving from lo to hi is NOT distinguishable from the published mean.
    const base = (last: number) => [
      ...Array.from({ length: 999 }, (_, i) => obs(`w${i}`, 0.5, 5)),
      obs('subject', last, 5),
    ];
    const T = 150;
    let correct = 0;
    for (let i = 0; i < T; i++) {
      if (mustRelease(base(1)).mean > mustRelease(base(0)).mean) correct++;
    }
    assert.ok(
      correct / T < 0.75,
      `one-workspace change detected ${(correct / T * 100).toFixed(0)}% of the time`,
    );
  });
});
