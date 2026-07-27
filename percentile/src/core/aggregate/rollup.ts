/**
 * Rollup: CleanEvent[] -> WorkspaceObservation[].
 *
 * This is the missing middle of the pipeline. `ingest.ts` produces clean events, the
 * release gate consumes workspace observations, and everything between the two lives here:
 * metric computation, cohort assignment, and the coarsening ladder that decides which
 * cohort a thin app is actually compared against.
 *
 * It is the thesis-critical stage. docs/08-risks.md ranks "cohorts never reach density" as
 * the risk that decides whether the company exists at all, and cohort assignment is the
 * only lever on density that does not require more customers. Coarsening is that lever: an
 * app told "here is how you compare to all AI-built B2B SaaS" learns something and stays;
 * an app told "not enough data" churns.
 *
 * Two rules are load-bearing; the rest of this file is detail.
 *
 *   1. Only subjects carrying `benchmark_contribution` may reach an observation. An
 *      observation is bound for the co-op plane, and nothing downstream would catch a
 *      mistake here — the release gate filters *workspaces*, not subjects. Getting this
 *      wrong silently puts non-consented people into a dataset we sell.
 *   2. A coarsened comparison must never be presented as an exact one. Widening the cohort
 *      is good product; hiding that we widened it is a lie about what the number means, and
 *      it is the kind of lie a buyer's compliance team would find.
 */

import type {
  BuilderTag,
  CleanEvent,
  CohortKey,
  ConsentPurpose,
  SizeBucket,
  SubjectKey,
  WorkspaceId,
  WorkspaceObservation,
} from '../types.ts';
import {
  checkKAnonymity,
  explainSuppression,
  type KAnonymityVerdict,
} from '../privacy/k-anonymity.ts';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** Benchmarks are weekly by default; monthly exists for metrics with long windows. */
export type PeriodGranularity = 'week' | 'month';

/**
 * Bucket a timestamp into a period label: '2026-W30' or '2026-07'.
 *
 * ISO week-*year* is not the calendar year, and the difference is not cosmetic: events on
 * 2025-12-29 belong to 2026-W01. Getting that wrong scatters a single week's cohort across
 * two period keys, which halves its density exactly when density is what we are short of.
 */
export function periodFor(occurredAt: string, granularity: PeriodGranularity): string {
  const parsed = new Date(occurredAt);
  const ms = parsed.getTime();
  if (Number.isNaN(ms)) throw new Error(`rollup: unparseable timestamp ${occurredAt}`);

  if (granularity === 'month') {
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    return `${parsed.getUTCFullYear()}-${month}`;
  }

  // Shift to the Thursday of this week; the ISO week-year is whatever year that lands in.
  const thursday = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);

  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);

  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Size buckets
// ---------------------------------------------------------------------------

/**
 * Bucket a distinct-subject count.
 *
 * Boundaries are upper-inclusive: exactly 100 subjects is '1-100', exactly 1,000 is
 * '100-1k'. The labels are ambiguous either way, so the rule is chosen and then written
 * down, because the cost of it being *unstable* is much higher than the cost of it being
 * arbitrary — a workspace that flips buckets between periods loses its own trend line and
 * gets compared against a different set of peers for no reason it can see.
 */
export function sizeBucketFor(distinctSubjects: number): SizeBucket {
  if (distinctSubjects <= 100) return '1-100';
  if (distinctSubjects <= 1_000) return '100-1k';
  if (distinctSubjects <= 10_000) return '1k-10k';
  if (distinctSubjects <= 100_000) return '10k-100k';
  return '100k+';
}

// ---------------------------------------------------------------------------
// Subject timelines and metric definitions
// ---------------------------------------------------------------------------

/**
 * One subject's behaviour, which is the unit every metric here is defined over.
 *
 * Metrics are deliberately subject-shaped rather than event-shaped: every benchmark we sell
 * is "what share of people did X", and an event-shaped metric silently lets one power user
 * count fifty times.
 */
