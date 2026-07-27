import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  screenEvent,
  screenWorkspace,
  restrictPurposes,
  explainScreen,
} from '../src/core/privacy/special-category.ts';
import type { ConsentPurpose } from '../src/core/types.ts';

const ALL: ConsentPurpose[] = ['product_analytics', 'benchmark_contribution', 'coop_licensing'];

describe('special-category screening — event level', () => {
  test('catches health signals in an event name', () => {
    // The C-184/20 case: data "liable indirectly to reveal" a protected characteristic.
    // `hiv_refill_tapped` is not labelled health data, but it plainly reveals it.
    const result = screenEvent({ name: 'hiv_refill_tapped' });
    assert.equal(result.clean, false);
    assert.ok(result.categories.includes('health'));
  });

  test('catches a revealing URL path in properties', () => {
    const result = screenEvent({ name: 'page_view', properties: { path: '/therapy/session-notes' } });
    assert.equal(result.clean, false);
    assert.ok(result.categories.includes('health'));
  });

  test('catches sexual orientation signals', () => {
    const result = screenEvent({ name: 'lgbtq_group_joined' });
    assert.equal(result.clean, false);
    assert.ok(result.categories.includes('sex_life_or_orientation'));
  });

  test('catches signals hiding in property keys, not just values', () => {
    const result = screenEvent({ name: 'profile_saved', properties: { religion_selected: true } });
    assert.equal(result.clean, false);
    assert.ok(result.categories.includes('religion'));
  });

  test('reports every category a string trips, not just the first', () => {
    const result = screenEvent({ name: 'muslim_prayer_diabetes_reminder' });
    assert.ok(result.categories.includes('religion'));
    assert.ok(result.categories.includes('health'));
  });

  test('snake_case and kebab-case names are screened, not skipped', () => {
    // Regression guard for the \b bug: `_` is a word character, so /\bhiv\b/ does not
    // match `hiv_refill`. Event names are overwhelmingly snake_case, so a boundary bug
    // here would silently disable the whole control in production.
    for (const name of ['hiv_refill', 'hiv-refill', 'user/hiv/refill', 'refill.hiv']) {
      assert.equal(screenEvent({ name }).clean, false, `"${name}" must be screened`);
    }
  });

  test('does not flag ops events that merely contain the word health', () => {
    // health_check is near-universal. Flagging it trains developers to switch screening
    // off, which costs more than the false negative it prevents.
    assert.equal(screenEvent({ name: 'health_check' }).clean, true);
    assert.equal(screenEvent({ name: 'healthcheck_failed' }).clean, true);
  });

  test('lets ordinary product events through', () => {
    // The false-positive rate has to be tolerable or developers will disable screening.
    for (const name of [
      'signup_completed',
      'checkout_started',
      'button_clicked',
      'invoice_paid',
      'dashboard_viewed',
      'file_uploaded',
    ]) {
      const result = screenEvent({ name });
      assert.equal(result.clean, true, `"${name}" should not have been flagged`);
    }
  });

  test('word boundaries prevent the obvious false positives', () => {
    // 'race' must not fire on 'racetrack'... but 'vote' must still fire on 'voted'.
    assert.equal(screenEvent({ name: 'therapeutic_ui_theme' }).clean, true);
    assert.equal(screenEvent({ name: 'voted_on_poll' }).clean, false);
  });

  test('ignores non-string property values', () => {
    // A number carries no category signal on its own; screening it would be noise.
    const result = screenEvent({ name: 'checkout', properties: { amount: 42, ok: true, n: null } });
    assert.equal(result.clean, true);
  });

  test('regex state does not leak between calls', () => {
    const a = screenEvent({ name: 'hiv_refill' });
    const b = screenEvent({ name: 'hiv_refill' });
    assert.deepEqual(a.categories, b.categories);
  });
});

describe('special-category screening — workspace level', () => {
  test('flags an app whose identity is itself revealing', () => {
    // Schrems (C-446/21): visiting a site targeted at homosexual users engaged Art 9 on
    // page load. For such an app, being a user IS the disclosure — no amount of
    // event-level scrubbing helps, so the whole workspace must be barred from the co-op.
    const result = screenWorkspace({
      appName: 'PrideConnect',
      description: 'A dating app for the LGBTQ community',
    });
    assert.equal(result.clean, false);
    assert.ok(result.categories.includes('sex_life_or_orientation'));
  });

  test('flags a health app by declared vertical', () => {
    const result = screenWorkspace({ appName: 'TrackIt', vertical: 'mental_health_clinical' });
    assert.equal(result.clean, false);
    assert.ok(result.categories.includes('health'));
  });

  test('flags a children\'s app', () => {
    const result = screenWorkspace({ appName: 'MathKids', description: 'Learning games for kids' });
    assert.equal(result.clean, false);
    assert.ok(result.categories.includes('childrens_data'));
  });

  test('lets an ordinary B2B app through', () => {
    const result = screenWorkspace({
      appName: 'InvoiceFlow',
      description: 'Invoicing and expense tracking for freelancers',
      vertical: 'b2b_saas',
    });
    assert.equal(result.clean, true);
  });

  test('ignores absent and empty fields', () => {
    assert.equal(screenWorkspace({}).clean, true);
    assert.equal(screenWorkspace({ appName: '', description: undefined }).clean, true);
  });
});

describe('purpose restriction', () => {
  test('a flagged event keeps first-party analytics only', () => {
    const screen = screenEvent({ name: 'hiv_refill_tapped' });
    const restricted = restrictPurposes(ALL, screen);
    assert.deepEqual(restricted, ['product_analytics']);
  });

  test('a clean event keeps every purpose it already had', () => {
    const screen = screenEvent({ name: 'signup_completed' });
    assert.deepEqual(restrictPurposes(ALL, screen), ALL);
  });

  test('restriction never grants a purpose that was not already held', () => {
    // Fail-closed in both directions: screening can only ever remove.
    const screen = screenEvent({ name: 'signup_completed' });
    assert.deepEqual(restrictPurposes(['product_analytics'], screen), ['product_analytics']);
  });

  test('a flagged event with no analytics consent ends up with nothing', () => {
    const screen = screenEvent({ name: 'hiv_refill_tapped' });
    assert.deepEqual(restrictPurposes(['benchmark_contribution'], screen), []);
  });
});

describe('developer-facing explanation', () => {
  test('explains a flag in terms the developer can act on', () => {
    const screen = screenEvent({ name: 'hiv_refill_tapped' });
    const message = explainScreen(screen);
    assert.ok(message);
    assert.ok(message.includes('health'));
    assert.ok(message.includes('benchmarks'), 'must say what the consequence is');
    assert.ok(message.includes('Rename'), 'must say how to fix a false positive');
  });

  test('says nothing when there is nothing to say', () => {
    assert.equal(explainScreen(screenEvent({ name: 'signup_completed' })), null);
  });
});
