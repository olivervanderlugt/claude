/**
 * Financial model.
 *
 * Every number in docs/02-business-model.md comes out of this file. That is deliberate:
 * a plan whose numbers live in prose can be quietly fudged, and one whose numbers are
 * computed can be argued with. Change an assumption here, re-run, and the plan updates.
 *
 *   npm run model            base case
 *   npm run model -- bear    pessimistic
 *   npm run model -- bull    optimistic
 *   npm run model -- all     side-by-side summary
 *
 * Sources for the market inputs are listed in docs/09-research-sources.md.
 */

interface Assumptions {
  name: string;
  months: number;

  // --- Acquisition -------------------------------------------------------------
  /** New workspaces installing the SDK in month 1. */
  initialInstalls: number;
  /** Month-over-month install growth, before decay. */
  installGrowth: number;
  /** Growth decays toward zero as the reachable market fills. */
  growthDecay: number;
  /** Ceiling on monthly installs — the reachable slice of new AI-built apps. */
  installCeiling: number;

  // --- Conversion --------------------------------------------------------------
  /** Share of installs that send meaningful volume (the real top of funnel). */
  activationRate: number;
  /** Activated -> paid, month 1. */
  paidConversionStart: number;
  /** Activated -> paid at maturity, as benchmark coverage improves the offer. */
  paidConversionEnd: number;
  /** Months to travel from start to end conversion. */
  conversionRampMonths: number;

  // --- Revenue -----------------------------------------------------------------
  /** Blended monthly revenue per paying workspace at launch. */
  arpaStart: number;
  /** Blended ARPA at maturity, via seat/volume expansion. */
  arpaEnd: number;
  /** Monthly logo churn at launch. */
  churnStart: number;
  /** Monthly logo churn at maturity — benchmarks and co-op credits are retention tools. */
  churnEnd: number;

  // --- Cost --------------------------------------------------------------------
  /** Monthly infra cost per paying workspace (ingest, storage, query). */
  cogsPerPaidWorkspace: number;
  /** Monthly infra cost per free workspace — free tiers are not free to serve. */
  cogsPerFreeWorkspace: number;
  /** Fixed monthly opex: salaries, tooling, legal, compliance. */
  fixedOpexStart: number;
  /** Ceiling on opex at the end of the horizon — the fully-staffed plan. */
  fixedOpexEnd: number;
  /**
   * Hiring discipline: opex is allowed to reach this multiple of revenue, but no more.
   * Modelling a straight-line ramp instead assumes a team that hires on plan rather than
   * on traction, which is precisely how data-network startups die before the network
   * effect arrives.
   */
  opexToRevenueCap: number;

  // --- Data co-op --------------------------------------------------------------
  /** First month a dataset can be licensed — cohorts must clear k-anonymity first. */
  coopStartMonth: number;
  /** Data licensees at co-op launch. */
  coopInitialLicensees: number;
  /** Net new licensees per month thereafter. */
  coopLicenseeGrowth: number;
  /** Average annual contract value per licensee. */
  coopAcv: number;
  /** Share of net co-op revenue paid back to contributing workspaces. */
  contributorShare: number;
  /** Share of workspaces that enrol in the co-op. */
  coopEnrolmentRate: number;
  /** Direct cost of delivering data revenue (fulfilment, referral fees). */
  coopDirectCostRate: number;
}

const BASE: Assumptions = {
  name: 'base',
  months: 36,

  initialInstalls: 250,
  installGrowth: 0.22,
  growthDecay: 0.055,
  installCeiling: 9_000,

  activationRate: 0.32,
  paidConversionStart: 0.035,
  paidConversionEnd: 0.08,
  conversionRampMonths: 24,

  arpaStart: 42,
  arpaEnd: 88,
  churnStart: 0.075,
  churnEnd: 0.035,

  cogsPerPaidWorkspace: 5.5,
  cogsPerFreeWorkspace: 0.35,
  fixedOpexStart: 28_000,
  fixedOpexEnd: 340_000,
  // 0.65 models a team that hires behind revenue. At 0.75 the company sits permanently
  // just below breakeven (71% gross margin minus 75% opex) — a legitimate choice to
  // reinvest everything, but it should be deliberate. See docs/02-business-model.md.
  opexToRevenueCap: 0.65,

  coopStartMonth: 14,
  coopInitialLicensees: 3,
  coopLicenseeGrowth: 1.4,
  coopAcv: 95_000,
  contributorShare: 0.3,
  coopEnrolmentRate: 0.45,
  coopDirectCostRate: 0.15,
};

