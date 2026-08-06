/**
 * The release gate.
 *
 * This is the *only* code path by which data crosses from the first-party plane into the
 * co-op plane. Every dataset we license, every benchmark we show, every number a third
 * party ever sees passes through here.
 *
 * Keeping it to one function is a deliberate architectural bet: the compliance surface of
 * the whole company is auditable in a single file, and any future "just this once" bypass
 * has to be written as an obvious exception rather than hidden in a query somewhere.
 *
 * Gate order matters and is fail-closed at each step:
 *   1. consent filter      — drop observations lacking co-op consent
 *   2. k-anonymity         — contributors, subjects, dominance
 *   3. privacy budget      — refuse if this cohort's epsilon is exhausted
 *   4. noise injection     — exponential mechanism for quantiles, Laplace for the mean
 *   5. provenance stamp    — bind the release to a consent-ledger head
 */

import { createHash } from 'node:crypto';
import type { AggregateRelease, CohortKey, WorkspaceObservation } from '../types.ts';
import { checkKAnonymity, explainSuppression, type KAnonymityVerdict } from './k-anonymity.ts';
import {
  DEFAULT_EPSILON_PER_QUERY,
  exponentialQuantile,
  laplaceNoise,
  PrivacyBudget,
  clamp,
} from './differential-privacy.ts';

export interface MetricSpec {
  name: string;
  /** Public domain bounds. Must come from the metric's definition, never from the data. */
  lo: number;
  hi: number;
}

export type ReleaseOutcome =
  | { released: true; release: AggregateRelease }
  | { released: false; reason: string; explanation: string; verdict?: KAnonymityVerdict };

export interface ReleaseGateOptions {
  budget: PrivacyBudget;
  epsilonPerQuery?: number;
  minContributors?: number;
  minSubjects?: number;
  maxContributorShare?: number;
}

export function cohortKeyString(c: CohortKey): string {
  return `${c.builder}|${c.vertical}|${c.sizeBucket}|${c.period}`;
}

/**
 * Public ladder used to generalise published counts. Fixed and public — a buyer can read it
 * here, which is the point: a published figure of 250 means "somewhere in [250, 500)",
 * and nothing finer is ever disclosed.
 */
const COUNT_LADDER = [
  10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000,
  500_000, 1_000_000,
] as const;

/** Snap a count down to the public ladder. Values below the floor report 0. */
export function generaliseCount(n: number): number {
  let out = 0;
  for (const step of COUNT_LADDER) {
    if (n >= step) out = step;
    else break;
  }
  return out;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('release-gate: empty distribution');
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const lo = sorted[lower]!;
  if (lower === upper) return lo;
  const hi = sorted[upper]!;
  return lo + (hi - lo) * (idx - lower);
}

/**
 * Produce a releasable aggregate, or an explained refusal.
 *
 * `consented` decides whether an observation is eligible for the co-op. It is passed in
 * rather than read here so that the gate stays pure and exhaustively testable — the
 * property we most need to be able to prove.
 */
