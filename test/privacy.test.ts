import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { deriveSubjectKey, subjectKeysForRetentionWindow, epochFor } from '../src/core/identity.ts';
import { ConsentLedger } from '../src/core/consent.ts';
import { redactProperties, MAX_STRING_LENGTH } from '../src/core/redaction.ts';
import { checkKAnonymity } from '../src/core/privacy/k-anonymity.ts';
import { gateRelease } from '../src/core/privacy/release-gate.ts';
import { PrivacyBudget, noisyMean } from '../src/core/privacy/differential-privacy.ts';
import type { CohortKey, ConsentRecord, WorkspaceObservation } from '../src/core/types.ts';

const IDENTITY = { rootSecret: 'x'.repeat(48) };

describe('identity', () => {
  test('same person in two workspaces gets unlinkable keys', () => {
    const a = deriveSubjectKey(IDENTITY, 'ws_a', 'user@example.com', '2026-07-01T00:00:00Z');
    const b = deriveSubjectKey(IDENTITY, 'ws_b', 'user@example.com', '2026-07-01T00:00:00Z');
    assert.notEqual(a, b, 'cross-workspace profiling must be impossible by construction');
  });

  test('keys are stable within an epoch and rotate across epochs', () => {
    const early = deriveSubjectKey(IDENTITY, 'ws', 'u1', '2026-07-01T00:00:00Z');
    const later = deriveSubjectKey(IDENTITY, 'ws', 'u1', '2026-07-02T00:00:00Z');
    assert.equal(early, later);

    // Far enough ahead to guarantee an epoch boundary was crossed.
    const nextEpoch = deriveSubjectKey(IDENTITY, 'ws', 'u1', '2026-10-01T00:00:00Z');
    assert.notEqual(
      epochFor('2026-07-01T00:00:00Z'),
      epochFor('2026-10-01T00:00:00Z'),
      'test precondition: timestamps must straddle an epoch',
    );
    assert.notEqual(early, nextEpoch);
  });

  test('a weak root secret is rejected rather than silently accepted', () => {
    assert.throws(
      () => deriveSubjectKey({ rootSecret: 'short' }, 'ws', 'u1', '2026-07-01T00:00:00Z'),
      /at least 32/,
    );
  });

  test('erasure sweeps every epoch in the retention window', () => {
    const keys = subjectKeysForRetentionWindow(
      IDENTITY,
      'ws',
      'u1',
      '2026-07-27T00:00:00Z',
      365,
    );
    assert.ok(keys.length >= 13, 'a 365-day window at 30-day epochs needs 13+ keys');
    assert.equal(new Set(keys).size, keys.length, 'each epoch must yield a distinct key');
  });
});

describe('consent ledger', () => {
  const base: Omit<ConsentRecord, 'purpose' | 'state'> = {
    workspaceId: 'ws',
    subjectKey: 'subj',
    source: 'explicit_ui',
    recordedAt: '2026-07-01T00:00:00Z',
    jurisdiction: 'EU',
    noticeVersion: 'v1',
  };

  test('EU defaults deny co-op licensing when no signal exists', () => {
    const ledger = new ConsentLedger();
    assert.equal(ledger.resolve('ws', 'nobody', 'coop_licensing', 'EU'), 'denied');
    assert.equal(ledger.resolve('ws', 'nobody', 'benchmark_contribution', 'EU'), 'denied');
  });

  test('unknown jurisdictions fail closed', () => {
    const ledger = new ConsentLedger();
    assert.equal(ledger.resolve('ws', 'nobody', 'coop_licensing', 'ZZ'), 'denied');
  });

  test('consent to analytics does not imply consent to licensing', () => {
    const ledger = new ConsentLedger();
    ledger.append({ ...base, purpose: 'product_analytics', state: 'granted' });
    assert.deepEqual(ledger.permittedPurposes('ws', 'subj', 'EU'), ['product_analytics']);
  });

  test('withdrawal is recorded and revokes every purpose', () => {
    const ledger = new ConsentLedger();
    for (const purpose of ['product_analytics', 'benchmark_contribution', 'coop_licensing'] as const) {
      ledger.append({ ...base, purpose, state: 'granted' });
    }
    assert.equal(ledger.permittedPurposes('ws', 'subj', 'EU').length, 3);

    ledger.withdrawAll('ws', 'subj', 'EU', '2026-07-05T00:00:00Z');
    assert.deepEqual(ledger.permittedPurposes('ws', 'subj', 'EU'), []);
  });

  test('the chain verifies and detects tampering', () => {
    const ledger = new ConsentLedger();
    ledger.append({ ...base, purpose: 'product_analytics', state: 'granted' });
    ledger.append({ ...base, purpose: 'coop_licensing', state: 'denied' });
    assert.deepEqual(ledger.verify(), { ok: true });

    // Rewrite history the way a bad actor would: flip a denial into a grant.
    const tampered = ledger.entries()[1]!;
    (tampered.record as { state: string }).state = 'granted';

    const result = ledger.verify();
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.brokenAt, 1);
  });

  test('the head commitment changes as consent changes', () => {
    const ledger = new ConsentLedger();
    const before = ledger.head();
    ledger.append({ ...base, purpose: 'product_analytics', state: 'granted' });
    assert.notEqual(ledger.head(), before);
  });
});

