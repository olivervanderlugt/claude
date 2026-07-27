/**
 * k-anonymity thresholds for cohort release.
 *
 * Two independent thresholds must both hold, because they defend against different
 * attackers:
 *
 *   MIN_CONTRIBUTORS — stops one workspace's private metrics being republished as an
 *                      "industry benchmark". A competitor buying the dataset must not be
 *                      able to read a rival's conversion rate off it.
 *   MIN_SUBJECTS     — stops individual end users being inferable from a thin cohort.
 *
 * There is also a dominance check. Ten contributors clears k, but if one of them supplies
 * 90% of the subjects the "aggregate" is really that one company's number wearing a hat.
 */

import type { WorkspaceObservation } from '../types.ts';

/** Minimum distinct workspaces in a released cohort. */
export const MIN_CONTRIBUTORS = 10;

/** Minimum distinct end subjects behind a released cohort. */
export const MIN_SUBJECTS = 500;

/**
 * No single contributor may exceed this share of a cohort's subjects.
 * 0.34 means at least three meaningful contributors, whatever the raw count says.
 */
export const MAX_CONTRIBUTOR_SHARE = 0.34;

export type SuppressionReason =
  | 'too_few_contributors'
  | 'too_few_subjects'
  | 'contributor_dominance';

export type KAnonymityVerdict =
  | { ok: true; contributorCount: number; subjectCount: number }
  | {
      ok: false;
      reason: SuppressionReason;
      contributorCount: number;
      subjectCount: number;
      /** What the cohort still needs, so the UI can say "3 more apps until this unlocks". */
      shortfall: number;
    };

export function checkKAnonymity(
  observations: readonly WorkspaceObservation[],
  opts: {
    minContributors?: number;
    minSubjects?: number;
    maxContributorShare?: number;
  } = {},
): KAnonymityVerdict {
  const minContributors = opts.minContributors ?? MIN_CONTRIBUTORS;
  const minSubjects = opts.minSubjects ?? MIN_SUBJECTS;
  const maxShare = opts.maxContributorShare ?? MAX_CONTRIBUTOR_SHARE;

  // Distinct workspaces — one workspace submitting many rows is still one contributor.
  const byWorkspace = new Map<string, number>();
  for (const o of observations) {
    byWorkspace.set(o.workspaceId, (byWorkspace.get(o.workspaceId) ?? 0) + o.subjectCount);
  }

  const contributorCount = byWorkspace.size;
  const subjectCount = [...byWorkspace.values()].reduce((a, b) => a + b, 0);

  if (contributorCount < minContributors) {
    return {
      ok: false,
      reason: 'too_few_contributors',
      contributorCount,
      subjectCount,
      shortfall: minContributors - contributorCount,
    };
  }

  if (subjectCount < minSubjects) {
    return {
      ok: false,
      reason: 'too_few_subjects',
      contributorCount,
      subjectCount,
      shortfall: minSubjects - subjectCount,
    };
  }

  const largest = Math.max(...byWorkspace.values());
  if (subjectCount > 0 && largest / subjectCount > maxShare) {
    return {
      ok: false,
      reason: 'contributor_dominance',
      contributorCount,
      subjectCount,
      shortfall: Math.ceil(largest / maxShare) - subjectCount,
    };
  }

  return { ok: true, contributorCount, subjectCount };
}

/** Human-readable explanation. Shown in-product, so it must not sound like an error. */
export function explainSuppression(verdict: KAnonymityVerdict): string | null {
  if (verdict.ok) return null;
  switch (verdict.reason) {
    case 'too_few_contributors':
      return `This benchmark unlocks once ${verdict.shortfall} more comparable app(s) contribute.`;
    case 'too_few_subjects':
      return `This benchmark needs ${verdict.shortfall} more end users in the cohort before it can be shown.`;
    case 'contributor_dominance':
      return 'One app dominates this cohort, so publishing it would expose that app. Held back until the mix broadens.';
  }
}
