"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { generateGamePin } from "@/lib/crypto";
import {
  questionPayloadSchema,
  validatePayloadIntegrity,
  QUESTION_TYPE_MAP,
  type QuestionTypeName,
} from "@/lib/question-schema";
import {
  DEFAULT_THEME,
  DEFAULT_PRESENTATION,
  presentationSchema,
  themeSchema,
  validatePresentation,
} from "@/lib/theme";
import { DEFAULT_SETTINGS, quizSettingsSchema } from "@/lib/scoring";
import { createCollabQuiz } from "@/lib/collab";
import { generateQuiz, generateRequestSchema, AiError } from "@/lib/ai";

/**
 * Quiz management actions.
 *
 * Every one of these re-establishes who the caller is via `requireUser()` and
 * then checks ownership of the specific row. Being signed in is not the same as
 * being allowed to touch *this* quiz — that distinction is the single most
 * commonly missed authorisation check, so it is made explicitly, per action,
 * by `ownedQuiz()` below.
 */

export interface ActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

/** Load a quiz only if the current user owns it. */
async function ownedQuiz(quizId: string, userId: string) {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    select: {
      id: true,
      ownerId: true,
      mode: true,
      title: true,
      theme: true,
      settings: true,
      collabStage: true,
    },
  });

  // Returning "not found" rather than "forbidden" for someone else's quiz
  // avoids confirming that a given quiz id exists.
  if (!quiz || quiz.ownerId !== userId) return null;
  return quiz;
}

// ────────────────────────────── Create & delete ─────────────────────────────

export async function createQuizAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const title = String(formData.get("title") ?? "").trim() || "Untitled quiz";
  const mode = String(formData.get("mode") ?? "SOLO");

  if (mode === "COLLAB") {
    const quota = Math.min(
      10,
      Math.max(1, Number(formData.get("quota") ?? 3) || 3),
    );

    const quiz = await createCollabQuiz({
      ownerId: user.id,
      title: title.slice(0, 120),
      quota,
      revealAuthors: formData.get("revealAuthors") !== "off",
      theme: DEFAULT_THEME as unknown as Prisma.InputJsonValue,
      settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
    });

    revalidatePath("/dashboard");
    redirect(`/collab/${quiz.id}`);
  }

  const quiz = await db.quiz.create({
    data: {
      ownerId: user.id,
      title: title.slice(0, 120),
      mode: "SOLO",
      theme: DEFAULT_THEME as unknown as Prisma.InputJsonValue,
      settings: DEFAULT_SETTINGS as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  revalidatePath("/dashboard");
  redirect(`/quiz/${quiz.id}/edit`);
}

export async function deleteQuizAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const quizId = String(formData.get("quizId") ?? "");

  const quiz = await ownedQuiz(quizId, user.id);
  if (!quiz) return;

  // Questions, games, players and answers all cascade from the schema.
  await db.quiz.delete({ where: { id: quizId } });
  revalidatePath("/dashboard");
}

// ──────────────────────────────── Metadata ──────────────────────────────────

const metaSchema = z.object({
  title: z.string().trim().min(1, "Give the quiz a title.").max(120),
  description: z.string().trim().max(500).optional(),
});

export async function updateQuizMetaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const quizId = String(formData.get("quizId") ?? "");

  const quiz = await ownedQuiz(quizId, user.id);
  if (!quiz) return { error: "Quiz not found." };

  const parsed = metaSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  await db.quiz.update({
    where: { id: quizId },
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
    },
  });

  revalidatePath(`/quiz/${quizId}/edit`);
  return { ok: true, message: "Saved." };
}

export async function updateThemeAction(
  quizId: string,
  rawTheme: unknown,
): Promise<ActionState> {
  const user = await requireUser();
  const quiz = await ownedQuiz(quizId, user.id);
  if (!quiz) return { error: "Quiz not found." };

  const parsed = themeSchema.safeParse(rawTheme);
  if (!parsed.success) return { error: "That theme isn't valid." };

  await db.quiz.update({
    where: { id: quizId },
    data: { theme: parsed.data as unknown as Prisma.InputJsonValue },
  });

  revalidatePath(`/quiz/${quizId}/edit`);
  return { ok: true, message: "Theme updated." };
}

export async function updateSettingsAction(
  quizId: string,
  rawSettings: unknown,
): Promise<ActionState> {
  const user = await requireUser();
  const quiz = await ownedQuiz(quizId, user.id);
  if (!quiz) return { error: "Quiz not found." };

  const parsed = quizSettingsSchema.safeParse(rawSettings);
  if (!parsed.success) return { error: "Those settings aren't valid." };

  await db.quiz.update({
    where: { id: quizId },
    data: { settings: parsed.data as unknown as Prisma.InputJsonValue },
  });

  revalidatePath(`/quiz/${quizId}/edit`);
  return { ok: true, message: "Settings updated." };
}

