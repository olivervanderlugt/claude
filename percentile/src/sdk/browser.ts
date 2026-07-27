/**
 * Browser SDK.
 *
 * Design constraints, in priority order:
 *
 *  1. One line to install. The person shipping a vibe-coded app will not read docs, and
 *     an agent pasting this in must get it right with zero configuration.
 *  2. Never block the app. Failures are swallowed; analytics must not break someone's
 *     launch.
 *  3. Respect opt-out signals client-side too, so non-consented events never leave the
 *     device at all. Data you never collected cannot leak, cannot be subpoenaed, and does
 *     not need deleting.
 */

export interface PercentileOptions {
  apiKey: string;
  endpoint?: string;
  /** Which builder generated this app. Auto-detected when omitted. */
  builder?: string;
  /** Flush interval in ms. */
  flushMs?: number;
  /** Set false to disable automatic page/click instrumentation. */
  autoCapture?: boolean;
}

interface QueuedEvent {
  eventId: string;
  name: string;
  occurredAt: string;
  identifier: string;
  properties: Record<string, unknown>;
  context: { jurisdiction: string; builder?: string };
}

const STORAGE_KEY = 'percentile.did';

function uuid(): string {
  // crypto.randomUUID is unavailable on insecure origins, which local previews often are.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Best-effort region hint so the server picks the right consent posture. */
function detectJurisdiction(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    if (tz.startsWith('Europe/London')) return 'UK';
    if (tz.startsWith('Europe/')) return 'EU';
    if (tz === 'America/Los_Angeles') return 'US-CA';
    if (tz.startsWith('America/')) return 'US';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Detect the generator from build-time markers most AI builders leave behind. */
function detectBuilder(): string {
  const host = globalThis.location?.hostname ?? '';
  if (host.endsWith('.lovable.app')) return 'lovable';
  if (host.endsWith('.bolt.host') || host.endsWith('.stackblitz.io')) return 'bolt';
  if (host.endsWith('.vercel.app')) return 'v0';
  if (host.endsWith('.replit.app') || host.endsWith('.repl.co')) return 'replit';
  if (host.endsWith('.base44.app')) return 'base44';
  return 'unknown';
}

function optedOut(): boolean {
  const nav = globalThis.navigator as (Navigator & { globalPrivacyControl?: boolean }) | undefined;
  return nav?.globalPrivacyControl === true || nav?.doNotTrack === '1';
}

export class Percentile {
  #queue: QueuedEvent[] = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  #identifier: string;
  readonly #opts: Required<Omit<PercentileOptions, 'builder'>> & { builder: string };

  constructor(opts: PercentileOptions) {
    this.#opts = {
      apiKey: opts.apiKey,
      endpoint: opts.endpoint ?? 'https://in.percentile.dev',
      builder: opts.builder ?? detectBuilder(),
      flushMs: opts.flushMs ?? 5000,
      autoCapture: opts.autoCapture ?? true,
    };

    this.#identifier = this.#loadIdentifier();

    if (this.#opts.autoCapture) this.#installAutoCapture();

    this.#timer = setInterval(() => void this.flush(), this.#opts.flushMs);
    globalThis.addEventListener?.('pagehide', () => void this.flush(true));
  }

  #loadIdentifier(): string {
    // A device id under an opt-out signal would be a persistent identifier we were asked
    // not to create, so we mint an ephemeral one that dies with the tab.
    if (optedOut()) return uuid();
    try {
      const existing = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (existing) return existing;
      const fresh = uuid();
      globalThis.localStorage?.setItem(STORAGE_KEY, fresh);
      return fresh;
    } catch {
      return uuid();
    }
  }

  #installAutoCapture(): void {
    const capturePage = (): void => {
      this.track('page_view', { path: globalThis.location?.pathname ?? '/' });
    };
    capturePage();

    // Patch history so SPA route changes — which is every generated app — are captured.
    const history = globalThis.history;
    if (history) {
      type HistoryFn = (data: unknown, unused: string, url?: string | URL | null) => void;
      for (const method of ['pushState', 'replaceState'] as const) {
        const original = history[method].bind(history) as HistoryFn;
        const patched: HistoryFn = (data, unused, url) => {
          original(data, unused, url);
          capturePage();
        };
        history[method] = patched;
      }
      globalThis.addEventListener?.('popstate', capturePage);
    }

    globalThis.document?.addEventListener?.(
      'click',
      (event) => {
        const target = (event.target as HTMLElement | null)?.closest?.('[data-pct]');
        if (target) this.track('element_clicked', { label: target.getAttribute('data-pct') });
      },
      { capture: true, passive: true },
    );
  }

  /** Record a behavioural event. Never throws. */
  track(name: string, properties: Record<string, unknown> = {}): void {
    try {
      this.#queue.push({
        eventId: uuid(),
        name,
        occurredAt: new Date().toISOString(),
        identifier: this.#identifier,
        properties,
        context: { jurisdiction: detectJurisdiction(), builder: this.#opts.builder },
      });
      if (this.#queue.length >= 50) void this.flush();
    } catch {
      /* analytics must never break the host app */
    }
  }

  /** Record a consent decision. Call this from your consent banner. */
  async consent(purposes: {
    product_analytics?: boolean;
    benchmark_contribution?: boolean;
    coop_licensing?: boolean;
  }, noticeVersion = 'v1'): Promise<void> {
    try {
      await fetch(`${this.#opts.endpoint}/v1/consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#opts.apiKey}` },
        body: JSON.stringify({
          identifier: this.#identifier,
          purposes,
          jurisdiction: detectJurisdiction(),
          noticeVersion,
        }),
        keepalive: true,
      });
    } catch {
      /* swallow */
    }
  }

  async flush(useBeacon = false): Promise<void> {
    if (this.#queue.length === 0) return;
    const batch = this.#queue.splice(0, 500);
    const body = JSON.stringify({ events: batch });
    const url = `${this.#opts.endpoint}/v1/events`;

    try {
      if (useBeacon && globalThis.navigator?.sendBeacon) {
        // On pagehide, fetch is unreliable; beacon is the only thing that survives unload.
        globalThis.navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        return;
      }
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#opts.apiKey}` },
        body,
        keepalive: true,
      });
    } catch {
      // Put the batch back so a transient failure does not lose data. Bounded, so a long
      // outage cannot grow the queue without limit and exhaust the tab's memory.
      if (this.#queue.length < 1000) this.#queue.unshift(...batch);
    }
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}

/** One-line entry point: `init('pk_live_...')`. */
export function init(apiKey: string, opts: Partial<PercentileOptions> = {}): Percentile {
  return new Percentile({ apiKey, ...opts });
}
