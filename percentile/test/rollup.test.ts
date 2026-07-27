import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANY,
  activationRate,
  assignCohort,
  coarsen,
  computeMetric,
  conversionRate,
  D7_RETENTION,
  dominantBuilder,
  matchesCohort,
  narrowestReleasableCohort,
  periodFor,
  retentionRate,
  rollup,
  sizeBucketFor,
  type SubjectTimeline,
} from '../src/core/aggregate/rollup.ts';
import { cohortKeyString } from '../src/core/privacy/release-gate.ts';
import type { CleanEvent, CohortKey, WorkspaceObservation } from '../src/core/types.ts';

const DAY = 86_400_000;

/** Monday, ISO week 2026-W28. Every relative test date is an offset from here. */
const T0 = Date.parse('2026-07-06T00:00:00Z');

const at = (dayOffset: number, hours = 0): string =>
  new Date(T0 + dayOffset * DAY + hours * 3_600_000).toISOString();

let eventCounter = 0;
const ev = (over: Partial<CleanEvent> = {}): CleanEvent => ({
  workspaceId: 'ws_1',
  eventId: `evt_${eventCounter++}`,
  name: 'page_view',
  occurredAt: at(0),
  subjectKey: 'subj_1',
  properties: {},
  jurisdiction: 'US',
  country: 'US',
  builder: 'lovable',
  permittedPurposes: ['product_analytics', 'benchmark_contribution', 'coop_licensing'],
  ...over,
});

/** Build a timeline directly so window arithmetic can be tested without a full rollup. */
function timelineOf(
  subjectKey: string,
  spec: ReadonlyArray<[day: number, name: string]>,
  nowDay = 90,
): SubjectTimeline {
  const events = spec.map(([day, name]) => ev({ subjectKey, name, occurredAt: at(day) }));
  const times = events.map((e) => Date.parse(e.occurredAt));
  return {
    subjectKey,
    firstSeenMs: Math.min(...times),
    lastSeenMs: Math.max(...times),
    events,
    nowMs: T0 + nowDay * DAY,
  };
}

const CONFIG = { workspaceId: 'ws_1', vertical: 'b2b_saas' };
const ACTIVATION = activationRate({ event: 'signup_completed' });

describe('period assignment', () => {
  test('months are calendar months in UTC', () => {
    assert.equal(periodFor('2026-07-15T10:00:00Z', 'month'), '2026-07');
    assert.equal(periodFor('2026-01-01T00:00:00Z', 'month'), '2026-01');
  });

  test('ISO week-year is not the calendar year at the turn of the year', () => {
    // The trap this guards: bucketing by getUTCFullYear() scatters one week's cohort
    // across two period keys, halving its density exactly where density is scarce.
    assert.equal(periodFor('2025-12-29T00:00:00Z', 'week'), '2026-W01');
    assert.equal(periodFor('2026-01-01T00:00:00Z', 'week'), '2026-W01');
    assert.equal(periodFor('2027-01-03T00:00:00Z', 'week'), '2026-W53');
  });

  test('the week boundary is Monday 00:00 UTC', () => {
    assert.equal(periodFor('2026-07-26T23:59:59Z', 'week'), '2026-W30');
    assert.equal(periodFor('2026-07-27T00:00:00Z', 'week'), '2026-W31');
  });

  test('an unparseable timestamp throws rather than silently bucketing as NaN', () => {
    assert.throws(() => periodFor('not-a-date', 'week'), /unparseable/);
  });
});

describe('size buckets', () => {
  test('boundaries are upper-inclusive and stable', () => {
    // Stated as a test because the labels are ambiguous and the rule must never drift:
    // a workspace that flips buckets between periods loses its own trend line.
    assert.equal(sizeBucketFor(100), '1-100');
    assert.equal(sizeBucketFor(101), '100-1k');
    assert.equal(sizeBucketFor(1_000), '100-1k');
    assert.equal(sizeBucketFor(1_001), '1k-10k');
    assert.equal(sizeBucketFor(10_000), '1k-10k');
    assert.equal(sizeBucketFor(100_000), '10k-100k');
    assert.equal(sizeBucketFor(100_001), '100k+');
  });

  test('degenerate counts still yield a bucket', () => {
    assert.equal(sizeBucketFor(0), '1-100');
    assert.equal(sizeBucketFor(1), '1-100');
  });

  test('cohort assignment derives the bucket rather than trusting a caller', () => {
    const cohort = assignCohort({
      builder: 'bolt',
      vertical: 'marketplace',
      distinctSubjects: 4_200,
      period: '2026-W30',
    });
    assert.equal(cohort.sizeBucket, '1k-10k');
    assert.equal(cohort.builder, 'bolt');
    assert.equal(cohort.period, '2026-W30');
  });
});

