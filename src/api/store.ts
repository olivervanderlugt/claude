/**
 * In-memory store — a stand-in for the real storage tier so the API is runnable end to end.
 *
 * Production shape (see docs/03-architecture.md):
 *   ingest edge -> Kafka/Redpanda -> ClickHouse (events, TTL'd)
 *                                 -> Postgres  (workspaces, keys, consent ledger, billing)
 *
 * The interface here is intentionally the one ClickHouse would satisfy, so swapping the
 * backend is a driver change rather than a rewrite.
 */

import type {
  BuilderTag,
  CleanEvent,
  CohortKey,
  SizeBucket,
  WorkspaceObservation,
} from '../core/types.ts';
import { cohortKeyString } from '../core/privacy/release-gate.ts';

export interface WorkspaceProfile {
  workspaceId: string;
  builder: BuilderTag;
  vertical: string;
  sizeBucket: SizeBucket;
  /** Whether the workspace has signed the co-op addendum. Off by default. */
  coopEnrolled: boolean;
}

export class MemoryStore {
  #events = new Map<string, CleanEvent[]>();
  #keys = new Map<string, string>();
  #profiles = new Map<string, WorkspaceProfile>();
  #observations = new Map<string, WorkspaceObservation[]>();

  registerKey(apiKey: string, workspaceId: string): void {
    this.#keys.set(apiKey, workspaceId);
  }

  workspaceForKey(apiKey: string): string | null {
    return this.#keys.get(apiKey) ?? null;
  }

  upsertProfile(profile: WorkspaceProfile): void {
    this.#profiles.set(profile.workspaceId, profile);
  }

  workspaceProfile(workspaceId: string): WorkspaceProfile | null {
    return this.#profiles.get(workspaceId) ?? null;
  }

  hasCoopConsent(workspaceId: string): boolean {
    return this.#profiles.get(workspaceId)?.coopEnrolled ?? false;
  }

  putEvent(event: CleanEvent): void {
    const bucket = this.#events.get(event.workspaceId) ?? [];
    // Idempotent ingest: the SDK retries on network failure and must not double-count.
    if (bucket.some((e) => e.eventId === event.eventId)) return;
    bucket.push(event);
    this.#events.set(event.workspaceId, bucket);
  }

  /** Returns rows removed, so the erasure endpoint can report a real number. */
  deleteSubject(workspaceId: string, subjectKey: string): number {
    const bucket = this.#events.get(workspaceId);
    if (!bucket) return 0;
    const before = bucket.length;
    this.#events.set(
      workspaceId,
      bucket.filter((e) => e.subjectKey !== subjectKey),
    );
    return before - (this.#events.get(workspaceId)?.length ?? 0);
  }

  metricsFor(workspaceId: string): Record<string, number> {
    const bucket = this.#events.get(workspaceId) ?? [];
    const byName: Record<string, number> = {};
    const subjects = new Set<string>();
    for (const e of bucket) {
      byName[e.name] = (byName[e.name] ?? 0) + 1;
      subjects.add(e.subjectKey);
    }
    return { ...byName, distinct_subjects: subjects.size, total_events: bucket.length };
  }

  putObservation(o: WorkspaceObservation): void {
    const key = `${cohortKeyString(o.cohort)}::${o.metric}`;
    const list = this.#observations.get(key) ?? [];
    list.push(o);
    this.#observations.set(key, list);
  }

  observationsForCohort(cohort: CohortKey, metric: string): WorkspaceObservation[] {
    return this.#observations.get(`${cohortKeyString(cohort)}::${metric}`) ?? [];
  }

  metricValue(workspaceId: string, metric: string): number | null {
    for (const list of this.#observations.values()) {
      const hit = list.find((o) => o.workspaceId === workspaceId && o.metric === metric);
      if (hit) return hit.value;
    }
    return null;
  }
}
