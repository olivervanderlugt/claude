/**
 * Pseudonymisation.
 *
 * Raw identifiers (device ids, user ids, emails, IPs) never reach storage. They are
 * hashed with a per-workspace secret plus a salt that rotates on a fixed epoch.
 *
 * Two properties matter commercially, not just legally:
 *
 *  1. Per-workspace keying means the same human in two different customer apps gets two
 *     unlinkable keys. We *cannot* build a cross-app profile of a person even if asked.
 *     That is the single sentence that closes enterprise deals and ends most DPO reviews.
 *
 *  2. Salt rotation caps how long any pseudonym stays linkable. After an epoch flips,
 *     yesterday's key can no longer be joined to today's, which is what makes the
 *     "we do not build persistent profiles" claim actually true rather than aspirational.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SubjectKey, WorkspaceId } from './types.ts';

/** Length of a rotation epoch. 30 days balances retention utility against linkability. */
export const EPOCH_DAYS = 30;

export interface IdentityConfig {
  /** Server-side secret. Never leaves the ingest tier; not derivable from output. */
  rootSecret: string;
  epochDays?: number;
}

/** Epoch index for a timestamp. Deterministic, so tests and replays agree. */
export function epochFor(occurredAt: string, epochDays: number = EPOCH_DAYS): number {
  const ms = Date.parse(occurredAt);
  if (Number.isNaN(ms)) throw new Error(`identity: unparseable timestamp "${occurredAt}"`);
  return Math.floor(ms / (epochDays * 86_400_000));
}

/**
 * Derive the pseudonymous subject key.
 *
 * Deliberately *not* reversible and deliberately *not* stable across workspaces.
 */
export function deriveSubjectKey(
  config: IdentityConfig,
  workspaceId: WorkspaceId,
  rawIdentifier: string,
  occurredAt: string,
): SubjectKey {
  if (!config.rootSecret || config.rootSecret.length < 32) {
    // Fail loudly. A weak secret here silently converts pseudonymous data into
    // personal data, which changes our entire regulatory position.
    throw new Error('identity: rootSecret must be at least 32 characters');
  }
  if (!rawIdentifier) throw new Error('identity: rawIdentifier is required');

  const epoch = epochFor(occurredAt, config.epochDays ?? EPOCH_DAYS);
  const scoped = createHmac('sha256', config.rootSecret)
    .update(`workspace:${workspaceId}`)
    .digest();

  return createHmac('sha256', scoped)
    .update(`${rawIdentifier}|epoch:${epoch}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Derive the stable *consent anchor* for a subject.
 *
 * Deliberately NOT epoch-rotated, and that is a considered trade-off rather than an
 * oversight. Consent decisions are keyed on this instead of on `subjectKey`, because a
 * rotating key silently expires withdrawals: once the epoch flips, the ledger no longer
 * has an entry for that person, `resolve()` falls back to the jurisdiction default, and
 * in the US that default is `granted`. A Californian who withdrew would be re-enrolled
 * 30 days later without ever being asked — which is precisely the failure the California
 * DROP regime prices at $200 per request per day.
 *
 * The cost is honest: this is a persistent per-workspace pseudonym, so it is a stronger
 * identifier than `subjectKey`. Two things keep it defensible. It is still keyed per
 * workspace, so it cannot link a person across apps. And it is used *only* for consent
 * and suppression bookkeeping, never to key behavioural events — the analytics store
 * still sees rotating keys, so no long-run behavioural profile can be assembled from it.
 *
 * You cannot honour "never contact me again" without remembering who asked. Suppression
 * lists work this way for the same reason.
 */
export function deriveConsentAnchor(
  config: IdentityConfig,
  workspaceId: WorkspaceId,
  rawIdentifier: string,
): SubjectKey {
  if (!config.rootSecret || config.rootSecret.length < 32) {
    throw new Error('identity: rootSecret must be at least 32 characters');
  }
  if (!rawIdentifier) throw new Error('identity: rawIdentifier is required');

  const scoped = createHmac('sha256', config.rootSecret)
    .update(`consent-anchor:${workspaceId}`)
    .digest();

  return createHmac('sha256', scoped).update(rawIdentifier).digest('hex').slice(0, 32);
}

/**
 * Verify a subject key without exposing the derivation — used by the erasure endpoint,
 * where a subject presents a raw identifier and we must find their rows without
 * ever logging the raw value.
 */
export function subjectKeyMatches(
  config: IdentityConfig,
  workspaceId: WorkspaceId,
  rawIdentifier: string,
  occurredAt: string,
  candidate: SubjectKey,
): boolean {
  const expected = deriveSubjectKey(config, workspaceId, rawIdentifier, occurredAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * All subject keys a raw identifier could have produced across a retention window.
 * Erasure has to sweep every epoch the subject could appear in, or "delete my data"
 * quietly leaves rows behind — the exact failure the California DROP fines target.
 */
export function subjectKeysForRetentionWindow(
  config: IdentityConfig,
  workspaceId: WorkspaceId,
  rawIdentifier: string,
  now: string,
  retentionDays: number,
): SubjectKey[] {
  const epochDays = config.epochDays ?? EPOCH_DAYS;
  const epochsBack = Math.ceil(retentionDays / epochDays);
  const nowMs = Date.parse(now);
  const keys: SubjectKey[] = [];
  for (let i = 0; i <= epochsBack; i++) {
    const at = new Date(nowMs - i * epochDays * 86_400_000).toISOString();
    keys.push(deriveSubjectKey(config, workspaceId, rawIdentifier, at));
  }
  return keys;
}