// ──────────────────────────────── Questions ─────────────────────────────────

export async function addQuestionAction(
  quizId: string,
  type: QuestionTypeName,
): Promise<ActionState & { questionId?: string }> {
  const user = await requireUser();
  const quiz = await ownedQuiz(quizId, user.id);
  if (!quiz) return { error: "Quiz not found." };

  const meta = QUESTION_TYPE_MAP.get(type);
  if (!meta) return { error: "Unknown question type." };

  const count = await db.question.count({ where: { quizId } });
  if (count >= env.MAX_QUESTIONS_PER_QUIZ) {
    return { error: `A quiz can hold at most ${env.MAX_QUESTIONS_PER_QUIZ} questions.` };
  }

  const created = await db.question.create({
    data: {
      quizId,
      order: count,
      type,
      prompt: "",
      payload: meta.defaults() as unknown as Prisma.InputJsonValue,
      presentation: DEFAULT_PRESENTATION as unknown as Prisma.InputJsonValue,
      timeLimitSec: 20,
      points: meta.scored ? 1000 : 0,
    },
    select: { id: true },
  });

  revalidatePath(`/quiz/${quizId}/edit`);
  return { ok: true, questionId: created.id };
}

const saveQuestionSchema = z.object({
  questionId: z.string().min(1),
  prompt: z.string().trim().min(1, "Write the question.").max(500),
  payload: z.unknown(),
  presentation: z.unknown(),
  timeLimitSec: z.number().int().min(5).max(300),
  points: z.number().int().min(0).max(10_000),
  explanation: z.string().trim().max(500).optional().nullable(),
});

export async function saveQuestionAction(input: unknown): Promise<ActionState> {
  const user = await requireUser();

  const parsed = saveQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the question." };
  }

  const question = await db.question.findUnique({
    where: { id: parsed.data.questionId },
    select: { quizId: true, quiz: { select: { ownerId: true } } },
  });
  if (!question || question.quiz.ownerId !== user.id) {
    return { error: "Question not found." };
  }

  const payload = questionPayloadSchema.safeParse(parsed.data.payload);
  if (!payload.success) return { error: "Fill in every answer option." };

  const integrity = validatePayloadIntegrity(payload.data);
  if (!integrity.ok) return { error: integrity.error };

  const presentation = presentationSchema.safeParse(parsed.data.presentation);
  if (!presentation.success) return { error: "The layout settings are invalid." };

  const presentationCheck = validatePresentation(presentation.data);
  if (!presentationCheck.ok) return { error: presentationCheck.error };

  await db.question.update({
    where: { id: parsed.data.questionId },
    data: {
      prompt: parsed.data.prompt,
      type: payload.data.type,
      payload: payload.data as unknown as Prisma.InputJsonValue,
      presentation: presentation.data as unknown as Prisma.InputJsonValue,
      timeLimitSec: parsed.data.timeLimitSec,
      points: parsed.data.points,
      explanation: parsed.data.explanation?.trim() || null,
    },
  });

  revalidatePath(`/quiz/${question.quizId}/edit`);
  return { ok: true, message: "Saved." };
}