describe('redaction', () => {
  test('strips emails, tokens and card numbers from free text', () => {
    const { properties, findings } = redactProperties({
      note: 'contact me at ada@example.com or use sk-abcdefghijklmnop1234',
    });
    const note = properties.note as string;
    assert.ok(!note.includes('ada@example.com'));
    assert.ok(!note.includes('sk-abcdefghijklmnop1234'));
    assert.ok(findings.some((f) => f.rule === 'email'));
    assert.ok(findings.some((f) => f.rule === 'api_key'));
  });

  test('drops dangerous keys outright, whatever the value is', () => {
    const { properties, findings } = redactProperties({
      user_email: 'ada@example.com',
      home_address: '1 Main St',
      plan: 'pro',
    });
    assert.equal(properties.user_email, undefined);
    assert.equal(properties.home_address, undefined);
    assert.equal(properties.plan, 'pro', 'benign properties must survive');
    assert.equal(findings.filter((f) => f.rule === 'blocked_key').length, 2);
  });

  test('flattens one level of nesting and collapses arrays to counts', () => {
    const { properties } = redactProperties({
      cart: { items: [1, 2, 3], currency: 'EUR' },
    });
    assert.equal(properties.cart_currency, 'EUR');
    assert.equal(properties.cart_items_count, 3);
  });

  test('truncates long strings where PII hides', () => {
    const { properties } = redactProperties({ bio: 'a'.repeat(1000) });
    assert.equal((properties.bio as string).length, MAX_STRING_LENGTH);
  });

  test('regex state does not leak between calls', () => {
    // A /g regex reused without resetting lastIndex silently misses every other match.
    const first = redactProperties({ a: 'x@y.com' });
    const second = redactProperties({ a: 'x@y.com' });
    assert.deepEqual(first.properties, second.properties);
  });
});

describe('k-anonymity', () => {
  const obs = (workspaceId: string, subjectCount: number): WorkspaceObservation => ({
    workspaceId,
    cohort: { builder: 'lovable', vertical: 'b2b_saas', sizeBucket: '1k-10k', period: '2026-W30' },
    metric: 'activation_rate',
    value: 0.2,
    subjectCount,
  });

  test('suppresses cohorts with too few contributors', () => {
    const verdict = checkKAnonymity([obs('a', 1000), obs('b', 1000)]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.reason, 'too_few_contributors');
    assert.equal(verdict.ok === false && verdict.shortfall, 8);
  });

  test('suppresses cohorts with too few subjects', () => {
    const many = Array.from({ length: 12 }, (_, i) => obs(`w${i}`, 5));
    const verdict = checkKAnonymity(many);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.reason, 'too_few_subjects');
  });

  test('suppresses cohorts one contributor dominates', () => {
    const list = [obs('whale', 100_000), ...Array.from({ length: 15 }, (_, i) => obs(`w${i}`, 100))];
    const verdict = checkKAnonymity(list);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.reason, 'contributor_dominance');
  });

  test('counts distinct workspaces, not rows', () => {
    // One workspace submitting 20 rows is still one contributor.
    const spam = Array.from({ length: 20 }, () => obs('same', 1000));
    const verdict = checkKAnonymity(spam);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.contributorCount, 1);
  });

  test('passes a healthy cohort', () => {
    const list = Array.from({ length: 20 }, (_, i) => obs(`w${i}`, 200));
    const verdict = checkKAnonymity(list);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.ok === true && verdict.contributorCount, 20);
    assert.equal(verdict.ok === true && verdict.subjectCount, 4000);
  });
});

