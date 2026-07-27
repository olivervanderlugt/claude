/**
 * HTTP surface.
 *
 * Deliberately small. Four verbs is the whole public API:
 *
 *   POST /v1/events        ingest (batched)
 *   POST /v1/consent       record or withdraw a consent signal
 *   GET  /v1/insights      first-party metrics for your own workspace
 *   GET  /v1/benchmarks    your metric against your cohort, if the cohort clears the gate
 *
 * Plus two governance endpoints that exist because the business depends on them working:
 *
 *   POST /v1/erasure       subject erasure across every retention epoch
 *   GET  /v1/provenance    verify the consent ledger and fetch its head commitment
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { ConsentLedger } from '../core/consent.ts';
import { ingest } from '../core/ingest.ts';
import { deriveConsentAnchor, subjectKeysForRetentionWindow } from '../core/identity.ts';
import { gateRelease } from '../core/privacy/release-gate.ts';
import { PrivacyBudget } from '../core/privacy/differential-privacy.ts';
import { compare } from '../core/aggregate/benchmarks.ts';
import { MemoryStore } from './store.ts';
import type { CohortKey, ConsentPurpose, RawEvent } from '../core/types.ts';

const ROOT_SECRET = process.env.PERCENTILE_ROOT_SECRET ?? '';
const RETENTION_DAYS = Number(process.env.PERCENTILE_RETENTION_DAYS ?? 400);

if (!ROOT_SECRET || ROOT_SECRET.length < 32) {
  // Refuse to boot rather than run with a weak secret. A weak secret turns every
  // pseudonym into personal data and silently invalidates the entire privacy posture.
  throw new Error('PERCENTILE_ROOT_SECRET must be set to at least 32 characters');
}

const identity = { rootSecret: ROOT_SECRET };
const ledger = new ConsentLedger();
const store = new MemoryStore();
const budget = new PrivacyBudget();

export const app = new Hono();

/** Resolve the workspace from the ingest key. Real impl: hashed key lookup + rate limit. */
function workspaceFromRequest(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const key = authorization.slice(7).trim();
  return key ? store.workspaceForKey(key) : null;
}

/**
 * Honour browser-level opt-out signals before anything else.
 * Global Privacy Control is legally binding in several US states; treating it as
 * advisory is one of the fastest routes to an enforcement action.
 */
function optedOutBySignal(headers: Headers): boolean {
  return headers.get('sec-gpc') === '1' || headers.get('dnt') === '1';
}

app.get('/health', (c) => c.json({ ok: true, ledgerEntries: ledger.length }));

app.post('/v1/events', async (c) => {
  const workspaceId = workspaceFromRequest(c.req.header('authorization'));
  if (!workspaceId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ events: RawEvent[] }>().catch(() => null);
  if (!body?.events || !Array.isArray(body.events)) {
    return c.json({ error: 'expected { events: [...] }' }, 400);
  }
  if (body.events.length > 500) return c.json({ error: 'batch too large (max 500)' }, 413);

  const signalOptOut = optedOutBySignal(c.req.raw.headers);
  const results = { accepted: 0, rejected: 0, findings: [] as Array<{ key: string; rule: string }> };

  for (const raw of body.events) {
    // The workspace is taken from the API key, never from the payload — otherwise a
    // leaked client key could write into somebody else's dataset.
    const event = { ...raw, workspaceId };
    const outcome = ingest(event, { identity, ledger });

    if (!outcome.accepted) {
      results.rejected++;
      continue;
    }
    // A GPC/DNT signal keeps the event out of the co-op even if a ledger grant exists;
    // the most recent expression of a subject's wishes wins.
    const permitted = signalOptOut
      ? outcome.event.permittedPurposes.filter((p) => p === 'product_analytics')
      : outcome.event.permittedPurposes;

    store.putEvent({ ...outcome.event, permittedPurposes: permitted });
    results.accepted++;
    results.findings.push(...outcome.findings);
  }

  return c.json({
    accepted: results.accepted,
    rejected: results.rejected,
    // Surfacing findings turns our redaction into a product feature: the developer
    // learns their generated code is leaking PII, from us, before a regulator tells them.
    redactions: dedupeFindings(results.findings),
  });
});