export interface SubjectTimeline {
  subjectKey: SubjectKey;
  firstSeenMs: number;
  lastSeenMs: number;
  /** Ascending by time. */
  events: readonly CleanEvent[];
  /** The rollup's reference clock, used for the maturity check below. */
  nowMs: number;
}

/** Whole days elapsed between a subject's first event and some later moment. */
export function dayIndex(timeline: SubjectTimeline, atMs: number): number {
  return Math.floor((atMs - timeline.firstSeenMs) / DAY_MS);
}

/** Epoch ms of the earliest occurrence of `eventName`, or null. */
export function firstOccurrenceMs(timeline: SubjectTimeline, eventName: string): number | null {
  for (const e of timeline.events) {
    if (e.name === eventName) return Date.parse(e.occurredAt);
  }
  return null;
}

/**
 * A metric is a numerator predicate over a denominator predicate, both evaluated per
 * subject. That is the whole abstraction, and stopping there is intentional: a metric DSL
 * would be more expressive and would also become an unauditable way to define new things
 * we sell. Anything more exotic than "share of people who did X" gets written as code and
 * reviewed like code.
 */
export interface MetricDefinition {
  name: string;
  /** Public domain bounds, matching `MetricSpec` so this can be handed to the gate as-is. */
  lo: number;
  hi: number;
  /**
   * Days of observation a subject needs before they can answer this metric at all.
   * Without it the most recent period always understates retention, because half its
   * subjects have not physically had time to come back yet — and an understated trend in
   * the newest period is the number a developer looks at first.
   */
  maturityDays?: number;
  /** Denominator. Defaults to every mature subject. */
  qualifies?: (t: SubjectTimeline) => boolean;
  /** Numerator, evaluated only over qualifying subjects. */
  succeeded: (t: SubjectTimeline) => boolean;
}

export interface MetricValue {
  value: number;
  /** Denominator size — the distinct subjects the value stands on, which is what k needs. */
  subjectCount: number;
}

/** Returns null when nobody qualifies. A metric with an empty denominator is not a zero. */
export function computeMetric(
  def: MetricDefinition,
  timelines: readonly SubjectTimeline[],
): MetricValue | null {
  const maturityMs = (def.maturityDays ?? 0) * DAY_MS;
  const mature = timelines.filter((t) => t.nowMs - t.firstSeenMs >= maturityMs);
  const denominator = def.qualifies ? mature.filter((t) => def.qualifies!(t)) : mature;
  if (denominator.length === 0) return null;

  const numerator = denominator.filter((t) => def.succeeded(t)).length;
  return { value: numerator / denominator.length, subjectCount: denominator.length };
}

/**
 * Share of subjects who fired `event` within `withinDays` of first being seen.
 *
 * This is the headline number of the whole product — the sentence in benchmarks.ts is about
 * activation — so it is defined once, here, and every workspace's version of it means the
 * same thing. A per-workspace definition of "activated" would make the cohort comparison
 * meaningless while still looking like it worked.
 */
export function activationRate(opts: {
  event: string;
  withinDays?: number;
  name?: string;
}): MetricDefinition {
  const withinDays = opts.withinDays ?? 7;
  return {
    name: opts.name ?? 'activation_rate',
    lo: 0,
    hi: 1,
    maturityDays: withinDays,
    succeeded: (t) => {
      const at = firstOccurrenceMs(t, opts.event);
      return at !== null && at - t.firstSeenMs <= withinDays * DAY_MS;
    },
  };
}

/**
 * Share of subjects seen again in a day window after first sight.
 *
 * The window is a range, not a single day: "came back on exactly day 7" is a coin flip
 * about weekday habits, whereas days 5-9 measures whether the product stuck.
 */
export function retentionRate(opts: {
  fromDay: number;
  toDay: number;
  name?: string;
}): MetricDefinition {
  return {
    name: opts.name ?? `d${opts.toDay}_retention`,
    lo: 0,
    hi: 1,
    // A subject cannot answer this until the window has closed for them.
    maturityDays: opts.toDay + 1,
    succeeded: (t) =>
      t.events.some((e) => {
        const day = dayIndex(t, Date.parse(e.occurredAt));
        return day >= opts.fromDay && day <= opts.toDay;
      }),
  };
}

