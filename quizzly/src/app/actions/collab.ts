"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import {
  joinCollab,
  lockCollab,
  reopenCollab,
  removeSubmission,
  submitQuestion,
  withdrawQuestion,
} from "@/lib/collab";
import type { ActionState } from "./quiz";

export async function joinCollabAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const code = String(formData.get("code") ?? "").trim();

  if (!code) return { error: "Enter the invite code." };

  const result = await joinCollab(code, user.id, user.displayName);
  if (!result.ok) return { error: result.error };

  redirect(`/collab/${result.quizId}/contribute`);
}

export async function submitQuestionAction(
  quizId: string,
  input: {
    prompt: string;
    payload: unknown;
    presentation: unknown;
    timeLimitSec: number;
    points: number;
    explanation?: string | null;
  },
): Promise<ActionState> {
  const user = await requireUser();

  const result = await submitQuestion({
    quizId,
    authorId: user.id,
    authorName: user.displayName,
    prompt: input.prompt,
    payload: input.payload,
    presentation: input.presentation,
    timeLimitSec: input.timeLimitSec,
    points: input.points,
    explanation: input.explanation ?? null,
  });

  if (!result.ok) return { error: result.error };

  revalidatePath(`/collab/${quizId}/contribute`);
  return { ok: true, message: "Submitted. Nobody else can see it until it's played." };
}

export async function withdrawQuestionAction(
  questionId: string,
  quizId: string,
): Promise<ActionState> {
  const user = await requireUser();

  const result = await withdrawQuestion(questionId, user.id);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/collab/${quizId}/contribute`);
  return { ok: true };
}

export async function lockCollabAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const quizId = String(formData.get("quizId") ?? "");

  await lockCollab(quizId, user.id);
  revalidatePath(`/collab/${quizId}`);
}

export async function reopenCollabAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const quizId = String(formData.get("quizId") ?? "");

  await reopenCollab(quizId, user.id);
  revalidatePath(`/collab/${quizId}`);
}

export async function removeSubmissionAction(
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const questionId = String(formData.get("questionId") ?? "");
  const quizId = String(formData.get("quizId") ?? "");

  await removeSubmission(questionId, user.id);
  revalidatePath(`/collab/${quizId}/review`);
}
