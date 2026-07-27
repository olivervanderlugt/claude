import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ingest } from '../src/core/ingest.ts';
import { ConsentLedger } from '../src/core/consent.ts';
import { deriveConsentAnchor } from '../src/core/identity.ts';
import { compare, percentileRank } from '../src/core/aggregate/benchmarks.ts';
import { settle } from '../src/core/monetization/revenue-share.ts';
import type { AggregateRelease, RawEvent } from '../src/core/types.ts';

const IDENTITY = { rootSecret: 'y'.repeat(48) };

function grantAll(ledger: ConsentLedger, workspaceId: string, subjectKey: string) {
  for (const purpose of ['product_analytics', 'benchmark_contribution', 'coop_licensing'] as const) {
    ledger.append({
      workspaceId,
      subjectKey,
      purpose,
      state: 'granted',
      source: 'explicit_ui',
      recordedAt: '2026-07-01T00:00:00Z',
      jurisdiction: 'EU',
      noticeVersion: 'v1',
    });
  }
}

const rawEvent = (over: Partial<RawEvent> = {}): RawEvent => ({
  workspaceId: 'ws_1',
  eventId: 'evt_1',
  name: 'signup_completed',
  occurredAt: '2026-07-15T10:00:00Z',
  identifier: 'device_abc',
  properties: { plan: 'pro' },
  context: { jurisdiction: 'US', builder: 'lovable' },
  ...over,
});

describe('ingest', () => {
  test('accepts a well-formed event under US defaults', () => {
    const out = ingest(rawEvent(), { identity: IDENTITY, ledger: new ConsentLedger() });
    assert.equal(out.accepted, true);
    if (!out.accepted) return;
    assert.equal(out.event.builder, 'lovable');
    assert.equal(out.event.properties.plan, 'pro');
    assert.notEqual(out.event.subjectKey, 'device_abc', 'raw identifier must never survive');
  });

  test('rejects EU traffic that has not consented', () => {
    // EU product_analytics default is 'unknown' — fail closed until a signal arrives.
    const out = ingest(rawEvent({ context: { jurisdiction: 'EU', builder: 'bolt' } }), {
      identity: IDENTITY,
      ledger: new ConsentLedger(),
    });
    assert.equal(out.accepted, false);
    assert.equal(out.accepted === false && out.reason, 'no_analytics_consent');
  });

  test('accepts EU traffic once consent is on the ledger', () => {
    const ledger = new ConsentLedger();
    // Consent is keyed on the stable anchor, not the rotating subjectKey. This test
    // previously granted against probe.event.subjectKey, which encoded the old keying —
    // the one that let withdrawals expire at the next epoch. See consent-durability.test.ts.
    grantAll(ledger, 'ws_1', deriveConsentAnchor(IDENTITY, 'ws_1', 'device_abc'));
    const out = ingest(rawEvent({ context: { jurisdiction: 'EU' } }), { identity: IDENTITY, ledger });
    assert.equal(out.accepted, true);
    if (!out.accepted) return;
    assert.deepEqual(out.event.permittedPurposes, [
      'product_analytics',
      'benchmark_contribution',
      'coop_licensing',
    ]);
  });

  test('scrubs PII a generated app leaked into properties', () => {
    const out = ingest(
      rawEvent({ properties: { user_email: 'ada@example.com', note: 'ping me at ada@example.com' } }),
      { identity: IDENTITY, ledger: new ConsentLedger() },
    );
    assert.equal(out.accepted, true);
    if (!out.accepted) return;
    assert.equal(out.event.properties.user_email, undefined);
    assert.ok(!(out.event.properties.note as string).includes('ada@example.com'));
    assert.ok(out.findings.length >= 2, 'the developer must be told what we dropped');
  });

  test('rejects malformed events instead of guessing', () => {
    const cases: Array<[Partial<RawEvent>, string]> = [
      [{ name: 'has spaces and $ymbols' }, 'invalid_event_name'],
      [{ occurredAt: 'not-a-date' }, 'invalid_timestamp'],
      [{ identifier: '' }, 'missing_identifier'],
      [{ eventId: '' }, 'missing_event_id'],
    ];
    for (const [over, expected] of cases) {
      const out = ingest(rawEvent(over), { identity: IDENTITY, ledger: new ConsentLedger() });
      assert.equal(out.accepted, false, `${expected} should have been rejected`);
      assert.equal(out.accepted === false && out.reason, expected);
    }
  });

  test('an unrecognised builder tag is normalised, not trusted', () => {
    const out = ingest(
      rawEvent({ context: { jurisdiction: 'US', builder: 'evil-injected' as never } }),
      { identity: IDENTITY, ledger: new ConsentLedger() },
    );
    assert.equal(out.accepted, true);
    if (!out.accepted) return;
    assert.equal(out.event.builder, 'unknown');
  });
});

