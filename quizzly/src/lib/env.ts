import { z } from "zod";

/**
 * Environment validation.
 *
 * This runs once at boot and throws loudly if anything is missing or malformed.
 * The alternative — discovering that SESSION_SECRET was undefined when the first
 * user tries to log in at 2am — is strictly worse. A container that refuses to
 * start is a much better failure than one that starts and is quietly insecure.
 */

const base64Key = z
  .string()
  .min(32, "must be at least 32 characters — generate with `openssl rand -base64 32`")
  .refine(
    (v) => !v.startsWith("replace-me"),
    "still set to the placeholder from .env.example — generate a real one with `openssl rand -base64 32`",
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  APP_ORIGIN: z
    .string()
    .url("must be a full URL, e.g. https://quizzly.example.com")
    .refine((v) => !v.endsWith("/"), "must not have a trailing slash"),

  DATABASE_URL: z.string().min(1, "is required"),

  SESSION_SECRET: base64Key,
  ENCRYPTION_KEY: base64Key,

  // Optional: the app is fully functional without AI configured.
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5"),
  AI_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(20),

  REDIS_URL: z.string().optional(),

  MAX_PLAYERS_PER_GAME: z.coerce.number().int().positive().max(10_000).default(500),
  MAX_QUESTIONS_PER_QUIZ: z.coerce.number().int().positive().max(500).default(100),
});

/**
 * `next build` statically analyses pages, which imports this module — but the
 * real secrets and origin are injected at *runtime*, not at image-build time.
 * Enforcing the full rules during the build would mean baking production
 * secrets into the Docker build, which is exactly what you don't want.
 *
 * So during the build phase we fall back to placeholders. The strict checks
 * still run on every real boot, which is the moment that matters.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const BUILD_PLACEHOLDERS = {
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  SESSION_SECRET: "build-time-placeholder-not-used-at-runtime",
  ENCRYPTION_KEY: "build-time-placeholder-not-used-at-runtime",
} as const;

function load() {
  const source = isBuildPhase
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : process.env;

  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")} ${i.message}`)
      .join("\n");
    throw new Error(
      `\n\nInvalid environment configuration:\n\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the blanks.\n`,
    );
  }

  const env = parsed.data;

  // Catch the single most damaging misconfiguration: serving production over
  // plain HTTP on a real domain. Secure cookies would silently never be set, so
  // every session would break — better to refuse to boot than to be quietly
  // broken.
  //
  // Loopback is exempt. `docker compose up` runs the production build against
  // http://localhost:3000, which is the documented way to try this locally, and
  // browsers treat localhost as a secure context — `Secure` cookies work there
  // over plain HTTP. Rejecting it would block the quick start to prevent a
  // problem that cannot occur.
  if (
    !isBuildPhase &&
    env.NODE_ENV === "production" &&
    env.APP_ORIGIN.startsWith("http://") &&
    !isLoopback(env.APP_ORIGIN)
  ) {
    throw new Error(
      `APP_ORIGIN is set to ${env.APP_ORIGIN}, but session cookies are marked ` +
        "`Secure` in production and a browser will not send those over plain " +
        "HTTP — every login would silently fail.\n\n" +
        "Either put TLS in front and use https://, or set NODE_ENV=development " +
        "if you are deliberately running unencrypted on a trusted network.",
    );
  }

  return env;
}

/**
 * True for origins browsers treat as a secure context despite plain HTTP.
 *
 * Matches the WHATWG "potentially trustworthy origin" rules for loopback, which
 * is what Chrome and Firefox actually implement.
 */
function isLoopback(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host.startsWith("127.") ||
      host === "::1"
    );
  } catch {
    return false;
  }
}

/** Treat an empty-string env var as absent, so a placeholder can fill in. */
function stripEmpty(
  source: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

export const env = load();

/** True when AI features should be offered at all. */
export const aiConfigured = Boolean(env.ANTHROPIC_API_KEY?.trim());

export const isProduction = env.NODE_ENV === "production";
