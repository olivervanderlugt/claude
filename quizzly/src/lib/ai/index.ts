import "server-only";

import { db } from "../db";
import { env, aiConfigured } from "../env";
import { decryptSecret } from "../crypto";
import { consume } from "../rate-limit";
import { AnthropicProvider } from "./anthropic";
import {
  AiError,
  type AiAvailability,
  type AiProvider,
  type GenerateRequest,
  type GenerateResult,
} from "./provider";

export * from "./provider";

const provider: AiProvider = new AnthropicProvider();

/**
 * Resolve which key to use, preferring the user's own.
 *
 * A user who has saved their own key spends their own budget; everyone else
 * falls back to the server key if the operator configured one. If neither
 * exists the feature reports itself unavailable rather than throwing — the
 * whole app must stay usable with no AI configured at all.
 */
async function resolveKey(
  userId: string,
): Promise<{ key: string; source: "user" | "server" } | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { encryptedAiKey: true },
  });

  if (user?.encryptedAiKey) {
    const decrypted = decryptSecret(user.encryptedAiKey);
    // A null here means ENCRYPTION_KEY changed under us. Fall through to the
    // server key rather than failing outright.
    if (decrypted) return { key: decrypted, source: "user" };
  }

  const serverKey = env.ANTHROPIC_API_KEY?.trim();
  if (serverKey) return { key: serverKey, source: "server" };

  return null;
}

export async function getAiAvailability(userId: string): Promise<AiAvailability> {
  const resolved = await resolveKey(userId);

  if (!resolved) {
    return {
      available: false,
      source: "none",
      reason: aiConfigured
        ? "AI generation isn't available on this account."
        : "AI generation isn't set up on this server yet. Add an ANTHROPIC_API_KEY to the environment, or save your own key in Settings.",
    };
  }

  return { available: true, source: resolved.source };
}

export async function generateQuiz(
  userId: string,
  request: GenerateRequest,
): Promise<GenerateResult> {
  const resolved = await resolveKey(userId);

  if (!resolved) {
    throw new AiError(
      "AI generation isn't configured. Add your own API key in Settings, or ask the administrator to set ANTHROPIC_API_KEY.",
    );
  }

  // Rate-limit server-key usage only. Someone spending their own key is
  // spending their own money and shouldn't be throttled by our budget guard.
  if (resolved.source === "server") {
    const limit = consume(`ai:${userId}`, {
      limit: env.AI_RATE_LIMIT_PER_HOUR,
      windowMs: 60 * 60_000,
    });

    if (!limit.allowed) {
      const minutes = Math.ceil(limit.retryAfterMs / 60_000);
      throw new AiError(
        `You've used your ${env.AI_RATE_LIMIT_PER_HOUR} AI generations for this hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or add your own API key in Settings to lift the limit.`,
      );
    }
  }

  return provider.generateQuiz(request, resolved.key);
}
