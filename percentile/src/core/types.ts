/**
 * Core domain types.
 *
 * Two data planes exist in this system and they must never be conflated:
 *
 *   FIRST-PARTY PLANE  — pseudonymous, per-workspace, owned by the developer.
 *                        Percentile is a *processor* here (GDPR Art. 28).
 *   CO-OP PLANE        — aggregate-only, k-anonymised, noise-injected, cross-workspace.
 *                        Percentile is a *controller* of anonymous data here, which
 *                        is outside the GDPR's material scope (Recital 26).
 *
 * The only bridge between the planes is `ReleaseGate` (src/core/privacy/release-gate.ts).
 * Nothing else may move a row from left to right. That single choke point is what
 * makes the data business defensible instead of a liability.
 */

/** Stable, opaque workspace (developer/app) identifier. */
export type WorkspaceId = string;

/** Pseudonymous subject id. Never a raw email/IP/device id — see identity.ts. */
export type SubjectKey = string;

export type ConsentPurpose =
  /** First-party product analytics shown to the developer who owns the app. */
  | 'product_analytics'
  /** Contribution of this subject's behaviour to cross-workspace aggregate benchmarks. */
  | 'benchmark_contribution'
  /** Inclusion in aggregate datasets licensed to third parties (the co-op). */
  | 'coop_licensing';

export type ConsentState = 'granted' | 'denied' | 'withdrawn' | 'unknown';

/** Where a consent signal came from. Provenance is the product, so we record it. */
export type ConsentSource =
  | 'explicit_ui' // subject clicked something in a consent dialog
  | 'gpc' // Global Privacy Control header
  | 'dnt' // legacy Do Not Track header
  | 'workspace_default' // developer-configured default for their app
  | 'regulatory_default'; // our own fail-closed default for a jurisdiction

export interface ConsentRecord {
  workspaceId: WorkspaceId;
  subjectKey: SubjectKey;
  purpose: ConsentPurpose;
  state: ConsentState;
  source: ConsentSource;
  /** ISO-8601. Supplied by caller so the ledger is deterministic and testable. */
  recordedAt: string;
  /** Two-letter region code used to pick the default posture (e.g. 'EU', 'US-CA'). */
  jurisdiction: string;
  /** Version of the notice the subject was shown. Needed to defend the consent later. */
  noticeVersion: string;
}

/** A single behavioural event as it arrives from the SDK. */
export interface RawEvent {
  workspaceId: WorkspaceId;
  /** Client-supplied durable id used for idempotent ingest. */
  eventId: string;
  name: string;
  occurredAt: string;
  /** Raw identifier from the client (device id, user id, session id). Hashed on ingest. */
  identifier: string;
  properties: Record<string, unknown>;
  context: {
    jurisdiction: string;
    /** Present only if the client sent it; used to derive coarse geo, then discarded. */
    ip?: string;
    userAgent?: string;
    /** Which builder produced the app — the core segmentation dimension for benchmarks. */
    builder?: BuilderTag;
  };
}

/** The AI builder that generated the host app. Drives cohort segmentation. */
export type BuilderTag =
  | 'lovable'
  | 'bolt'
  | 'v0'
  | 'replit'
  | 'base44'
  | 'claude_code'
  | 'cursor'
  | 'other'
  | 'unknown';

/** An event after redaction + pseudonymisation. This is what we persist. */
export interface CleanEvent {
  workspaceId: WorkspaceId;
  eventId: string;
  name: string;
  occurredAt: string;
  subjectKey: SubjectKey;
  properties: Record<string, PropertyValue>;
  jurisdiction: string;
  /** Coarse geography only — country level. Never city, never lat/lng. */
  country: string | null;
  builder: BuilderTag;
  /** Purposes this event is permitted to be used for, resolved at ingest time. */
  permittedPurposes: ConsentPurpose[];
}

/** Property values are constrained: no nested objects, no free text over a length cap. */
export type PropertyValue = string | number | boolean | null;

/** A cohort is the unit of aggregation and the unit of sale. */
export interface CohortKey {
  builder: BuilderTag;
  /** Vertical of the app, e.g. 'b2b_saas', 'marketplace', 'consumer_social'. */
  vertical: string;
  /** Bucketed app size so we never leak an individual workspace's scale. */
  sizeBucket: SizeBucket;
  /** ISO week or month the observation belongs to, e.g. '2026-W30' or '2026-07'. */
  period: string;
}

export type SizeBucket = '1-100' | '100-1k' | '1k-10k' | '10k-100k' | '100k+';

/** A metric measured for one workspace within one period. Input to aggregation. */
export interface WorkspaceObservation {
  workspaceId: WorkspaceId;
  cohort: CohortKey;
  metric: string;
  value: number;
  /** Number of distinct subjects behind this value. Drives k-anonymity checks. */
  subjectCount: number;
}

/** The output of aggregation — the only shape allowed to leave the co-op plane. */
export interface AggregateRelease {
  cohort: CohortKey;
  metric: string;
  /** Number of distinct workspaces contributing. Must clear the k threshold. */
  contributorCount: number;
  /** Total distinct subjects behind the aggregate. Must clear the subject threshold. */
  subjectCount: number;
  percentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  mean: number;
  /** Privacy budget actually spent producing this release. */
  epsilonSpent: number;
  /** Provenance hash tying this release to the consent ledger state it was built from. */
  provenanceHash: string;
}