export function gateRelease(
  cohort: CohortKey,
  metric: MetricSpec,
  observations: readonly WorkspaceObservation[],
  consented: (o: WorkspaceObservation) => boolean,
  consentLedgerHead: string,
  opts: ReleaseGateOptions,
): ReleaseOutcome {
  // 1. Consent filter. Non-consented rows are not merely excluded from the output —
  //    they must not influence thresholds either, or their existence leaks.
  const eligible = observations.filter(consented);
  if (eligible.length === 0) {
    return {
      released: false,
      reason: 'no_consented_observations',
      explanation: 'No observations in this cohort carry co-op licensing consent.',
    };
  }

  // 2. k-anonymity.
  const verdict = checkKAnonymity(eligible, {
    minContributors: opts.minContributors,
    minSubjects: opts.minSubjects,
    maxContributorShare: opts.maxContributorShare,
  });
  if (!verdict.ok) {
    return {
      released: false,
      reason: verdict.reason,
      explanation: explainSuppression(verdict) ?? 'Suppressed.',
      verdict,
    };
  }

  // 3. Privacy budget.
  const epsilon = opts.epsilonPerQuery ?? DEFAULT_EPSILON_PER_QUERY;
  const budgetKey = `${cohortKeyString(cohort)}::${metric.name}`;
  if (!opts.budget.trySpend(budgetKey, epsilon)) {
    return {
      released: false,
      reason: 'privacy_budget_exhausted',
      explanation:
        'This cohort has answered its maximum number of queries for the period. It refreshes next period.',
    };
  }

  // 4. Noise.
  //
  //    Quantiles go through the exponential mechanism, NOT Laplace. Laplace here needs a
  //    sensitivity, and the obvious choice — (hi-lo)/n, correct for a mean — is wrong for
  //    an order statistic and decays as 1/n, so larger cohorts would get less noise while
  //    the real sensitivity stays flat. See exponentialQuantile for the full reasoning.
  //
  //    The mean still uses Laplace, because (hi-lo)/n genuinely IS its sensitivity.
  const values = eligible.map((o) => clamp(o.value, metric.lo, metric.hi));

  // The budget splits across the six statistics that consume it: five percentiles and
  // the mean. The published counts are generalised rather than noised (see below), so
  // they draw nothing from the budget.
  const share = epsilon / 6;

  const quantile = (q: number): number =>
    exponentialQuantile({ values, q, lo: metric.lo, hi: metric.hi, epsilon: share });

  // Re-sorted so independent draws cannot produce a non-monotonic ladder. Sorting is
  // post-processing and costs no privacy, but it does bias the extremes — p10 becomes the
  // minimum of five draws — which is tolerable only because the exponential mechanism's
  // draws are tightly concentrated. It was not tolerable under Laplace.
  const ladder = [
    quantile(0.1),
    quantile(0.25),
    quantile(0.5),
    quantile(0.75),
    quantile(0.9),
  ].sort((a, b) => a - b);

  const trueMean = values.reduce((a, b) => a + b, 0) / values.length;
  const meanSensitivity = (metric.hi - metric.lo) / values.length;
  const noisyMeanValue = clamp(
    trueMean + laplaceNoise(meanSensitivity, share),
    metric.lo,
    metric.hi,
  );

  // Thresholds are decided on the exact counts; the *published* counts are generalised
  // down to a public ladder. Exact counts let a buyer difference two releases and recover
  // one workspace's subject count precisely — the headline way an "aggregate" leaks an
  // individual contributor.
  //
  // Be precise about what this is: generalisation, not differential privacy. Laplace on a
  // count at this budget is useless — at eps/6 = 0.017 the scale is 60, which turned a
  // true 25 contributors into a published 111. Snapping to a coarse public ladder instead
  // keeps the figure usable and means the common case (one workspace joins or leaves)
  // does not move the published value at all. What it concedes is that a boundary
  // crossing is observable; that is a bounded, much smaller leak than an exact count, and
  // the ε budget still caps how many times a cohort can be asked.
  const release: AggregateRelease = {
    cohort,
    metric: metric.name,
    contributorCount: generaliseCount(verdict.contributorCount),
    subjectCount: generaliseCount(verdict.subjectCount),
    percentiles: {
      p10: ladder[0]!,
      p25: ladder[1]!,
      p50: ladder[2]!,
      p75: ladder[3]!,
      p90: ladder[4]!,
    },
    mean: noisyMeanValue,
    epsilonSpent: epsilon,
    provenanceHash: '',
  };

  // 5. Provenance. Binds the numbers to the consent state they were derived from, so a
  //    buyer's compliance team can verify lineage without seeing any underlying data.
  //
  //    The preimage covers the published statistics, not just the counts. Committing to
  //    the counts alone let two releases built from opposite distributions produce
  //    identical stamps, and left a post-hoc edit of p50 undetectable — a stamp that
  //    proves nothing a buyer actually cares about.
  release.provenanceHash = createHash('sha256')
    .update(
      [
        consentLedgerHead,
        cohortKeyString(cohort),
        metric.name,
        metric.lo,
        metric.hi,
        release.contributorCount,
        release.subjectCount,
        release.percentiles.p10,
        release.percentiles.p25,
        release.percentiles.p50,
        release.percentiles.p75,
        release.percentiles.p90,
        release.mean,
        epsilon,
        opts.minContributors ?? '',
        opts.minSubjects ?? '',
        opts.maxContributorShare ?? '',
      ].join(' '),
    )
    .digest('hex');

  return { released: true, release };
}
