/**
 * In-memory sliding-window rate limiter.
 *
 * Deliberately dependency-free and process-local. That is the right trade for a
 * single-instance deploy, which is what this ships as. If you scale to multiple
 * instances the limits become per-instance — see docs/DEPLOYMENT.md for the
 * Redis swap, which is a drop-in replacement for `consume()` below.
 *
 * Used for: login attempts, signup, AI generation, game joins, and per-socket
 * event floods.
 */

type Bucket = { hits: number[]; blockedUntil: number };

const buckets = new Map<string, Bucket>();

// Stop the map growing without bound on a long-lived server.
const SWEEP_INTERVAL_MS = 60_000;
let sweeper: NodeJS.Timeout | null = null;

function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      const stale =
        bucket.blockedUntil < now &&
        (bucket.hits.length === 0 || bucket.hits[bucket.hits.length - 1]! < now - 3_600_000);
      if (stale) buckets.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  // Don't hold the process open just for cleanup.
  sweeper.unref?.();
}

export interface RateLimitRule {
  /** Max events allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Optional lockout applied once the limit is exceeded. */
  blockMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the caller may retry. Zero when allowed. */
  retryAfterMs: number;
}

export function consume(key: string, rule: RateLimitRule): RateLimitResult {
  startSweeper();

  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [], blockedUntil: 0 };

  if (bucket.blockedUntil > now) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.blockedUntil - now };
  }

  const windowStart = now - rule.windowMs;
  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  if (bucket.hits.length >= rule.limit) {
    if (rule.blockMs) bucket.blockedUntil = now + rule.blockMs;
    buckets.set(key, bucket);

    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: rule.blockMs ?? Math.max(0, oldest + rule.windowMs - now),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  return {
    allowed: true,
    remaining: rule.limit - bucket.hits.length,
    retryAfterMs: 0,
  };
}

/** Clear a key — call after a successful login so one typo isn't punished. */
export function reset(key: string): void {
  buckets.delete(key);
}

// ── Named rules, so limits live in one place rather than scattered as magic
//    numbers across route handlers. ──

export const RULES = {
  /** Brute-force protection. Ten minutes off after five bad attempts. */
  login: { limit: 5, windowMs: 15 * 60_000, blockMs: 10 * 60_000 },
  signup: { limit: 3, windowMs: 60 * 60_000 },
  /** AI generation is the expensive one — this is a spend cap, not just abuse control. */
  aiGenerate: { limit: 20, windowMs: 60 * 60_000 },
  /** Joining games: generous, since a whole classroom joins from one NAT'd IP. */
  gameJoin: { limit: 30, windowMs: 60_000 },
  /** Per-socket event flood guard. */
  socketEvent: { limit: 60, windowMs: 60_000 },
  /** Answer submissions — one per question, so this only catches scripted spam. */
  socketAnswer: { limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;
