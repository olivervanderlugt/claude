import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ConsentLedger } from '../src/core/consent.ts';
import { deriveConsentAnchor, deriveSubjectKey, epochFor } from '../src/core/identity.ts';
import { ingest } from '../src/core/ingest.ts';
import type { RawEvent } from '../src/core/types.ts';

/**
 * Regression suite for the withdrawal-expiry defect.
 *
 * Consent used to be keyed on `subjectKey`, which rotates on a 30-day epoch. Once the
 * epoch flipped, the ledger had no entry for the person, `resolve()` fell back to the
 * jurisdiction default, and the US default is `granted`. A person who withdrew was
 * silently re-enrolled 30 days later — the exact failure the California DROP regime
 * prices at $200 per request per day.
 *
 * These tests fail against the old behaviour and pass against the anchor.
 */

const IDENTITY = { rootSecret: 'w'.repeat(48) };
const JULY = '2026-07-01T00:00:00Z';
const OCTOBER = '2026-10-01T00:00:00Z'; // comfortably more than one 30-day epoch later

const rawEvent = (occurredAt: string, jurisdiction: string): RawEvent => ({
  workspaceId: 'ws_1',
  eventId: `evt_${occurredAt}`,
  name: 'page_view',
  occurredAt,
  identifier: 'device_abc',
  properties: {},
  context: { jurisdiction, builder: 'lovable' },
});

describe('consent anchor', () => {
  test('is stable across epochs, unlike the subject key', () => {
    assert.notEqual(
      epochFor(JULY),
      epochFor(OCTOBER),
      'test precondition: the dates must straddle an epoch boundary',
    );

    const keyJuly = deriveSubjectKey(IDENTITY, 'ws_1', 'device_abc', JULY);
    const keyOctober = deriveSubjectKey(IDENTITY, 'ws_1', 'device_abc', OCTOBER);
    assert.notEqual(keyJuly, keyOctober, 'subject keys must still rotate');

    const anchor = deriveConsentAnchor(IDENTITY, 'ws_1', 'device_abc');
    assert.equal(anchor, deriveConsentAnchor(IDENTITY, 'ws_1', 'device_abc'));
  });

  test('is still unlinkable across workspaces', () => {
    // The anchor is persistent, so this property is the thing keeping it defensible:
    // it must not become a cross-app identifier for a person.
    const a = deriveConsentAnchor(IDENTITY, 'ws_a', 'device_abc');
    const b = deriveConsentAnchor(IDENTITY, 'ws_b', 'device_abc');
    assert.notEqual(a, b);
  });

  test('is not equal to any subject key, so the two namespaces cannot collide', () => {
    const anchor = deriveConsentAnchor(IDENTITY, 'ws_1', 'device_abc');
    assert.notEqual(anchor, deriveSubjectKey(IDENTITY, 'ws_1', 'device_abc', JULY));
  });

  test('rejects a weak root secret like the other derivations do', () => {
    assert.throws(() => deriveConsentAnchor({ rootSecret: 'short' }, 'ws', 'u1'), /at least 32/);
  });
});

describe('withdrawal survives pseudonym rotation', () => {
  test('a US subject who withdraws is NOT silently re-enrolled next epoch', () => {
    const ledger = new ConsentLedger();
    const anchor = deriveConsentAnchor(IDENTITY, 'ws_1', 'device_abc');

    // Baseline: US defaults grant analytics, so the event is accepted in July.
    const before = ingest(rawEvent(JULY, 'US'), { identity: IDENTITY, ledger });
    assert.equal(before.accepted, true);

    // The subject withdraws.
    ledger.withdrawAll('ws_1', anchor, 'US', JULY);

    const sameEpoch = ingest(rawEvent(JULY, 'US'), { identity: IDENTITY, ledger });
    assert.equal(sameEpoch.accepted, false, 'withdrawal must take effect immediately');

    // Three months later — several epochs on. Under the old key-on-subjectKey scheme
    // this returned accepted:true, because the ledger lookup missed and fell back to
    // the US default of `granted`.
    const laterEpoch = ingest(rawEvent(OCTOBER, 'US'), { identity: IDENTITY, ledger });
    assert.equal(
      laterEpoch.accepted,
      false,
      'a withdrawal must not expire when the pseudonym epoch rolls over',
    );
  });

  test('a grant also survives rotation, so consenting users are not re-prompted forever', () => {
    const ledger = new ConsentLedger();
    const anchor = deriveConsentAnchor(IDENTITY, 'ws_1', 'device_abc');

    for (const purpose of ['product_analytics', 'benchmark_contribution', 'coop_licensing'] as const) {
      ledger.append({
        workspaceId: 'ws_1',
        subjectKey: anchor,
        purpose,
        state: 'granted',
        source: 'explicit_ui',
        recordedAt: JULY,
        jurisdiction: 'EU',
        noticeVersion: 'v1',
      });
    }

    // EU defaults would deny everything, so acceptance here proves the grant was found.
    const later = ingest(rawEvent(OCTOBER, 'EU'), { identity: IDENTITY, ledger });
    assert.equal(later.accepted, true);
    if (!later.accepted) return;
    assert.deepEqual(later.event.permittedPurposes, [
      'product_analytics',
      'benchmark_contribution',
      'coop_licensing',
    ]);
  });

  test('withdrawal in one workspace does not leak into another', () => {
    const ledger = new ConsentLedger();
    ledger.withdrawAll('ws_1', deriveConsentAnchor(IDENTITY, 'ws_1', 'device_abc'), 'US', JULY);

    const other = ingest(
      { ...rawEvent(JULY, 'US'), workspaceId: 'ws_2' },
      { identity: IDENTITY, ledger },
    );
    assert.equal(other.accepted, true, 'consent is per-workspace, so ws_2 is unaffected');
  });

  test('the event itself is still stored under a rotating key', () => {
    // The anchor must not leak into the analytics store, or we would have built the
    // persistent behavioural profile the design promises is impossible.
    const ledger = new ConsentLedger();
    const july = ingest(rawEvent(JULY, 'US'), { identity: IDENTITY, ledger });
    const october = ingest(rawEvent(OCTOBER, 'US'), { identity: IDENTITY, ledger });
    assert.ok(july.accepted && october.accepted);
    if (!july.accepted || !october.accepted) return;

    assert.notEqual(
      july.event.subjectKey,
      october.event.subjectKey,
      'stored events must remain unlinkable across epochs',
    );
    const anchor = deriveConsentAnchor(IDENTITY, 'ws_1', 'device_abc');
    assert.notEqual(july.event.subjectKey, anchor);
    assert.notEqual(october.event.subjectKey, anchor);
  });
});