app.post('/v1/consent', async (c) => {
  const workspaceId = workspaceFromRequest(c.req.header('authorization'));
  if (!workspaceId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req
    .json<{
      identifier: string;
      purposes: Partial<Record<ConsentPurpose, boolean>>;
      jurisdiction: string;
      noticeVersion: string;
      occurredAt?: string;
    }>()
    .catch(() => null);

  if (!body?.identifier || !body.purposes) {
    return c.json({ error: 'expected { identifier, purposes, jurisdiction, noticeVersion }' }, 400);
  }

  const at = body.occurredAt ?? new Date().toISOString();
  // Recorded against the stable anchor so the decision outlives the 30-day pseudonym
  // epoch. Recording against the rotating key would expire this consent — and, worse,
  // expire a *withdrawal* back to a jurisdiction default that is `granted` in the US.
  const subjectKey = deriveConsentAnchor(identity, workspaceId, body.identifier);

  for (const [purpose, granted] of Object.entries(body.purposes) as Array<[ConsentPurpose, boolean]>) {
    ledger.append({
      workspaceId,
      subjectKey,
      purpose,
      state: granted ? 'granted' : 'denied',
      source: 'explicit_ui',
      recordedAt: at,
      jurisdiction: body.jurisdiction || 'unknown',
      noticeVersion: body.noticeVersion || 'unversioned',
    });
  }

  return c.json({ recorded: true, ledgerHead: ledger.head() });
});

app.post('/v1/erasure', async (c) => {
  const workspaceId = workspaceFromRequest(c.req.header('authorization'));
  if (!workspaceId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{ identifier: string; jurisdiction?: string }>().catch(() => null);
  if (!body?.identifier) return c.json({ error: 'expected { identifier }' }, 400);

  const now = new Date().toISOString();
  const keys = subjectKeysForRetentionWindow(
    identity,
    workspaceId,
    body.identifier,
    now,
    RETENTION_DAYS,
  );

  // Rows are stored under rotating keys, so deletion has to sweep every epoch in the
  // window. Withdrawal is recorded once, against the stable anchor — writing it against
  // the rotating keys would make the withdrawal itself expire at the next epoch, which
  // is the whole bug this anchor exists to prevent.
  let deleted = 0;
  for (const key of keys) {
    deleted += store.deleteSubject(workspaceId, key);
  }
  ledger.withdrawAll(
    workspaceId,
    deriveConsentAnchor(identity, workspaceId, body.identifier),
    body.jurisdiction ?? 'unknown',
    now,
  );

  // Already-published aggregates are not recalled: they are anonymous, contain no
  // personal data, and cannot be attributed back to this subject. Saying so plainly
  // here is what makes the erasure promise honest rather than over-claimed.
  return c.json({
    erased: true,
    rowsDeleted: deleted,
    epochsSwept: keys.length,
    note: 'Future aggregates exclude this subject. Previously published aggregates are anonymous and are not recalled.',
  });
});

app.get('/v1/insights', (c) => {
  const workspaceId = workspaceFromRequest(c.req.header('authorization'));
  if (!workspaceId) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ workspaceId, metrics: store.metricsFor(workspaceId) });
});

app.get('/v1/benchmarks', (c) => {
  const workspaceId = workspaceFromRequest(c.req.header('authorization'));
  if (!workspaceId) return c.json({ error: 'unauthorized' }, 401);

  const metricName = c.req.query('metric');
  if (!metricName) return c.json({ error: 'metric query parameter is required' }, 400);

  const profile = store.workspaceProfile(workspaceId);
  if (!profile) return c.json({ error: 'workspace not profiled yet' }, 404);

  const cohort: CohortKey = {
    builder: profile.builder,
    vertical: profile.vertical,
    sizeBucket: profile.sizeBucket,
    period: c.req.query('period') ?? currentPeriod(),
  };

  const observations = store.observationsForCohort(cohort, metricName);
  const outcome = gateRelease(
    cohort,
    { name: metricName, lo: 0, hi: 1 },
    observations,
    (o) => store.hasCoopConsent(o.workspaceId),
    ledger.head(),
    { budget },
  );

  if (!outcome.released) {
    // A suppression is a sales moment, not an error: it tells the developer exactly
    // what has to happen for the number to appear, which is usually "more apps like yours".
    return c.json({ available: false, reason: outcome.reason, explanation: outcome.explanation }, 200);
  }

  const yourValue = store.metricValue(workspaceId, metricName);
  if (yourValue === null) {
    return c.json({ available: true, release: outcome.release, yourValue: null });
  }

  return c.json({
    available: true,
    release: outcome.release,
    comparison: compare(outcome.release, yourValue, {
      label: metricName.replace(/_/g, ' '),
      format: (v) => `${(v * 100).toFixed(1)}%`,
    }),
  });
});

app.get('/v1/provenance', (c) => {
  const verification = ledger.verify();
  return c.json({
    ledgerHead: ledger.head(),
    entries: ledger.length,
    chainValid: verification.ok,
    ...(verification.ok ? {} : { brokenAt: verification.brokenAt }),
  });
});

function dedupeFindings(
  findings: Array<{ key: string; rule: string }>,
): Array<{ key: string; rule: string; count: number }> {
  const counts = new Map<string, { key: string; rule: string; count: number }>();
  for (const f of findings) {
    const k = `${f.key}:${f.rule}`;
    const existing = counts.get(k);
    if (existing) existing.count++;
    else counts.set(k, { ...f, count: 1 });
  }
  return [...counts.values()];
}

function currentPeriod(): string {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO week number.
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port });
  console.log(`percentile api listening on :${port}`);
}
