/**
 * Co-op revenue share.
 *
 * When a dataset is licensed, a fixed share of net revenue flows back to the workspaces
 * whose consented data went into it. This is not altruism, it is the growth engine:
 *
 *  - it converts an analytics bill into a credit, which collapses churn;
 *  - it gives developers a reason to keep contributing rather than opting out;
 *  - it makes the consent ask honest, which is what keeps end-user opt-in rates high
 *    enough for the cohorts to clear k-anonymity in the first place.
 *
 * Attribution is by *contributed subject count within the licensed cohorts*, not by
 * revenue or event volume, so a small app with engaged users is not crowded out by a
 * large one firing chatty telemetry.
 */

export const DEFAULT_CONTRIBUTOR_SHARE = 0.3;

/** Below this, payout is issued as platform credit rather than cash. Cheaper to settle. */
export const CASH_PAYOUT_THRESHOLD_CENTS = 5_000;

export interface LicenseDeal {
  dealId: string;
  /** Gross license value for the period, in cents. */
  grossCents: number;
  /** Costs directly attributable to the deal (delivery, referral fees), in cents. */
  directCostCents: number;
  /** Cohort keys included in the licensed dataset. */
  cohortKeys: string[];
}

export interface ContributionRecord {
  workspaceId: string;
  cohortKey: string;
  /** Distinct consented subjects this workspace contributed to that cohort. */
  subjectCount: number;
}

export interface Payout {
  workspaceId: string;
  amountCents: number;
  method: 'cash' | 'credit';
  /** Share of the contributor pool, 0-1. Surfaced so the split is inspectable. */
  share: number;
  subjectCount: number;
}

export interface Settlement {
  dealId: string;
  netCents: number;
  poolCents: number;
  platformCents: number;
  payouts: Payout[];
  /** Cents left over from rounding, retained by the platform. Always accounted for. */
  roundingRemainderCents: number;
}

/**
 * Settle one deal.
 *
 * Largest-remainder allocation keeps the payouts summing exactly to the pool; naive
 * per-workspace rounding drifts and produces a ledger that will not reconcile.
 */
export function settle(
  deal: LicenseDeal,
  contributions: readonly ContributionRecord[],
  opts: { contributorShare?: number; cashThresholdCents?: number } = {},
): Settlement {
  const shareRate = opts.contributorShare ?? DEFAULT_CONTRIBUTOR_SHARE;
  const cashThreshold = opts.cashThresholdCents ?? CASH_PAYOUT_THRESHOLD_CENTS;

  if (shareRate < 0 || shareRate > 1) throw new Error('revenue-share: share must be within 0..1');

  const netCents = Math.max(0, deal.grossCents - deal.directCostCents);
  const poolCents = Math.floor(netCents * shareRate);

  const included = new Set(deal.cohortKeys);
  const byWorkspace = new Map<string, number>();
  for (const c of contributions) {
    if (!included.has(c.cohortKey)) continue;
    if (c.subjectCount <= 0) continue;
    byWorkspace.set(c.workspaceId, (byWorkspace.get(c.workspaceId) ?? 0) + c.subjectCount);
  }

  const totalSubjects = [...byWorkspace.values()].reduce((a, b) => a + b, 0);
  if (totalSubjects === 0 || poolCents === 0) {
    return {
      dealId: deal.dealId,
      netCents,
      poolCents: 0,
      platformCents: netCents,
      payouts: [],
      roundingRemainderCents: 0,
    };
  }

  const provisional = [...byWorkspace.entries()].map(([workspaceId, subjectCount]) => {
    const exact = (poolCents * subjectCount) / totalSubjects;
    return { workspaceId, subjectCount, exact, floor: Math.floor(exact) };
  });

  let allocated = provisional.reduce((a, p) => a + p.floor, 0);
  const remainder = poolCents - allocated;

  // Distribute the remaining cents to the largest fractional parts, ties broken by
  // workspace id so settlement is deterministic and reproducible in an audit.
  const ranked = [...provisional].sort((a, b) => {
    const fracDiff = (b.exact - b.floor) - (a.exact - a.floor);
    return fracDiff !== 0 ? fracDiff : a.workspaceId.localeCompare(b.workspaceId);
  });
  for (let i = 0; i < remainder; i++) {
    ranked[i % ranked.length]!.floor += 1;
    allocated += 1;
  }

  const payouts: Payout[] = provisional
    .filter((p) => p.floor > 0)
    .map((p) => ({
      workspaceId: p.workspaceId,
      amountCents: p.floor,
      method: p.floor >= cashThreshold ? ('cash' as const) : ('credit' as const),
      share: p.subjectCount / totalSubjects,
      subjectCount: p.subjectCount,
    }))
    .sort((a, b) => b.amountCents - a.amountCents || a.workspaceId.localeCompare(b.workspaceId));

  const paid = payouts.reduce((a, p) => a + p.amountCents, 0);

  return {
    dealId: deal.dealId,
    netCents,
    poolCents,
    platformCents: netCents - paid,
    payouts,
    roundingRemainderCents: poolCents - paid,
  };
}