describe('metric computation', () => {
  test('a subject counts once however many times they fire the event', () => {
    // Event-shaped metrics let one power user count fifty times and quietly ruin a cohort.
    const timelines = [
      timelineOf('a', [
        [0, 'page_view'],
        [1, 'signup_completed'],
        [2, 'signup_completed'],
        [3, 'signup_completed'],
      ]),
      timelineOf('b', [[0, 'page_view']]),
    ];
    const out = computeMetric(ACTIVATION, timelines);
    assert.deepEqual(out, { value: 0.5, subjectCount: 2 });
  });

  test('activation outside the window does not count, on the boundary it does', () => {
    const inWindow = computeMetric(ACTIVATION, [
      timelineOf('a', [
        [0, 'page_view'],
        [7, 'signup_completed'],
      ]),
    ]);
    const outOfWindow = computeMetric(ACTIVATION, [
      timelineOf('a', [
        [0, 'page_view'],
        [8, 'signup_completed'],
      ]),
    ]);
    assert.equal(inWindow?.value, 1);
    assert.equal(outOfWindow?.value, 0);
  });

  test('subjects too young to answer the metric are excluded from the denominator', () => {
    // Without this the newest period always understates: half its subjects have not
    // physically had time to come back yet, and the newest period is what people read.
    const young = timelineOf('a', [[0, 'page_view']], 3);
    assert.equal(computeMetric(ACTIVATION, [young]), null);

    const mixed = [young, timelineOf('b', [[0, 'page_view']], 3)];
    assert.equal(computeMetric(ACTIVATION, mixed), null);
  });

  test('d7 retention measures a 5-9 day window, not a single day', () => {
    const day = (d: number) =>
      computeMetric(D7_RETENTION, [
        timelineOf('a', [
          [0, 'page_view'],
          [d, 'page_view'],
        ]),
      ])?.value;
    assert.equal(day(4), 0, 'day 4 is inside the honeymoon, not retention');
    assert.equal(day(5), 1);
    assert.equal(day(9), 1);
    assert.equal(day(10), 0, 'day 10 has fallen out the far side of the window');
  });

  test('retention waits for the window to close before counting a subject at all', () => {
    const stillOpen = timelineOf('a', [[0, 'page_view']], 8);
    assert.equal(computeMetric(D7_RETENTION, [stillOpen]), null);

    const closed = timelineOf('a', [[0, 'page_view']], 10);
    assert.deepEqual(computeMetric(D7_RETENTION, [closed]), { value: 0, subjectCount: 1 });
  });

  test('conversion denominates on funnel entrants, not on all traffic', () => {
    // Denominating on all subjects would mean buying traffic that never reaches the
    // funnel improves your benchmark. It must not.
    const metric = conversionRate({ from: 'cart_opened', to: 'checkout_completed' });
    const timelines = [
      timelineOf('buyer', [
        [0, 'cart_opened'],
        [1, 'checkout_completed'],
      ]),
      timelineOf('abandoner', [[0, 'cart_opened']]),
      timelineOf('browser', [[0, 'page_view']]),
    ];
    const out = computeMetric(metric, timelines);
    assert.deepEqual(out, { value: 0.5, subjectCount: 2 }, 'the browser is not in either side');
  });

  test('conversion is directional — a later `from` does not convert an earlier `to`', () => {
    const metric = conversionRate({ from: 'cart_opened', to: 'checkout_completed' });
    const backwards = timelineOf('a', [
      [0, 'checkout_completed'],
      [1, 'cart_opened'],
    ]);
    assert.deepEqual(computeMetric(metric, [backwards]), { value: 0, subjectCount: 1 });
  });

  test('conversion honours an optional deadline', () => {
    const fast = conversionRate({ from: 'cart_opened', to: 'checkout_completed', withinDays: 2 });
    const slow = timelineOf('a', [
      [0, 'cart_opened'],
      [5, 'checkout_completed'],
    ]);
    assert.equal(computeMetric(fast, [slow])?.value, 0);
    assert.equal(
      computeMetric(conversionRate({ from: 'cart_opened', to: 'checkout_completed' }), [slow])
        ?.value,
      1,
    );
  });

  test('an empty denominator is null, never a zero', () => {
    // A published 0% is a claim about the cohort. "No data" is not the same claim.
    assert.equal(computeMetric(ACTIVATION, []), null);
  });

  test('a custom metric needs no changes here — it is just two predicates', () => {
    const powerUsers = {
      name: 'power_user_rate',
      lo: 0,
      hi: 1,
      succeeded: (t: SubjectTimeline) => t.events.length >= 3,
    };
    const out = computeMetric(powerUsers, [
      timelineOf('a', [
        [0, 'page_view'],
        [1, 'page_view'],
        [2, 'page_view'],
      ]),
      timelineOf('b', [[0, 'page_view']]),
    ]);
    assert.deepEqual(out, { value: 0.5, subjectCount: 2 });
  });
});