const BEAR: Assumptions = {
  ...BASE,
  name: 'bear',
  initialInstalls: 120,
  installGrowth: 0.15,
  growthDecay: 0.075,
  installCeiling: 3_500,
  activationRate: 0.22,
  paidConversionEnd: 0.045,
  arpaEnd: 58,
  churnEnd: 0.055,
  coopStartMonth: 22,
  coopInitialLicensees: 1,
  coopLicenseeGrowth: 0.5,
  coopAcv: 55_000,
  coopEnrolmentRate: 0.25,
  fixedOpexEnd: 260_000,
  opexToRevenueCap: 0.7,
};

const BULL: Assumptions = {
  ...BASE,
  name: 'bull',
  initialInstalls: 450,
  installGrowth: 0.28,
  growthDecay: 0.04,
  installCeiling: 20_000,
  activationRate: 0.4,
  paidConversionEnd: 0.11,
  arpaEnd: 130,
  churnEnd: 0.025,
  coopStartMonth: 11,
  coopInitialLicensees: 6,
  coopLicenseeGrowth: 2.5,
  coopAcv: 140_000,
  coopEnrolmentRate: 0.6,
  fixedOpexEnd: 480_000,
  opexToRevenueCap: 0.8,
};

interface MonthRow {
  month: number;
  installs: number;
  freeWorkspaces: number;
  paidWorkspaces: number;
  subscriptionMrr: number;
  coopMrr: number;
  contributorPayout: number;
  totalRevenue: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  ebitda: number;
  cumulativeCash: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function run(a: Assumptions): MonthRow[] {
  const rows: MonthRow[] = [];

  let installs = a.initialInstalls;
  let growth = a.installGrowth;
  let paid = 0;
  let free = 0;
  let cumulativeCash = 0;

  for (let m = 1; m <= a.months; m++) {
    // Growth decays; the reachable market is large but not infinite.
    installs = Math.min(a.installCeiling, installs * (1 + growth));
    growth = Math.max(0, growth - a.growthDecay * growth);

    const rampT = (m - 1) / a.conversionRampMonths;
    const conversion = lerp(a.paidConversionStart, a.paidConversionEnd, rampT);
    const arpa = lerp(a.arpaStart, a.arpaEnd, rampT);
    const churn = lerp(a.churnStart, a.churnEnd, rampT);

    const activated = installs * a.activationRate;
    const newPaid = activated * conversion;

    // Free base accumulates non-converting activated workspaces and leaks slowly.
    free = free * 0.94 + (activated - newPaid);
    paid = paid * (1 - churn) + newPaid;

    const subscriptionMrr = paid * arpa;

    // --- Data co-op ------------------------------------------------------------
    let coopMrr = 0;
    let contributorPayout = 0;
    if (m >= a.coopStartMonth) {
      const monthsLive = m - a.coopStartMonth;
      const licensees = a.coopInitialLicensees + a.coopLicenseeGrowth * monthsLive;
      const gross = (licensees * a.coopAcv) / 12;

      // Data revenue scales with how much of the network actually contributes. A co-op
      // half the network opts out of licenses a materially thinner dataset.
      const coverage = Math.min(1, a.coopEnrolmentRate / 0.45);
      coopMrr = gross * coverage;
      contributorPayout = coopMrr * (1 - a.coopDirectCostRate) * a.contributorShare;
    }

    const totalRevenue = subscriptionMrr + coopMrr;
    const cogs =
      paid * a.cogsPerPaidWorkspace +
      free * a.cogsPerFreeWorkspace +
      coopMrr * a.coopDirectCostRate +
      contributorPayout;

    // Hire on traction, not on plan: the ramp is a ceiling, revenue sets the real pace.
    const opexCeiling = lerp(a.fixedOpexStart, a.fixedOpexEnd, (m - 1) / (a.months - 1));
    const opex = Math.min(
      opexCeiling,
      Math.max(a.fixedOpexStart, totalRevenue * a.opexToRevenueCap),
    );
    const grossProfit = totalRevenue - cogs;
    const ebitda = grossProfit - opex;
    cumulativeCash += ebitda;

    rows.push({
      month: m,
      installs,
      freeWorkspaces: free,
      paidWorkspaces: paid,
      subscriptionMrr,
      coopMrr,
      contributorPayout,
      totalRevenue,
      cogs,
      grossProfit,
      opex,
      ebitda,
      cumulativeCash,
    });
  }

  return rows;
}

const money = (n: number): string => {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${sign}$${(v / 1000).toFixed(0)}k`;
  return `${sign}$${v.toFixed(0)}`;
};

const count = (n: number): string => Math.round(n).toLocaleString('en-US');

function summarise(a: Assumptions) {
  const rows = run(a);
  const y = (n: number): MonthRow => rows[n * 12 - 1]!;
  const arr = (r: MonthRow): number => r.totalRevenue * 12;

  const peakBurn = Math.min(...rows.map((r) => r.cumulativeCash));
  const breakeven = rows.find((r) => r.ebitda > 0)?.month ?? null;
  const y3 = y(3);

  return {
    name: a.name,
    rows,
    y1Arr: arr(y(1)),
    y2Arr: arr(y(2)),
    y3Arr: arr(y3),
    y3Paid: y3.paidWorkspaces,
    y3CoopShare: y3.totalRevenue > 0 ? y3.coopMrr / y3.totalRevenue : 0,
    y3GrossMargin: y3.totalRevenue > 0 ? y3.grossProfit / y3.totalRevenue : 0,
    peakBurn,
    breakeven,
    totalContributorPayout: rows.reduce((s, r) => s + r.contributorPayout, 0),
  };
}

function printScenario(a: Assumptions): void {
  const s = summarise(a);
  console.log(`\n=== ${a.name.toUpperCase()} CASE ===\n`);
  console.log(
    ['Mo', 'Installs', 'Paid', 'Sub MRR', 'Co-op MRR', 'Revenue', 'GM%', 'EBITDA', 'Cum. cash']
      .map((h, i) => h.padStart(i === 0 ? 3 : 11))
      .join(''),
  );

  for (const r of s.rows) {
    if (r.month % 3 !== 0 && r.month !== 1) continue;
    const gm = r.totalRevenue > 0 ? `${((r.grossProfit / r.totalRevenue) * 100).toFixed(0)}%` : '—';
    console.log(
      [
        String(r.month).padStart(3),
        count(r.installs).padStart(11),
        count(r.paidWorkspaces).padStart(11),
        money(r.subscriptionMrr).padStart(11),
        money(r.coopMrr).padStart(11),
        money(r.totalRevenue).padStart(11),
        gm.padStart(11),
        money(r.ebitda).padStart(11),
        money(r.cumulativeCash).padStart(11),
      ].join(''),
    );
  }

  console.log(`\n  Y1 ARR              ${money(s.y1Arr)}`);
  console.log(`  Y2 ARR              ${money(s.y2Arr)}`);
  console.log(`  Y3 ARR              ${money(s.y3Arr)}`);
  console.log(`  Y3 paying apps      ${count(s.y3Paid)}`);
  console.log(`  Y3 co-op % of rev   ${(s.y3CoopShare * 100).toFixed(0)}%`);
  console.log(`  Y3 gross margin     ${(s.y3GrossMargin * 100).toFixed(0)}%`);
  console.log(`  Peak cumulative cash${money(s.peakBurn).padStart(10)}`);
  console.log(`  First EBITDA+ month ${s.breakeven ?? 'not within horizon'}`);
  console.log(`  Paid to contributors${money(s.totalContributorPayout).padStart(10)} over 36 months`);
}

function printComparison(): void {
  console.log('\n=== SCENARIO COMPARISON ===\n');
  console.log(
    ['Scenario', 'Y1 ARR', 'Y2 ARR', 'Y3 ARR', 'Y3 paid', 'Co-op %', 'GM%', 'Peak cash', 'BE month']
      .map((h) => h.padStart(11))
      .join(''),
  );
  for (const a of [BEAR, BASE, BULL]) {
    const s = summarise(a);
    console.log(
      [
        s.name,
        money(s.y1Arr),
        money(s.y2Arr),
        money(s.y3Arr),
        count(s.y3Paid),
        `${(s.y3CoopShare * 100).toFixed(0)}%`,
        `${(s.y3GrossMargin * 100).toFixed(0)}%`,
        money(s.peakBurn),
        String(s.breakeven ?? '—'),
      ]
        .map((v) => v.padStart(11))
        .join(''),
    );
  }
  console.log(
    '\nRead the bear case first. It is the one that decides whether this is fundable:\n' +
      'if the co-op never clears k-anonymity at scale, the business is a thin analytics\n' +
      'tool competing with free open-source alternatives.\n',
  );
}

const arg = process.argv[2] ?? 'base';
if (arg === 'all') printComparison();
else if (arg === 'bear') printScenario(BEAR);
else if (arg === 'bull') printScenario(BULL);
else printScenario(BASE);

export { BASE, BEAR, BULL, run, summarise, type Assumptions, type MonthRow };
