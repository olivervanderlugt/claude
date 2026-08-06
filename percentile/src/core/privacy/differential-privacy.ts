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

/**
 * ε-differentially-private quantile via the exponential mechanism.
 *
 * Laplace noise on a quantile is simply the wrong mechanism, and the error is easy to
 * make because it looks right. `(hi - lo) / n` is the correct global sensitivity for a
 * *mean* over n bounded contributions. For an order statistic it is wrong: changing one
 * contributor can move a quantile by the whole gap to its neighbour, and that gap does
 * not shrink with n. `{0, 0, 1}` versus `{0, 1, 1}` moves the median the entire domain
 * with one changed value.
 *
 * The consequence of getting this wrong is perverse rather than merely sloppy: a
 * sensitivity that decays as 1/n means *larger* cohorts receive *less* noise while the
 * real sensitivity stays flat. Privacy degrades as the network grows — the exact inverse
 * of what a data co-op needs to be able to claim.
 *
 * The exponential mechanism instead scores each gap between sorted values by how close
 * its rank is to the target, and samples a gap with probability proportional to
 *
 *     (width of gap) x exp(-ε |rank - target| / 2)
 *
 * The rank utility has sensitivity 1, hence the /2. Wide gaps are favoured because a
 * value drawn from a wide gap is less informative about any individual contribution.
 *
 * Utility is dramatically better than Laplace at the same ε for small cohorts, which
 * matters commercially as much as legally: at k=10 the Laplace version published a
 * median of exactly 0 or 1 about 85% of the time, i.e. the benchmark was unusable at
 * precisely the cohort size the whole go-to-market is built around.
 *
 * Reference: Smith, "Privacy-preserving statistical estimation with optimal convergence
 * rates" (STOC 2011).
 */
export function exponentialQuantile(input: {
  values: readonly number[];
  /** Target quantile in [0, 1]. */
  q: number;
  /** Public domain bounds. Must come from the metric definition, never from the data. */
  lo: number;
  hi: number;
  epsilon: number;
}): number {
  const { q, lo, hi, epsilon } = input;
  if (epsilon <= 0) throw new Error('dp: epsilon must be positive');
  if (q < 0 || q > 1) throw new Error('dp: q must be within 0..1');
  if (hi <= lo) throw new Error('dp: hi must exceed lo');
  if (input.values.length === 0) throw new Error('dp: cannot take a quantile of zero values');

  // Clamp and sort, then bracket with the public domain bounds so the candidate set is
  // [lo, z_1, ..., z_n, hi]. Using the data's own min/max as endpoints would leak them.
  const z = input.values.map((v) => clamp(v, lo, hi)).sort((a, b) => a - b);
  const n = z.length;
  const bounds = [lo, ...z, hi];

  const target = q * n;

  // Log-weights, so a large ε cannot overflow exp(). Gap i spans bounds[i]..bounds[i+1]
  // and corresponds to rank i.
  const logWeights: number[] = new Array(n + 1);
  let maxLog = -Infinity;
  for (let i = 0; i <= n; i++) {
    const width = bounds[i + 1]! - bounds[i]!;
    if (width <= 0) {
      logWeights[i] = -Infinity; // zero-width gaps can never be selected
      continue;
    }
    const lw = Math.log(width) - (epsilon * Math.abs(i - target)) / 2;
    logWeights[i] = lw;
    if (lw > maxLog) maxLog = lw;
  }

  if (maxLog === -Infinity) {
    // Every gap has zero width: all values identical and equal to a bound. Nothing to
    // sample, and no information to protect beyond the value itself.
    return clamp(z[0]!, lo, hi);
  }

  // Softmax in a numerically stable form.
  let total = 0;
  const weights = logWeights.map((lw) => {
    const w = lw === -Infinity ? 0 : Math.exp(lw - maxLog);
    total += w;
    return w;
  });

  let draw = secureUniform() * total;
  let chosen = weights.length - 1;
  for (let i = 0; i < weights.length; i++) {
    draw -= weights[i]!;
    if (draw <= 0) {
      chosen = i;
      break;
    }
  }

  // Uniform within the selected gap.
  const a = bounds[chosen]!;
  const b = bounds[chosen + 1]!;
  return clamp(a + secureUniform() * (b - a), lo, hi);
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