describe('rollup', () => {
  const NOW = at(60);

  test('an empty event set produces no observations and no phantom counters', () => {
    const out = rollup([], CONFIG, { metrics: [ACTIVATION], now: NOW });
    assert.deepEqual(out.observations, []);
    assert.equal(out.subjectsSeen, 0);
    assert.equal(out.subjectsWithoutConsent, 0);
  });

  test('a single subject yields one observation in the smallest bucket', () => {
    const out = rollup(
      [ev({ subjectKey: 's1' }), ev({ subjectKey: 's1', name: 'signup_completed', occurredAt: at(1) })],
      CONFIG,
      { metrics: [ACTIVATION], now: NOW },
    );
    assert.equal(out.observations.length, 1);
    const o = out.observations[0]!;
    assert.equal(o.metric, 'activation_rate');
    assert.equal(o.value, 1);
    assert.equal(o.subjectCount, 1);
    assert.equal(o.cohort.sizeBucket, '1-100');
    assert.equal(o.cohort.vertical, 'b2b_saas');
    assert.equal(o.cohort.period, '2026-W28');
  });

  test('subjects without benchmark consent never reach an observation', () => {
    // The load-bearing one. Nothing downstream would catch this: the release gate
    // filters workspaces, not subjects, so a leak here lands inside a dataset we sell.
    const events = [
      ev({ subjectKey: 'yes', name: 'signup_completed' }),
      ev({
        subjectKey: 'no',
        name: 'signup_completed',
        permittedPurposes: ['product_analytics'],
      }),
    ];
    const out = rollup(events, CONFIG, { metrics: [ACTIVATION], now: NOW });
    assert.equal(out.subjectsSeen, 2);
    assert.equal(out.subjectsWithoutConsent, 1);
    assert.equal(out.observations[0]!.subjectCount, 1, 'only the consenting subject is counted');
  });

  test('a subject whose consent lapses mid-period is dropped entirely, not partially', () => {
    // Consent is resolved per event at ingest, so a withdrawal looks like later events
    // losing the purpose. Counting the earlier ones would keep a withdrawn person
    // contributing to a saleable dataset.
    const events = [
      ev({ subjectKey: 'quitter', occurredAt: at(0) }),
      ev({
        subjectKey: 'quitter',
        name: 'signup_completed',
        occurredAt: at(1),
        permittedPurposes: ['product_analytics'],
      }),
    ];
    const out = rollup(events, CONFIG, { metrics: [ACTIVATION], now: NOW });
    assert.deepEqual(out.observations, []);
    assert.equal(out.subjectsWithoutConsent, 1);
  });

  test('non-consented subjects cannot push a workspace into a bigger size bucket', () => {
    // The size bucket is published as part of the cohort key, so letting excluded
    // subjects influence it would leak their existence — the same reasoning the
    // release gate applies to its own thresholds.
    const consented = Array.from({ length: 100 }, (_, i) => ev({ subjectKey: `ok_${i}` }));
    const denied = Array.from({ length: 25 }, (_, i) =>
      ev({ subjectKey: `no_${i}`, permittedPurposes: ['product_analytics'] }),
    );
    const out = rollup([...consented, ...denied], CONFIG, { metrics: [ACTIVATION], now: NOW });
    assert.equal(out.observations[0]!.cohort.sizeBucket, '1-100');
    assert.equal(out.observations[0]!.subjectCount, 100);
  });

  test('a subject stays in the period they were first seen in, even across the boundary', () => {
    // The window has to follow the person, not the calendar: otherwise "activation
    // within 7 days" means something different for a Sunday signup than a Monday one.
    const events = [
      ev({ subjectKey: 'sunday', occurredAt: '2026-07-26T23:00:00Z' }),
      ev({ subjectKey: 'sunday', name: 'signup_completed', occurredAt: '2026-07-27T01:00:00Z' }),
      ev({ subjectKey: 'monday', occurredAt: '2026-07-27T09:00:00Z' }),
    ];
    const out = rollup(events, CONFIG, {
      metrics: [ACTIVATION],
      now: '2026-09-01T00:00:00Z',
    });
    const periods = out.observations.map((o) => o.cohort.period).sort();
    assert.deepEqual(periods, ['2026-W30', '2026-W31']);

    const w30 = out.observations.find((o) => o.cohort.period === '2026-W30')!;
    assert.equal(w30.subjectCount, 1);
    assert.equal(w30.value, 1, 'the activation landed in the next week but still counts');
  });

  test('monthly granularity is available for metrics with long windows', () => {
    const out = rollup([ev({ subjectKey: 's1' })], CONFIG, {
      metrics: [ACTIVATION],
      granularity: 'month',
      now: NOW,
    });
    assert.equal(out.observations[0]!.cohort.period, '2026-07');
  });

  test('the newest subjects are not published as zeroes when no clock is supplied', () => {
    // Default reference clock is the latest event, so a cohort that has not aged past
    // the metric's window produces nothing rather than a misleading 0%.
    const out = rollup([ev({ subjectKey: 's1' })], CONFIG, { metrics: [ACTIVATION] });
    assert.deepEqual(out.observations, []);
  });

  test('a metric nobody qualified for emits no observation', () => {
    const checkout = conversionRate({ from: 'cart_opened', to: 'checkout_completed' });
    const out = rollup([ev({ subjectKey: 's1' })], CONFIG, {
      metrics: [ACTIVATION, checkout],
      now: NOW,
    });
    assert.deepEqual(
      out.observations.map((o) => o.metric),
      ['activation_rate'],
    );
  });

  test('each metric produces its own observation over the same subjects', () => {
    const events = [
      ev({ subjectKey: 's1', occurredAt: at(0) }),
      ev({ subjectKey: 's1', name: 'signup_completed', occurredAt: at(1) }),
      ev({ subjectKey: 's1', occurredAt: at(6) }),
    ];
    const out = rollup(events, CONFIG, {
      metrics: [ACTIVATION, D7_RETENTION],
      now: NOW,
    });
    assert.deepEqual(
      out.observations.map((o) => `${o.metric}=${o.value}`).sort(),
      ['activation_rate=1', 'd7_retention=1'],
    );
  });

  test('events from another workspace are dropped, not merged', () => {
    const out = rollup([ev({ subjectKey: 's1' }), ev({ workspaceId: 'ws_other', subjectKey: 'x' })], CONFIG, {
      metrics: [ACTIVATION],
      now: NOW,
    });
    assert.equal(out.foreignEventsDropped, 1);
    assert.equal(out.subjectsSeen, 1);
  });
});

