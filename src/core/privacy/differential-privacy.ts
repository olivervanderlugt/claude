/**
 * Differential privacy primitives.
 *
 * k-anonymity alone is not enough for a *repeatedly queried* dataset. If a buyer can ask
 * for the same cohort every week and watch it change, differencing attacks recover
 * individual contributions even when every published cell cleared k. So each cohort gets
 * a finite epsilon budget, and once it is spent that cohort stops answering new queries.
 *
 * The budget is the honest part. Systems that add noise but never track cumulative spend
 * are doing decoration, not privacy.
 */

import { randomInt } from 'node:crypto';

/** Default per-cohort, per-period budget. Conservative: ~10 useful releases per period. */
export const DEFAULT_EPSILON_BUDGET = 1.0;

/** Cost of a single aggregate release. */
export const DEFAULT_EPSILON_PER_QUERY = 0.1;

/**
 * Cryptographically-seeded uniform in (0, 1).
 *
 * Math.random() is not acceptable here: a predictable noise stream is removable noise,
 * which would silently void the privacy guarantee we are selling.
 */
function secureUniform(): number {
  // 2^48 of resolution, excluding the endpoints.
  const value = randomInt(1, 2 ** 48 - 1);
  return value / 2 ** 48;
}

/**
 * Laplace noise with scale b = sensitivity / epsilon.
 *
 * Sensitivity is how much one subject can move the statistic. For a mean over a clamped
 * range [lo, hi] with n subjects that is (hi - lo) / n — which is why small cohorts get
 * proportionally more noise, exactly as they should.
 */
export function laplaceNoise(sensitivity: number, epsilon: number): number {
  if (epsilon <= 0) throw new Error('dp: epsilon must be positive');
  if (sensitivity < 0) throw new Error('dp: sensitivity must be non-negative');
  const b = sensitivity / epsilon;
  const u = secureUniform() - 0.5;
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/** Clamp before measuring. Unbounded values give unbounded sensitivity, i.e. no privacy. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export interface NoisyMeanInput {
  values: number[];
  /** Domain bounds. Must be chosen from public knowledge, never from the data itself. */
  lo: number;
  hi: number;
  epsilon: number;
}

export function noisyMean({ values, lo, hi, epsilon }: NoisyMeanInput): number {
  if (values.length === 0) throw new Error('dp: cannot take a mean of zero values');
  const clamped = values.map((v) => clamp(v, lo, hi));
  const trueMean = clamped.reduce((a, b) => a + b, 0) / clamped.length;
  const sensitivity = (hi - lo) / clamped.length;
  return clamp(trueMean + laplaceNoise(sensitivity, epsilon), lo, hi);
}

export function noisyCount(trueCount: number, epsilon: number): number {
  // A single subject changes a count by at most 1.
  return Math.max(0, Math.round(trueCount + laplaceNoise(1, epsilon)));
}

/** Tracks cumulative epsilon spend per cohort key. Refuses releases once exhausted. */
export class PrivacyBudget {
  #spent = new Map<string, number>();
  readonly #budget: number;

  constructor(budgetPerCohort: number = DEFAULT_EPSILON_BUDGET) {
    this.#budget = budgetPerCohort;
  }

  spent(key: string): number {
    return this.#spent.get(key) ?? 0;
  }

  remaining(key: string): number {
    return Math.max(0, this.#budget - this.spent(key));
  }

  /** Attempt to reserve budget. Returns false rather than throwing so callers degrade. */
  trySpend(key: string, epsilon: number): boolean {
    if (epsilon <= 0) throw new Error('dp: epsilon must be positive');
    if (this.remaining(key) < epsilon) return false;
    this.#spent.set(key, this.spent(key) + epsilon);
    return true;
  }
}
