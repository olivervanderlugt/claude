"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { destroyAllSessions, requireUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import type { ActionState } from "./quiz";

/**
 * Saving a personal Anthropic API key.
 *
 * Stored AES-256-GCM encrypted, and never sent back to the browser — the
 * settings page can only report whether one is set, not what it is. There is
 * deliberately no "reveal key" feature: the user already has the key, and a
 * read path is only useful to an attacker.
 */
export async function saveAiKeyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const raw = String(formData.get("apiKey") ?? "").trim();

  if (raw === "") {
    await db.user.update({
      where: { id: user.id },
      data: { encryptedAiKey: null },
    });
    revalidatePath("/settings");
    return { ok: true, message: "Key removed. You'll use the server's key, if it has one." };
  }

  // Cheap shape check to catch a pasted-wrong-thing before it reaches the API.
  if (!raw.startsWith("sk-ant-") || raw.length < 30) {
    return { error: "That doesn't look like an Anthropic API key (they start with `sk-ant-`)." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { encryptedAiKey: encryptSecret(raw) },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Key saved and encrypted." };
}

/**
 * Account deletion.
 *
 * A hard delete, not a soft flag. Quizzes, questions, games, players and
 * answers all cascade. This is the GDPR Article 17 path and it has to actually
 * delete — see docs/LEGAL.md.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  // Typing your own email is a deliberate speed bump on an irreversible action.
  const confirmation = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
  if (confirmation !== user.email.toLowerCase()) {
    redirect("/settings?error=confirm");
  }

  await destroyAllSessions(user.id);
  await db.user.delete({ where: { id: user.id } });

  redirect("/");
}