/**
 * Share of subjects who fired `from` and then went on to fire `to`.
 *
 * The denominator is subjects who entered the funnel, not all subjects — otherwise adding
 * traffic that never reaches the funnel silently deflates the rate, and the benchmark
 * rewards apps for having fewer visitors.
 */
export function conversionRate(opts: {
  from: string;
  to: string;
  withinDays?: number;
  name?: string;
}): MetricDefinition {
  return {
    name: opts.name ?? `${opts.from}_to_${opts.to}_conversion`,
    lo: 0,
    hi: 1,
    maturityDays: opts.withinDays,
    qualifies: (t) => firstOccurrenceMs(t, opts.from) !== null,
    succeeded: (t) => {
      const start = firstOccurrenceMs(t, opts.from);
      if (start === null) return false;
      const end = firstOccurrenceMsAfter(t, opts.to, start);
      if (end === null) return false;
      return opts.withinDays === undefined || end - start <= opts.withinDays * DAY_MS;
    },
  };
}

/** Conversion is directional: a `to` that happened before the `from` is not a conversion. */
function firstOccurrenceMsAfter(
  timeline: SubjectTimeline,
  eventName: string,
  afterMs: number,
): number | null {
  for (const e of timeline.events) {
    if (e.name !== eventName) continue;
    const at = Date.parse(e.occurredAt);
    if (at >= afterMs) return at;
  }
  return null;
}

/** The starter set every workspace gets, so cohorts have something in common on day one. */
export const D7_RETENTION: MetricDefinition = retentionRate({
  name: 'd7_retention',
  fromDay: 5,
  toDay: 9,
});

// ---------------------------------------------------------------------------
// Cohort assignment
// ---------------------------------------------------------------------------

/** Configuration the events cannot tell us. Supplied by the workspace, not inferred. */
export interface WorkspaceConfig {
  workspaceId: WorkspaceId;
  /** e.g. 'b2b_saas'. Behaviour cannot reveal this, so the developer declares it. */
  vertical: string;
  /** Set only when the workspace self-declared; otherwise derived from the events. */
  builder?: BuilderTag;
}

export function assignCohort(input: {
  builder: BuilderTag;
  vertical: string;
  distinctSubjects: number;
  period: string;
}): CohortKey {
  return {
    builder: input.builder,
    vertical: input.vertical,
    sizeBucket: sizeBucketFor(input.distinctSubjects),
    period: input.period,
  };
}

/**
 * Pick the builder for a set of events.
 *
 * One app has one builder, so a mixed set means some events were tagged and some were not
 * — the SDK's detection resolves asynchronously and early events can miss it. A real tag
 * therefore beats 'unknown' regardless of counts; otherwise a slow-loading app would land
 * in the untagged cohort and never be comparable to its actual peers.
 */
export function dominantBuilder(events: readonly CleanEvent[]): BuilderTag {
  const counts = new Map<BuilderTag, number>();
  for (const e of events) counts.set(e.builder, (counts.get(e.builder) ?? 0) + 1);

  let best: BuilderTag = 'unknown';
  let bestCount = -1;
  for (const [builder, count] of counts) {
    if (builder === 'unknown') continue;
    // Lexical tie-break so the same input always produces the same cohort.
    if (count > bestCount || (count === bestCount && builder < best)) {
      best = builder;
      bestCount = count;
    }
  }
  return bestCount === -1 ? 'unknown' : best;
}

// ---------------------------------------------------------------------------
// Cohort coarsening
// ---------------------------------------------------------------------------