describe('benchmarks', () => {
  const release: AggregateRelease = {
    cohort: { builder: 'lovable', vertical: 'b2b_saas', sizeBucket: '1k-10k', period: '2026-W30' },
    metric: 'activation_rate',
    contributorCount: 42,
    subjectCount: 18_400,
    percentiles: { p10: 0.06, p25: 0.12, p50: 0.22, p75: 0.34, p90: 0.48 },
    mean: 0.24,
    epsilonSpent: 0.1,
    provenanceHash: 'abc',
  };

  test('percentile rank interpolates between published points', () => {
    assert.equal(percentileRank(release, 0.22), 50);
    assert.ok(percentileRank(release, 0.14) > 25 && percentileRank(release, 0.14) < 50);
    assert.equal(percentileRank(release, 0.01), 10, 'clamps below the floor');
    assert.equal(percentileRank(release, 0.99), 90, 'clamps above the ceiling');
  });

  test('produces the sentence the product is actually selling', () => {
    const c = compare(release, 0.14, {
      label: '7-day activation rate',
      format: (v) => `${(v * 100).toFixed(0)}%`,
      volume: 4000,
    });
    assert.equal(c.direction, 'behind');
    assert.ok(c.narrative.includes('14%'));
    assert.ok(c.narrative.includes('22%'));
    assert.ok(c.narrative.includes('42 comparable apps'));
    assert.ok(/worth about [\d,]+ more per month/.test(c.narrative), c.narrative);
  });

  test('lower-is-better metrics invert the ranking', () => {
    const churn: AggregateRelease = { ...release, metric: 'monthly_churn' };
    const good = compare(churn, 0.08, { label: 'monthly churn', lowerIsBetter: true });
    assert.equal(good.direction, 'ahead', 'low churn is good');
    assert.ok(good.percentileRank > 50, 'a good result must read as a high percentile');
  });
});

describe('co-op revenue share', () => {
  const deal = {
    dealId: 'deal_1',
    grossCents: 1_000_000,
    directCostCents: 100_000,
    cohortKeys: ['lovable|b2b_saas|1k-10k|2026-W30'],
  };

  test('splits the pool by contributed subjects and reconciles exactly', () => {
    const contributions = [
      { workspaceId: 'w1', cohortKey: deal.cohortKeys[0]!, subjectCount: 600 },
      { workspaceId: 'w2', cohortKey: deal.cohortKeys[0]!, subjectCount: 300 },
      { workspaceId: 'w3', cohortKey: deal.cohortKeys[0]!, subjectCount: 100 },
    ];
    const s = settle(deal, contributions);

    assert.equal(s.netCents, 900_000);
    assert.equal(s.poolCents, 270_000, '30% of net');

    const paid = s.payouts.reduce((a, p) => a + p.amountCents, 0);
    assert.equal(paid, s.poolCents, 'payouts must sum exactly to the pool — no drift');
    assert.equal(s.netCents, s.platformCents + paid, 'the ledger must reconcile');
    assert.equal(s.payouts[0]!.workspaceId, 'w1');
    assert.equal(s.payouts[0]!.amountCents, 162_000);
  });

  test('ignores contributions to cohorts outside the deal', () => {
    const s = settle(deal, [
      { workspaceId: 'w1', cohortKey: deal.cohortKeys[0]!, subjectCount: 100 },
      { workspaceId: 'w2', cohortKey: 'some|other|cohort|2026-W30', subjectCount: 900 },
    ]);
    assert.equal(s.payouts.length, 1);
    assert.equal(s.payouts[0]!.workspaceId, 'w1');
    assert.equal(s.payouts[0]!.amountCents, s.poolCents, 'sole contributor takes the pool');
  });

  test('rounding remainders never vanish', () => {
    // Three-way split of an indivisible pool: largest-remainder must still reconcile.
    const s = settle(
      { ...deal, grossCents: 1_001, directCostCents: 0 },
      [
        { workspaceId: 'a', cohortKey: deal.cohortKeys[0]!, subjectCount: 1 },
        { workspaceId: 'b', cohortKey: deal.cohortKeys[0]!, subjectCount: 1 },
        { workspaceId: 'c', cohortKey: deal.cohortKeys[0]!, subjectCount: 1 },
      ],
    );
    const paid = s.payouts.reduce((a, p) => a + p.amountCents, 0);
    assert.equal(paid, s.poolCents);
    assert.equal(s.roundingRemainderCents, 0);
  });

  test('small payouts settle as credit, large ones as cash', () => {
    const s = settle(deal, [
      { workspaceId: 'whale', cohortKey: deal.cohortKeys[0]!, subjectCount: 9999 },
      { workspaceId: 'minnow', cohortKey: deal.cohortKeys[0]!, subjectCount: 1 },
    ]);
    const whale = s.payouts.find((p) => p.workspaceId === 'whale')!;
    const minnow = s.payouts.find((p) => p.workspaceId === 'minnow')!;
    assert.equal(whale.method, 'cash');
    assert.equal(minnow.method, 'credit');
  });

  test('a deal with no consented contributors pays nobody', () => {
    const s = settle(deal, []);
    assert.deepEqual(s.payouts, []);
    assert.equal(s.platformCents, s.netCents);
  });
});