describe('builder attribution', () => {
  test('a real builder tag beats an untagged majority', () => {
    // The SDK resolves builder detection asynchronously, so early events can arrive
    // untagged. Majority voting would file a slow-loading app under 'unknown' forever.
    assert.equal(
      dominantBuilder([
        ev({ builder: 'unknown' }),
        ev({ builder: 'unknown' }),
        ev({ builder: 'unknown' }),
        ev({ builder: 'bolt' }),
      ]),
      'bolt',
    );
  });

  test('with no tagged events at all the cohort is honestly unknown', () => {
    assert.equal(dominantBuilder([ev({ builder: 'unknown' })]), 'unknown');
    assert.equal(dominantBuilder([]), 'unknown');
  });

  test('a tie resolves deterministically so a cohort never oscillates', () => {
    const a = dominantBuilder([ev({ builder: 'v0' }), ev({ builder: 'bolt' })]);
    const b = dominantBuilder([ev({ builder: 'bolt' }), ev({ builder: 'v0' })]);
    assert.equal(a, b);
  });

  test('a self-declared builder in the workspace config wins over the events', () => {
    const out = rollup([ev({ subjectKey: 's1', builder: 'unknown' })], { ...CONFIG, builder: 'v0' }, {
      metrics: [ACTIVATION],
      now: at(60),
    });
    assert.equal(out.observations[0]!.cohort.builder, 'v0');
  });
});