/**
 * The value a widened dimension carries.
 *
 * A coarsened cohort has to stay a `CohortKey`, because the release gate, the privacy
 * budget key and the revenue-share cohort string all take one — widening `SizeBucket`
 * itself would change a type half the codebase depends on. So the wildcard is a reserved
 * value instead, narrowed back in exactly one place (`asCohortKey`) where it can be
 * audited. 'any' is reserved: a workspace may not declare it as a vertical.
 */
export const ANY = 'any';

export interface CoarseCohortKey {
  builder: BuilderTag | typeof ANY;
  vertical: string;
  sizeBucket: SizeBucket | typeof ANY;
  period: string;
}

export type CohortDimension = 'builder' | 'sizeBucket' | 'vertical';

export type CohortBreadth =
  | 'exact'
  | 'all_builders'
  | 'all_builders_all_sizes'
  | 'all_ai_built_apps';

/**
 * Drop order, and it is not arbitrary.
 *
 * Builder goes first because it is the least behaviourally predictive dimension — a
 * Lovable B2B SaaS and a Bolt B2B SaaS convert far more alike than a B2B SaaS and a
 * marketplace do. Size goes second. Vertical goes last, because comparing a marketplace's
 * activation to a consumer social app's is close to comparing nothing, and a benchmark
 * nobody believes is worse than a suppression that at least reads as honest.
 */
const COARSENING_ORDER: readonly CohortDimension[] = ['builder', 'sizeBucket', 'vertical'];

const BREADTH_BY_DEPTH: readonly CohortBreadth[] = [
  'exact',
  'all_builders',
  'all_builders_all_sizes',
  'all_ai_built_apps',
];

export interface CoarsenedCohort {
  /** Still a `CohortKey`, so it can be handed straight to the release gate. */
  cohort: CohortKey;
  breadth: CohortBreadth;
  /** Dimensions widened away, in drop order. Empty means this is the exact cohort. */
  dropped: readonly CohortDimension[];
  /** What the user must be told they were compared against. */
  label: string;
}

/** Narrow the wildcard back to `CohortKey`. The only cast in this file, on purpose. */
export function asCohortKey(c: CoarseCohortKey): CohortKey {
  return {
    builder: c.builder as BuilderTag,
    vertical: c.vertical,
    sizeBucket: c.sizeBucket as SizeBucket,
    period: c.period,
  };
}

/**
 * The coarsening ladder, narrowest first, always terminating at 'all_ai_built_apps'.
 *
 * Every rung produces a distinct `cohortKeyString`, which matters more than it looks: the
 * release gate keys the privacy budget off that string, so two rungs sharing a key would
 * let a broad query drain a narrow cohort's budget.
 */
export function coarsen(cohort: CohortKey): CoarsenedCohort[] {
  const rungs: CoarsenedCohort[] = [];

  for (let depth = 0; depth <= COARSENING_ORDER.length; depth++) {
    const dropped = COARSENING_ORDER.slice(0, depth);
    const widened: CoarseCohortKey = {
      builder: dropped.includes('builder') ? ANY : cohort.builder,
      vertical: dropped.includes('vertical') ? ANY : cohort.vertical,
      sizeBucket: dropped.includes('sizeBucket') ? ANY : cohort.sizeBucket,
      period: cohort.period,
    };
    const breadth = BREADTH_BY_DEPTH[depth]!;
    rungs.push({
      cohort: asCohortKey(widened),
      breadth,
      dropped,
      label: describeBreadth(cohort, dropped),
    });
  }

  return rungs;
}

function describeBreadth(cohort: CohortKey, dropped: readonly CohortDimension[]): string {
  const vertical = dropped.includes('vertical')
    ? 'apps'
    : `${cohort.vertical.replace(/_/g, ' ')} apps`;
  const builder = dropped.includes('builder') ? 'all AI-built' : `${cohort.builder}-built`;
  const size = dropped.includes('sizeBucket') ? 'of any size' : `at ${cohort.sizeBucket} users`;
  return `${builder} ${vertical} ${size}`;
}