describe('release gate', () => {
  const cohort: CohortKey = {
    builder: 'lovable',
    vertical: 'b2b_saas',
    sizeBucket: '1k-10k',
    period: '2026-W30',
  };
  const metric = { name: 'activation_rate', lo: 0, hi: 1 };

  const healthy = (): WorkspaceObservation[] =>
    Array.from({ length: 25 }, (_, i) => ({
      workspaceId: `w${i}`,
      cohort,
      metric: 'activation_rate',
      value: 0.05 + i * 0.02,
      subjectCount: 400,
    }));

  test('releases a healthy consented cohort with a monotonic percentile ladder', () => {
    const budget = new PrivacyBudget();
    const out = gateRelease(cohort, metric, healthy(), () => true, 'head0', { budget });
    assert.equal(out.released, true);
    if (!out.released) return;

    const p = out.release.percentiles;
    assert.ok(p.p10 <= p.p25 && p.p25 <= p.p50 && p.p50 <= p.p75 && p.p75 <= p.p90);
    assert.ok(p.p50 >= 0 && p.p50 <= 1, 'values must stay inside the public domain bounds');
    assert.equal(out.release.contributorCount, 25);
    assert.ok(out.release.provenanceHash.length === 64);
  });

  test('refuses to release when nobody consented to licensing', () => {
    const budget = new PrivacyBudget();
    const out = gateRelease(cohort, metric, healthy(), () => false, 'head0', { budget });
    assert.equal(out.released, false);
    assert.equal(out.released === false && out.reason, 'no_consented_observations');
  });

  test('non-consented rows cannot prop a cohort over the k threshold', () => {
    const budget = new PrivacyBudget();
    const observations = healthy();
    // Only three workspaces consented; the other 22 must not count toward k.
    const consenting = new Set(['w0', 'w1', 'w2']);
    const out = gateRelease(
      cohort,
      metric,
      observations,
      (o) => consenting.has(o.workspaceId),
      'head0',
      { budget },
    );
    assert.equal(out.released, false);
    assert.equal(out.released === false && out.reason, 'too_few_contributors');
  });

  test('the privacy budget is finite and stops repeated querying', () => {
    const budget = new PrivacyBudget(0.25);
    const results = Array.from({ length: 5 }, () =>
      gateRelease(cohort, metric, healthy(), () => true, 'head0', {
        budget,
        epsilonPerQuery: 0.1,
      }),
    );
    const released = results.filter((r) => r.released).length;
    assert.equal(released, 2, 'a 0.25 budget at 0.1 per query allows exactly two releases');
    assert.equal(
      results[4]!.released === false && results[4]!.reason,
      'privacy_budget_exhausted',
    );
  });

  test('provenance binds a release to the consent state it came from', () => {
    const a = gateRelease(cohort, metric, healthy(), () => true, 'headA', {
      budget: new PrivacyBudget(),
    });
    const b = gateRelease(cohort, metric, healthy(), () => true, 'headB', {
      budget: new PrivacyBudget(),
    });
    assert.ok(a.released && b.released);
    if (!a.released || !b.released) return;
    assert.notEqual(
      a.release.provenanceHash,
      b.release.provenanceHash,
      'a different consent head must produce a different provenance stamp',
    );
  });

  test('noise is actually applied — repeated releases differ', () => {
    const runs = Array.from({ length: 8 }, () =>
      gateRelease(cohort, metric, healthy(), () => true, 'head0', {
        budget: new PrivacyBudget(100),
      }),
    );
    const medians = runs.filter((r) => r.released).map((r) => (r as { release: { percentiles: { p50: number } } }).release.percentiles.p50);
    assert.equal(new Set(medians).size > 1, true, 'identical output across runs would mean no noise');
  });
});

describe('differential privacy', () => {
  test('noisy mean stays within the declared domain', () => {
    for (let i = 0; i < 200; i++) {
      const v = noisyMean({ values: [0.1, 0.2, 0.3, 0.4], lo: 0, hi: 1, epsilon: 0.05 });
      assert.ok(v >= 0 && v <= 1, `value ${v} escaped the domain`);
    }
  });

  test('noisy mean tracks the truth on average', () => {
    const values = Array.from({ length: 500 }, () => 0.4);
    const samples = Array.from({ length: 400 }, () =>
      noisyMean({ values, lo: 0, hi: 1, epsilon: 0.5 }),
    );
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    assert.ok(Math.abs(mean - 0.4) < 0.02, `noise should be unbiased, got ${mean}`);
  });

  test('budget refuses to overspend', () => {
    const budget = new PrivacyBudget(1);
    assert.equal(budget.trySpend('k', 0.6), true);
    assert.equal(budget.trySpend('k', 0.6), false);
    assert.equal(budget.remaining('k'), 0.4);
  });
});
