/**
 * Ingest pipeline: RawEvent -> CleanEvent.
 *
 * Order is load-bearing. Redaction happens before pseudonymisation and before anything is
 * written, so a raw identifier or a leaked token is never persisted even transiently. If
 * the pipeline throws, we drop the event; we never fall back to storing the raw form.
 */

import { ConsentLedger } from './consent.ts';
import { deriveConsentAnchor, deriveSubjectKey, type IdentityConfig } from './identity.ts';
import { ipToCountry, redactProperties } from './redaction.ts';
import type { BuilderTag, CleanEvent, ConsentPurpose, RawEvent } from './types.ts';

const KNOWN_BUILDERS: readonly BuilderTag[] = [
  'lovable',
  'bolt',
  'v0',
  'replit',
  'base44',
  'claude_code',
  'cursor',
  'other',
  'unknown',
];

export interface IngestDeps {
  identity: IdentityConfig;
  ledger: ConsentLedger;
  /** Injected so ingest stays pure and testable without a geo database. */
  geoLookup?: (ip: string) => string | null;
}

export type IngestOutcome =
  | { accepted: true; event: CleanEvent; findings: Array<{ key: string; rule: string }> }
  | { accepted: false; reason: string };

const MAX_EVENT_NAME_LENGTH = 64;
const EVENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;

export function ingest(raw: RawEvent, deps: IngestDeps): IngestOutcome {
  if (!raw.workspaceId) return { accepted: false, reason: 'missing_workspace' };
  if (!raw.eventId) return { accepted: false, reason: 'missing_event_id' };
  if (!raw.name || raw.name.length > MAX_EVENT_NAME_LENGTH || !EVENT_NAME_PATTERN.test(raw.name)) {
    return { accepted: false, reason: 'invalid_event_name' };
  }
  if (Number.isNaN(Date.parse(raw.occurredAt))) {
    return { accepted: false, reason: 'invalid_timestamp' };
  }
  if (!raw.identifier) return { accepted: false, reason: 'missing_identifier' };

  const { properties, findings } = redactProperties(raw.properties ?? {});

  const subjectKey = deriveSubjectKey(
    deps.identity,
    raw.workspaceId,
    raw.identifier,
    raw.occurredAt,
  );

  // Consent is looked up under the stable anchor, NOT the rotating subjectKey. Keying
  // consent on a value that rotates every 30 days expires withdrawals silently — see
  // deriveConsentAnchor. The event itself is still stored under the rotating key.
  const consentAnchor = deriveConsentAnchor(deps.identity, raw.workspaceId, raw.identifier);

  const jurisdiction = raw.context?.jurisdiction || 'unknown';
  const permittedPurposes: ConsentPurpose[] = deps.ledger.permittedPurposes(
    raw.workspaceId,
    consentAnchor,
    jurisdiction,
  );

  // No product-analytics permission means we cannot even show this to the developer.
  // Fail closed: the event is counted in a consentless tally elsewhere, not stored here.
  if (!permittedPurposes.includes('product_analytics')) {
    return { accepted: false, reason: 'no_analytics_consent' };
  }

  const builder = KNOWN_BUILDERS.includes(raw.context?.builder as BuilderTag)
    ? (raw.context!.builder as BuilderTag)
    : 'unknown';

  const country = deps.geoLookup ? ipToCountry(raw.context?.ip, deps.geoLookup) : null;

  return {
    accepted: true,
    findings,
    event: {
      workspaceId: raw.workspaceId,
      eventId: raw.eventId,
      name: raw.name.toLowerCase(),
      occurredAt: new Date(raw.occurredAt).toISOString(),
      subjectKey,
      properties,
      jurisdiction,
      country,
      builder,
      permittedPurposes,
    },
  };
}