/** True when an observation belongs in a rung — dropped dimensions simply stop mattering. */
export function matchesCohort(observed: CohortKey, rung: CoarsenedCohort): boolean {
  if (observed.period !== rung.cohort.period) return false;
  if (!rung.dropped.includes('builder') && observed.builder !== rung.cohort.builder) return false;
  if (!rung.dropped.includes('vertical') && observed.vertical !== rung.cohort.vertical) return false;
  if (!rung.dropped.includes('sizeBucket') && observed.sizeBucket !== rung.cohort.sizeBucket) {
    return false;
  }
  return true;
}

export interface CohortAttempt {
  breadth: CohortBreadth;
  cohort: CohortKey;
  label: string;
  verdict: KAnonymityVerdict;
}

export type CohortResolution =
  | {
      resolved: true;
      cohort: CoarsenedCohort;
      /** The observations that actually back the comparison. */
      observations: WorkspaceObservation[];
      verdict: KAnonymityVerdict;
      /**
       * True when the exact cohort was too thin and we widened. Callers must surface this;
       * a broader benchmark presented as an exact one is a false claim about peers.
       */
      widened: boolean;
      /** Ready-to-show sentence naming the cohort actually used. */
      disclosure: string;
      attempts: readonly CohortAttempt[];
    }
  | {
      resolved: false;
      /** Every rung and why it failed — this is where "3 more apps unlocks this" comes from. */
      attempts: readonly CohortAttempt[];
      explanation: string;
    };

/**
 * Walk the ladder and return the narrowest cohort that clears k-anonymity.
 *
 * `eligible` mirrors the release gate's consent filter and defaults to letting everything
 * through. It exists because the two must agree: if the walk counts observations the gate
 * will later drop, it hands back a cohort that then gets suppressed, and the user sees a
 * benchmark flicker in and out for reasons nobody can explain.
 */