export async function deleteQuestionAction(questionId: string): Promise<ActionState> {
  const user = await requireUser();

  const question = await db.question.findUnique({
    where: { id: questionId },
    select: { quizId: true, quiz: { select: { ownerId: true } } },
  });
  if (!question || question.quiz.ownerId !== user.id) {
    return { error: "Question not found." };
  }

  await db.$transaction(async (tx) => {
    await tx.question.delete({ where: { id: questionId } });

    // Close the gap in `order` so positions stay contiguous — otherwise
    // repeated deletes leave holes that make reordering confusing.
    const remaining = await tx.question.findMany({
      where: { quizId: question.quizId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    await Promise.all(
      remaining.map((q, index) =>
        tx.question.update({ where: { id: q.id }, data: { order: index } }),
      ),
    );
  });

  revalidatePath(`/quiz/${question.quizId}/edit`);
  return { ok: true };
}

export async function reorderQuestionAction(
  questionId: string,
  direction: "up" | "down",
): Promise<ActionState> {
  const user = await requireUser();

  const question = await db.question.findUnique({
    where: { id: questionId },
    select: { quizId: true, order: true, quiz: { select: { ownerId: true } } },
  });
  if (!question || question.quiz.ownerId !== user.id) {
    return { error: "Question not found." };
  }

  const targetOrder = question.order + (direction === "up" ? -1 : 1);
  const neighbour = await db.question.findFirst({
    where: { quizId: question.quizId, order: targetOrder },
    select: { id: true },
  });
  if (!neighbour) return { ok: true }; // already at the end

  // Two-step swap via a temporary position, because `order` has no unique
  // constraint but a direct swap would still momentarily collide if it did.
  await db.$transaction([
    db.question.update({ where: { id: questionId }, data: { order: -1 } }),
    db.question.update({ where: { id: neighbour.id }, data: { order: question.order } }),
    db.question.update({ where: { id: questionId }, data: { order: targetOrder } }),
  ]);

  revalidatePath(`/quiz/${question.quizId}/edit`);
  return { ok: true };
}

// ─────────────────────────────── AI drafting ────────────────────────────────

export async function generateQuestionsAction(
  quizId: string,
  rawRequest: unknown,
): Promise<ActionState & { added?: number }> {
  const user = await requireUser();
  const quiz = await ownedQuiz(quizId, user.id);
  if (!quiz) return { error: "Quiz not found." };

  const parsed = generateRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the generation options." };
  }

  let result;
  try {
    result = await generateQuiz(user.id, parsed.data);
  } catch (err) {
    // AiError messages are written for users; anything else is unexpected and
    // must not have its raw text shown.
    if (err instanceof AiError) return { error: err.message };
    console.error("[quiz] generation failed", err);
    return { error: "Something went wrong generating questions." };
  }

  const existing = await db.question.count({ where: { quizId } });
  const room = Math.max(0, env.MAX_QUESTIONS_PER_QUIZ - existing);
  const toAdd = result.questions.slice(0, room);

  if (toAdd.length === 0) {
    return { error: "This quiz is already at its question limit." };
  }

  await db.question.createMany({
    data: toAdd.map((q, index) => ({
      quizId,
      order: existing + index,
      type: q.type,
      prompt: q.prompt,
      payload: q.payload as unknown as Prisma.InputJsonValue,
      presentation: DEFAULT_PRESENTATION as unknown as Prisma.InputJsonValue,
      timeLimitSec: 20,
      points: 1000,
      explanation: q.explanation,
    })),
  });

  revalidatePath(`/quiz/${quizId}/edit`);
  return {
    ok: true,
    added: toAdd.length,
    message: `Added ${toAdd.length} draft question${toAdd.length === 1 ? "" : "s"}. Review them before you play.`,
  };
}

// ────────────────────────────── Hosting a game ──────────────────────────────

export async function startGameAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const quizId = String(formData.get("quizId") ?? "");

  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    select: {
      id: true,
      ownerId: true,
      title: true,
      theme: true,
      settings: true,
      mode: true,
      collabRevealAuthors: true,
      questions: { orderBy: { order: "asc" } },
    },
  });

  if (!quiz || quiz.ownerId !== user.id) redirect("/dashboard");
  if (quiz.questions.length === 0) redirect(`/quiz/${quizId}/edit?error=empty`);

  const settings = quizSettingsSchema.parse(quiz.settings);
  const theme = themeSchema.parse(quiz.theme);

  // Freeze the quiz into the game. From here the live game reads only this
  // snapshot, so editing the quiz mid-game cannot change it under the players.
  let questions = quiz.questions.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    payload: q.payload,
    presentation: q.presentation,
    timeLimitSec: q.timeLimitSec,
    points: q.points,
    explanation: q.explanation,
    // Author credit is only carried when the quiz opted into revealing it.
    authorName: quiz.collabRevealAuthors ? q.authorName : null,
  }));

  // Group quizzes always shuffle: submission order would otherwise leak who
  // contributed what, which is exactly what the mode promises not to do.
  if (settings.shuffleQuestions || quiz.mode === "COLLAB") {
    questions = shuffle(questions);
  }

  const snapshot = {
    quizId: quiz.id,
    title: quiz.title,
    theme,
    settings,
    isCollab: quiz.mode === "COLLAB",
    questions,
  };

  // Retry on PIN collision — six digits across concurrent live games will
  // occasionally clash.
  let game: { id: string } | null = null;
  for (let attempt = 0; attempt < 6 && !game; attempt++) {
    try {
      game = await db.game.create({
        data: {
          quizId: quiz.id,
          hostId: user.id,
          pin: generateGamePin(),
          quizSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
    }
  }

  if (!game) redirect(`/quiz/${quizId}/edit?error=pin`);

  redirect(`/host/${game.id}`);
}

/** Fisher–Yates. `sort(() => Math.random() - 0.5)` is not a shuffle. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
