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
 *   4. noise injection     — Laplace on every published statistic
 *   5. provenance stamp    — bind the release to a consent-ledger head
 */

import { createHash } from 'node:crypto';
import type { AggregateRelease, CohortKey, WorkspaceObservation } from '../types.ts';
import { checkKAnonymity, explainSuppression, type KAnonymityVerdict } from './k-anonymity.ts';
import {
  DEFAULT_EPSILON_PER_QUERY,
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

  // 4. Noise. One workspace is the unit of contribution to a cross-workspace statistic,
  //    so sensitivity is scaled by the number of contributors, not the number of subjects.
  const values = eligible.map((o) => clamp(o.value, metric.lo, metric.hi)).sort((a, b) => a - b);
  const sensitivity = (metric.hi - metric.lo) / verdict.contributorCount;
  const noisy = (v: number): number =>
    clamp(v + laplaceNoise(sensitivity, epsilon / 6), metric.lo, metric.hi);

  // Split the budget across the six published statistics, then re-sort so noise cannot
  // produce a non-monotonic percentile ladder (p75 below p50 reads as a bug to buyers).
  const ladder = [
    noisy(percentile(values, 0.1)),
    noisy(percentile(values, 0.25)),
    noisy(percentile(values, 0.5)),
    noisy(percentile(values, 0.75)),
    noisy(percentile(values, 0.9)),
  ].sort((a, b) => a - b);

  const trueMean = values.reduce((a, b) => a + b, 0) / values.length;

  const release: AggregateRelease = {
    cohort,
    metric: metric.name,
    contributorCount: verdict.contributorCount,
    subjectCount: verdict.subjectCount,
    percentiles: {
      p10: ladder[0]!,
      p25: ladder[1]!,
      p50: ladder[2]!,
      p75: ladder[3]!,
      p90: ladder[4]!,
    },
    mean: noisy(trueMean),
    epsilonSpent: epsilon,
    provenanceHash: '',
  };

  // 5. Provenance. Binds the numbers to the consent state they were derived from, so a
  //    buyer's compliance team can verify lineage without seeing any underlying data.
  release.provenanceHash = createHash('sha256')
    .update(
      [
        consentLedgerHead,
        cohortKeyString(cohort),
        metric.name,
        verdict.contributorCount,
        verdict.subjectCount,
        epsilon,
      ].join(' '),
    )
    .digest('hex');

  return { released: true, release };
}