export function narrowestReleasableCohort(
  cohort: CohortKey,
  observations: readonly WorkspaceObservation[],
  opts: {
    eligible?: (o: WorkspaceObservation) => boolean;
    minContributors?: number;
    minSubjects?: number;
    maxContributorShare?: number;
  } = {},
): CohortResolution {
  const eligible = opts.eligible ?? (() => true);
  const pool = observations.filter(eligible);
  const attempts: CohortAttempt[] = [];

  for (const rung of coarsen(cohort)) {
    const matched = pool.filter((o) => matchesCohort(o.cohort, rung));
    const verdict = checkKAnonymity(matched, {
      minContributors: opts.minContributors,
      minSubjects: opts.minSubjects,
      maxContributorShare: opts.maxContributorShare,
    });
    attempts.push({ breadth: rung.breadth, cohort: rung.cohort, label: rung.label, verdict });

    if (verdict.ok) {
      const widened = rung.dropped.length > 0;
      return {
        resolved: true,
        cohort: rung,
        observations: matched,
        verdict,
        widened,
        disclosure: widened
          ? `Your exact cohort (${describeBreadth(cohort, [])}) is too small to publish safely, ` +
            `so this compares you against ${rung.label} — a broader group than yours.`
          : `Compared against ${rung.label}.`,
        attempts,
      };
    }
  }

  // The broadest rung is the one most likely to unlock first, so its shortfall is the
  // honest call to action rather than the exact cohort's much larger one.
  const broadest = attempts[attempts.length - 1]!;
  return {
    resolved: false,
    attempts,
    explanation: explainSuppression(broadest.verdict) ?? 'Suppressed.',
  };
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

export interface RollupOptions {
  metrics: readonly MetricDefinition[];
  /** Defaults to ISO week — benchmarks are weekly, see docs/03-architecture.md. */
  granularity?: PeriodGranularity;
  /** Purpose a subject must carry. Defaults to the co-op contribution purpose. */
  purpose?: ConsentPurpose;
  /** Reference clock for maturity. Defaults to the latest event in the batch. */
  now?: string;
}

export interface RollupResult {
  observations: WorkspaceObservation[];
  /** Distinct subjects seen. First-party only — never published, never leaves this plane. */
  subjectsSeen: number;
  /** Distinct subjects held out for lack of the required purpose. */
  subjectsWithoutConsent: number;
  /** Events belonging to another workspace. Always zero unless something upstream is wrong. */
  foreignEventsDropped: number;
}

/**
 * Roll a workspace's clean events into observations, one per (period, metric).
 *
 * A subject is attributed to the period they were *first seen* in, not the period each
 * event falls in. That is what makes "activation within 7 days" and "retention on day 7"
 * mean anything: the window has to follow the person, not the calendar. The practical
 * consequence is that a subject first seen at 23:59 on Sunday stays in that week even
 * though every subsequent event lands in the next one.
 */
export function rollup(
  events: readonly CleanEvent[],
  config: WorkspaceConfig,
  opts: RollupOptions,
): RollupResult {
  const granularity = opts.granularity ?? 'week';
  const purpose: ConsentPurpose = opts.purpose ?? 'benchmark_contribution';

  const own: CleanEvent[] = [];
  let foreignEventsDropped = 0;
  for (const e of events) {
    if (e.workspaceId === config.workspaceId) own.push(e);
    else foreignEventsDropped++;
  }

  const bySubject = new Map<SubjectKey, CleanEvent[]>();
  for (const e of own) {
    const bucket = bySubject.get(e.subjectKey);
    if (bucket) bucket.push(e);
    else bySubject.set(e.subjectKey, [e]);
  }

  const nowMs = opts.now
    ? Date.parse(opts.now)
    : own.reduce((max, e) => Math.max(max, Date.parse(e.occurredAt)), 0);

  // Consent filter, and it is deliberately unanimous: a subject counts only if *every*
  // event we hold for them carries the purpose. Consent is resolved per event at ingest,
  // so a withdrawal shows up as later events losing the purpose — and a subject who
  // withdrew must not still be contributing through their earlier events. The same rule
  // costs us a subject who granted consent midway through a period; they come back next
  // period, which is the right way to be wrong about this.
  const timelines: SubjectTimeline[] = [];
  let subjectsWithoutConsent = 0;

  for (const [subjectKey, subjectEvents] of bySubject) {
    if (!subjectEvents.every((e) => e.permittedPurposes.includes(purpose))) {
      subjectsWithoutConsent++;
      continue;
    }
    const sorted = [...subjectEvents].sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
    );
    timelines.push({
      subjectKey,
      firstSeenMs: Date.parse(sorted[0]!.occurredAt),
      lastSeenMs: Date.parse(sorted[sorted.length - 1]!.occurredAt),
      events: sorted,
      nowMs,
    });
  }

  const byPeriod = new Map<string, SubjectTimeline[]>();
  for (const t of timelines) {
    const period = periodFor(new Date(t.firstSeenMs).toISOString(), granularity);
    const bucket = byPeriod.get(period);
    if (bucket) bucket.push(t);
    else byPeriod.set(period, [t]);
  }

  const observations: WorkspaceObservation[] = [];
  for (const [period, cohortSubjects] of byPeriod) {
    const periodEvents = cohortSubjects.flatMap((t) => t.events);

    // Size is derived from consented subjects only. The release gate refuses to let
    // non-consented rows influence its thresholds because their existence would leak;
    // the same reasoning applies one stage earlier, since the size bucket is published
    // as part of the cohort key.
    const cohort = assignCohort({
      builder: config.builder ?? dominantBuilder(periodEvents),
      vertical: config.vertical,
      distinctSubjects: cohortSubjects.length,
      period,
    });

    for (const def of opts.metrics) {
      const computed = computeMetric(def, cohortSubjects);
      if (computed === null) continue;
      observations.push({
        workspaceId: config.workspaceId,
        cohort,
        metric: def.name,
        value: computed.value,
        subjectCount: computed.subjectCount,
      });
    }
  }

  return {
    observations,
    subjectsSeen: bySubject.size,
    subjectsWithoutConsent,
    foreignEventsDropped,
  };
}