describe('cohort coarsening', () => {
  const cohort: CohortKey = {
    builder: 'lovable',
    vertical: 'b2b_saas',
    sizeBucket: '1k-10k',
    period: '2026-W30',
  };

  const obs = (
    workspaceId: string,
    over: Partial<CohortKey> = {},
    subjectCount = 200,
  ): WorkspaceObservation => ({
    workspaceId,
    cohort: { ...cohort, ...over },
    metric: 'activation_rate',
    value: 0.2,
    subjectCount,
  });

  const many = (n: number, prefix: string, over: Partial<CohortKey> = {}) =>
    Array.from({ length: n }, (_, i) => obs(`${prefix}${i}`, over));

  test('the ladder drops builder, then size, then vertical, and terminates', () => {
    const rungs = coarsen(cohort);
    assert.deepEqual(
      rungs.map((r) => r.dropped),
      [[], ['builder'], ['builder', 'sizeBucket'], ['builder', 'sizeBucket', 'vertical']],
    );
    assert.deepEqual(
      rungs.map((r) => r.breadth),
      ['exact', 'all_builders', 'all_builders_all_sizes', 'all_ai_built_apps'],
    );
    assert.equal(rungs[0]!.cohort.builder, 'lovable', 'the first rung is the cohort itself');
    assert.equal(rungs[3]!.cohort.vertical, ANY, 'the last rung has nothing left to widen');
  });

  test('every rung is a distinct cohort key string', () => {
    // The release gate keys the privacy budget off this string. Two rungs sharing one
    // would let a broad query drain a narrow cohort's budget.
    const keys = coarsen(cohort).map((r) => cohortKeyString(r.cohort));
    assert.equal(new Set(keys).size, keys.length);
  });

  test('every rung names the group a user would be told they were compared against', () => {
    const [exact, builders, sizes, all] = coarsen(cohort);
    assert.match(exact!.label, /lovable-built b2b saas apps at 1k-10k users/);
    assert.match(builders!.label, /all AI-built b2b saas apps at 1k-10k users/);
    assert.match(sizes!.label, /of any size/);
    assert.ok(!all!.label.includes('b2b saas'), 'the broadest rung is not vertical-specific');
  });

  test('a dropped dimension stops mattering but the period never does', () => {
    const rungs = coarsen(cohort);
    const otherBuilder = { ...cohort, builder: 'bolt' as const };
    assert.equal(matchesCohort(otherBuilder, rungs[0]!), false);
    assert.equal(matchesCohort(otherBuilder, rungs[1]!), true);

    const otherPeriod = { ...cohort, period: '2026-W29' };
    assert.equal(
      matchesCohort(otherPeriod, rungs[3]!),
      false,
      'comparing across periods would be a different claim entirely',
    );
  });

  test('the exact cohort is used when it clears, and the fallback flag stays false', () => {
    const res = narrowestReleasableCohort(cohort, many(12, 'w'));
    assert.equal(res.resolved, true);
    if (!res.resolved) return;
    assert.equal(res.widened, false);
    assert.equal(res.cohort.breadth, 'exact');
    assert.equal(res.verdict.ok && res.verdict.contributorCount, 12);
    assert.match(res.disclosure, /lovable-built/);
    assert.ok(!/broader group/.test(res.disclosure));
  });

  test('a thin cohort widens by one rung and says so out loud', () => {
    // A benchmark against a broader cohort beats no benchmark — but only if the user is
    // told which cohort it actually was. Silence here is a false claim about peers.
    const pool = [...many(3, 'lov'), ...many(12, 'bolt', { builder: 'bolt' })];
    const res = narrowestReleasableCohort(cohort, pool);
    assert.equal(res.resolved, true);
    if (!res.resolved) return;
    assert.equal(res.widened, true);
    assert.equal(res.cohort.breadth, 'all_builders');
    assert.deepEqual(res.cohort.dropped, ['builder']);
    assert.equal(res.observations.length, 15);
    assert.match(res.disclosure, /too small to publish safely/);
    assert.match(res.disclosure, /all AI-built b2b saas apps at 1k-10k users/);
  });

  test('it keeps widening only as far as it must', () => {
    const pool = [
      ...many(3, 'lov'),
      ...many(2, 'bolt', { builder: 'bolt' }),
      ...many(14, 'small', { builder: 'v0', sizeBucket: '100-1k' }),
      ...many(30, 'other_vertical', { vertical: 'marketplace' }),
    ];
    const res = narrowestReleasableCohort(cohort, pool);
    assert.equal(res.resolved, true);
    if (!res.resolved) return;
    assert.equal(res.cohort.breadth, 'all_builders_all_sizes');
    assert.ok(
      res.observations.every((o) => o.cohort.vertical === 'b2b_saas'),
      'vertical is the last thing we give up, so it must still hold here',
    );
  });

  test('the broadest rung is reached only when nothing narrower works', () => {
    const pool = [
      ...many(4, 'lov'),
      ...many(20, 'mkt', { vertical: 'marketplace', builder: 'bolt', sizeBucket: '100-1k' }),
    ];
    const res = narrowestReleasableCohort(cohort, pool);
    assert.equal(res.resolved, true);
    if (!res.resolved) return;
    assert.equal(res.cohort.breadth, 'all_ai_built_apps');
    assert.equal(res.widened, true);
    assert.equal(res.attempts.length, 4, 'all four rungs were tried in order');
  });

  test('when even the broadest cohort is too thin it refuses, with the gap to close', () => {
    const res = narrowestReleasableCohort(cohort, many(3, 'w'));
    assert.equal(res.resolved, false);
    if (res.resolved) return;
    assert.equal(res.attempts.length, 4);
    assert.deepEqual(
      res.attempts.map((a) => a.breadth),
      ['exact', 'all_builders', 'all_builders_all_sizes', 'all_ai_built_apps'],
    );
    // The shortfall reported is the broadest rung's — the one most likely to unlock —
    // which is what turns a suppression into "3 more apps unlocks this".
    assert.match(res.explanation, /7 more comparable app/);
  });

  test('observations from another period never rescue a cohort at any breadth', () => {
    const res = narrowestReleasableCohort(cohort, many(40, 'w', { period: '2026-W29' }));
    assert.equal(res.resolved, false);
    if (res.resolved) return;
    assert.ok(res.attempts.every((a) => a.verdict.contributorCount === 0));
  });

  test('non-eligible workspaces cannot prop a rung over the threshold', () => {
    // Mirrors the release gate's own invariant: if the walk counts rows the gate will
    // later drop, the benchmark flickers in and out for reasons nobody can explain.
    const consenting = new Set(['w0', 'w1', 'w2']);
    const res = narrowestReleasableCohort(cohort, many(30, 'w'), {
      eligible: (o) => consenting.has(o.workspaceId),
    });
    assert.equal(res.resolved, false);
    if (res.resolved) return;
    assert.equal(res.attempts[0]!.verdict.ok, false);
    assert.equal(res.attempts[0]!.verdict.contributorCount, 3);
  });

  test('thresholds are configuration, not architecture', () => {
    // docs/08-risks.md leans on being able to raise k without a rewrite; the walk has to
    // honour a raised k the same way the gate does.
    const pool = many(12, 'w');
    assert.equal(narrowestReleasableCohort(cohort, pool).resolved, true);
    assert.equal(
      narrowestReleasableCohort(cohort, pool, { minContributors: 20 }).resolved,
      false,
    );
  });

  test('the rollup output feeds the ladder without translation', () => {
    // End to end: the two halves of this file have to agree on the cohort shape, or the
    // pipeline stage this module exists to fill has a seam in the middle of it.
    const events = Array.from({ length: 40 }, (_, i) => [
      ev({ subjectKey: `s${i}`, occurredAt: at(0) }),
      ev({ subjectKey: `s${i}`, name: 'signup_completed', occurredAt: at(1) }),
    ]).flat();
    const mine = rollup(events, CONFIG, { metrics: [ACTIVATION], now: at(60) });
    assert.equal(mine.observations.length, 1);

    const own = mine.observations[0]!;
    const peers = Array.from({ length: 11 }, (_, i) => ({
      ...own,
      workspaceId: `peer_${i}`,
      subjectCount: 60,
    }));
    const res = narrowestReleasableCohort(own.cohort, [own, ...peers]);
    assert.equal(res.resolved, true);
    if (!res.resolved) return;
    assert.equal(res.cohort.breadth, 'exact');
    assert.equal(res.verdict.ok && res.verdict.contributorCount, 12);
  });
});
