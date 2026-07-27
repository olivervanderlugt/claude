/**
 * Benchmarks: turning a released aggregate into the sentence a developer actually wants.
 *
 * "Your 7-day activation is 14%. Median for AI-built B2B SaaS at your size is 22%.
 *  You are in the 21st percentile. Closing to median is roughly 340 more activated users
 *  a month."
 *
 * That sentence is the entire consumer-side product. Raw dashboards are a commodity that
 * three open-source projects give away; the comparison is the thing nobody can copy
 * without a network, and the network is what we are actually building.
 */

import type { AggregateRelease } from '../types.ts';

export interface BenchmarkComparison {
  metric: string;
  yourValue: number;
  cohortMedian: number;
  /** Where this workspace sits in the cohort, 0-100. Interpolated from the ladder. */
  percentileRank: number;
  /** Positive means above cohort median. */
  deltaVsMedian: number;
  direction: 'ahead' | 'behind' | 'at_median';
  narrative: string;
}

/**
 * Interpolate a percentile rank from the five published points.
 *
 * We only ever publish a five-point ladder, so this is deliberately coarse. Publishing a
 * finer distribution would spend more privacy budget for a precision no user acts on.
 */
export function percentileRank(release: AggregateRelease, value: number): number {
  const points: Array<[number, number]> = [
    [release.percentiles.p10, 10],
    [release.percentiles.p25, 25],
    [release.percentiles.p50, 50],
    [release.percentiles.p75, 75],
    [release.percentiles.p90, 90],
  ];

  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (value <= first[0]) return 10;
  if (value >= last[0]) return 90;

  for (let i = 0; i < points.length - 1; i++) {
    const [lowV, lowP] = points[i]!;
    const [highV, highP] = points[i + 1]!;
    if (value >= lowV && value <= highV) {
      if (highV === lowV) return highP;
      return lowP + ((value - lowV) / (highV - lowV)) * (highP - lowP);
    }
  }
  return 50;
}

export interface NarrativeOptions {
  /** Human-readable metric label, e.g. "7-day activation rate". */
  label: string;
  /** Formats a raw value for display, e.g. 0.14 -> "14%". */
  format?: (v: number) => string;
  /** Denominator for translating a gap into absolute units, e.g. monthly new users. */
  volume?: number;
  /** True when a lower value is better (churn, latency, error rate). */
  lowerIsBetter?: boolean;
}

export function compare(
  release: AggregateRelease,
  yourValue: number,
  opts: NarrativeOptions,
): BenchmarkComparison {
  const fmt = opts.format ?? ((v: number) => v.toFixed(2));
  const median = release.percentiles.p50;
  const rank = percentileRank(release, yourValue);
  const delta = yourValue - median;

  const better = opts.lowerIsBetter ? delta < 0 : delta > 0;
  const direction: BenchmarkComparison['direction'] =
    Math.abs(delta) < 1e-9 ? 'at_median' : better ? 'ahead' : 'behind';

  // Effective rank flips for lower-is-better metrics so "high percentile" always means good.
  const effectiveRank = opts.lowerIsBetter ? 100 - rank : rank;

  let narrative =
    `Your ${opts.label} is ${fmt(yourValue)}. The median for ${describeCohort(release)} is ` +
    `${fmt(median)}, putting you in roughly the ${Math.round(effectiveRank)}th percentile`;

  if (direction === 'at_median') {
    narrative += '. You are level with the cohort.';
  } else if (direction === 'ahead') {
    narrative += ` — ahead of the pack by ${fmt(Math.abs(delta))}.`;
  } else {
    narrative += `. Closing the ${fmt(Math.abs(delta))} gap to median`;
    narrative =
      opts.volume && opts.volume > 0
        ? `${narrative} is worth about ${Math.round(Math.abs(delta) * opts.volume).toLocaleString()} more per month.`
        : `${narrative} is the single biggest lever available to you.`;
  }

  narrative += ` Based on ${release.contributorCount} comparable apps.`;

  return {
    metric: release.metric,
    yourValue,
    cohortMedian: median,
    percentileRank: effectiveRank,
    deltaVsMedian: delta,
    direction,
    narrative,
  };
}

function describeCohort(release: AggregateRelease): string {
  const { builder, vertical, sizeBucket } = release.cohort;
  const builderLabel = builder === 'unknown' ? 'AI-built' : `${builder}-built`;
  return `${builderLabel} ${vertical.replace(/_/g, ' ')} apps at ${sizeBucket} users`;
}
