import "server-only";

import { CollabStage, type Prisma } from "@prisma/client";

import { db } from "./db";
import { env } from "./env";
import { generateCode } from "./crypto";
import {
  questionPayloadSchema,
  validatePayloadIntegrity,
  type QuestionPayload,
} from "./question-schema";
import {
  presentationSchema,
  validatePresentation,
  DEFAULT_PRESENTATION,
} from "./theme";

/**
 * Blind group quizzes.
 *
 * The promise the feature makes to a contributor is: *nobody sees what you
 * wrote until it appears on screen during the game*. That promise is worth
 * nothing if it is implemented as "the UI doesn't render other people's
 * questions" — anyone who opens devtools, or any future endpoint written by
 * someone who forgot, breaks it.
 *
 * So this module is the only sanctioned way to read questions from a
 * collaborative quiz, and it takes the viewer's identity as a required argument.
 * The rules it enforces:
 *
 *   • A contributor can read their own submissions, always.
 *   • Nobody can read anyone else's until `revealedAt` is set, which only the
 *     live game engine does, one question at a time, as it plays them.
 *   • The quiz owner is not privileged here. They are a player too, and the
 *     surprise is the point. The one exception is `reviewSubmissions()`, an
 *     explicit moderation escape hatch that permanently stamps
 *     `ownerReviewedAt` so contributors can see it was used.
 *
 * The `AuthorisedQuestion` type has no `payload` or `prompt` unless the viewer
 * is entitled to them, so a caller cannot leak content by accident — the fields
 * simply are not there to leak.
 */

// ────────────────────────────── View models ─────────────────────────────────

/** A question the viewer may read in full. */
export interface RevealedQuestion {
  visible: true;
  id: string;
  order: number;
  type: string;
  prompt: string;
  payload: QuestionPayload;
  presentation: unknown;
  timeLimitSec: number;
  points: number;
  explanation: string | null;
  authorName: string | null;
  mine: boolean;
}

/** A question that exists but which the viewer may not read. */
export interface HiddenQuestion {
  visible: false;
  id: string;
  order: number;
  /** Deliberately the only metadata exposed — enough to render a placeholder. */
  authorName: string | null;
  mine: false;
}

export type AuthorisedQuestion = RevealedQuestion | HiddenQuestion;

// ───────────────────────────── Creating & joining ───────────────────────────

export async function createCollabQuiz(input: {
  ownerId: string;
  title: string;
  quota: number;
  revealAuthors: boolean;
  theme: Prisma.InputJsonValue;
  settings: Prisma.InputJsonValue;
}) {
  // Retry on the astronomically unlikely code collision rather than 500ing.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode(6);
    try {
      return await db.quiz.create({
        data: {
          ownerId: input.ownerId,
          title: input.title,
          mode: "COLLAB",
          collabCode: code,
          collabQuota: input.quota,
          collabRevealAuthors: input.revealAuthors,
          collabStage: CollabStage.COLLECTING,
          theme: input.theme,
          settings: input.settings,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error("Could not allocate an invite code. Please try again.");
}

export async function joinCollab(
  code: string,
  userId: string,
  displayName: string,
): Promise<{ ok: true; quizId: string } | { ok: false; error: string }> {
  const quiz = await db.quiz.findUnique({
    where: { collabCode: code.trim().toUpperCase() },
    select: { id: true, collabStage: true, mode: true },
  });

  if (!quiz || quiz.mode !== "COLLAB") {
    return { ok: false, error: "That invite code doesn't match a group quiz." };
  }
  if (quiz.collabStage !== CollabStage.COLLECTING) {
    return { ok: false, error: "This group quiz has already closed for submissions." };
  }

  await db.collabContributor.upsert({
    where: { quizId_userId: { quizId: quiz.id, userId } },
    create: { quizId: quiz.id, userId, displayName },
    update: { displayName },
  });

  return { ok: true, quizId: quiz.id };
}

// ──────────────────────────────── Reading ───────────────────────────────────

/**
 * The single sanctioned read path for a collaborative quiz's questions.
 *
 * `viewerId` is required and un-defaulted on purpose: there is no way to call
 * this without stating who is asking.
 */
export async function getQuestionsFor(
  quizId: string,
  viewerId: string | null,
): Promise<AuthorisedQuestion[]> {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    select: { mode: true, collabRevealAuthors: true },
  });
  if (!quiz) return [];

  const rows = await db.question.findMany({
    where: { quizId },
    orderBy: { order: "asc" },
  });

  return rows.map((row): AuthorisedQuestion => {
    const mine = viewerId !== null && row.authorId === viewerId;

    // A SOLO quiz has no blindness rules — the owner wrote it all. The access
    // check for *that* is ownership of the quiz, done by the caller.
    const readable = quiz.mode !== "COLLAB" || mine || row.revealedAt !== null;

    if (!readable) {
      return {
        visible: false,
        id: row.id,
        order: row.order,
        // Author names are shown during collection only if the quiz opted in;
        // otherwise even "who submitted" stays private until the reveal.
        authorName: quiz.collabRevealAuthors ? row.authorName : null,
        mine: false,
      };
    }

    return {
      visible: true,
      id: row.id,
      order: row.order,
      type: row.type,
      prompt: row.prompt,
      payload: questionPayloadSchema.parse(row.payload),
      presentation: row.presentation,
      timeLimitSec: row.timeLimitSec,
      points: row.points,
      explanation: row.explanation,
      authorName: quiz.collabRevealAuthors ? row.authorName : null,
      mine,
    };
  });
}

/** Progress board: who has submitted how many, with no question content. */
export async function getCollabProgress(quizId: string) {
  const [quiz, contributors, counts] = await Promise.all([
    db.quiz.findUnique({
      where: { id: quizId },
      select: {
        collabQuota: true,
        collabStage: true,
        collabCode: true,
        collabRevealAuthors: true,
        ownerReviewedAt: true,
        ownerId: true,
        title: true,
      },
    }),
    db.collabContributor.findMany({
      where: { quizId },
      orderBy: { joinedAt: "asc" },
      select: { userId: true, displayName: true, joinedAt: true },
    }),
    db.question.groupBy({
      by: ["authorId"],
      where: { quizId },
      _count: { _all: true },
    }),
  ]);

  if (!quiz) return null;

  const submittedBy = new Map(
    counts.map((c) => [c.authorId ?? "", c._count._all]),
  );

  return {
    quiz,
    totalQuestions: counts.reduce((sum, c) => sum + c._count._all, 0),
    contributors: contributors.map((c) => ({
      userId: c.userId,
      displayName: c.displayName,
      joinedAt: c.joinedAt,
      submitted: submittedBy.get(c.userId) ?? 0,
      quota: quiz.collabQuota,
      done: (submittedBy.get(c.userId) ?? 0) >= quiz.collabQuota,
    })),
  };
}

// ─────────────────────────────── Submitting ─────────────────────────────────

export interface SubmitInput {
  quizId: string;
  authorId: string;
  authorName: string;
  prompt: string;
  payload: unknown;
  presentation?: unknown;
  timeLimitSec: number;
  points: number;
  explanation?: string | null;
}

export async function submitQuestion(
  input: SubmitInput,
): Promise<{ ok: true; questionId: string } | { ok: false; error: string }> {
  const quiz = await db.quiz.findUnique({
    where: { id: input.quizId },
    select: { mode: true, collabStage: true, collabQuota: true },
  });

  if (!quiz) return { ok: false, error: "Quiz not found." };
  if (quiz.mode !== "COLLAB")
    return { ok: false, error: "That quiz doesn't take contributions." };
  if (quiz.collabStage !== CollabStage.COLLECTING)
    return { ok: false, error: "Submissions for this quiz are closed." };

  // Must be an accepted contributor — having the link is not enough once the
  // owner has removed someone.
  const contributor = await db.collabContributor.findUnique({
    where: { quizId_userId: { quizId: input.quizId, userId: input.authorId } },
    select: { id: true },
  });
  if (!contributor)
    return { ok: false, error: "Join the group quiz before submitting questions." };

  const parsedPayload = questionPayloadSchema.safeParse(input.payload);
  if (!parsedPayload.success) {
    return { ok: false, error: "That question isn't filled in correctly yet." };
  }

  const integrity = validatePayloadIntegrity(parsedPayload.data);
  if (!integrity.ok) return { ok: false, error: integrity.error };

  const parsedPresentation = presentationSchema.safeParse(
    input.presentation ?? DEFAULT_PRESENTATION,
  );
  if (!parsedPresentation.success)
    return { ok: false, error: "The question's layout settings are invalid." };

  const presentationCheck = validatePresentation(parsedPresentation.data);
  if (!presentationCheck.ok)
    return { ok: false, error: presentationCheck.error };

  const [ownCount, totalCount] = await Promise.all([
    db.question.count({ where: { quizId: input.quizId, authorId: input.authorId } }),
    db.question.count({ where: { quizId: input.quizId } }),
  ]);

  // The quota is a target, not a cap — but allow a little headroom rather than
  // an unbounded flood from one enthusiastic contributor.
  if (ownCount >= quiz.collabQuota * 2) {
    return {
      ok: false,
      error: `You've submitted ${ownCount} questions, well past the target of ${quiz.collabQuota}. Ask the host to raise the quota.`,
    };
  }
  if (totalCount >= env.MAX_QUESTIONS_PER_QUIZ) {
    return { ok: false, error: "This quiz has reached its question limit." };
  }

  const created = await db.question.create({
    data: {
      quizId: input.quizId,
      // Provisional ordering; the game engine shuffles at start anyway, which
      // also stops "who submitted first" being inferable from question order.
      order: totalCount,
      type: parsedPayload.data.type,
      prompt: input.prompt.trim(),
      payload: parsedPayload.data as unknown as Prisma.InputJsonValue,
      presentation: parsedPresentation.data as unknown as Prisma.InputJsonValue,
      timeLimitSec: input.timeLimitSec,
      points: input.points,
      explanation: input.explanation?.trim() || null,
      authorId: input.authorId,
      authorName: input.authorName,
      // Explicitly null. This is the flag the whole feature turns on.
      revealedAt: null,
    },
    select: { id: true },
  });

  return { ok: true, questionId: created.id };
}

/** A contributor may withdraw their own submission while collection is open. */
export async function withdrawQuestion(
  questionId: string,
  authorId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const question = await db.question.findUnique({
    where: { id: questionId },
    select: { authorId: true, revealedAt: true, quiz: { select: { collabStage: true } } },
  });

  if (!question) return { ok: false, error: "Question not found." };
  if (question.authorId !== authorId)
    return { ok: false, error: "You can only withdraw your own questions." };
  if (question.revealedAt)
    return { ok: false, error: "That question has already been played." };
  if (question.quiz.collabStage !== CollabStage.COLLECTING)
    return { ok: false, error: "Submissions are closed." };

  await db.question.delete({ where: { id: questionId } });
  return { ok: true };
}

// ─────────────────────────── Owner-only operations ──────────────────────────

export async function lockCollab(
  quizId: string,
  ownerId: string,
): Promise<{ ok: true; questionCount: number } | { ok: false; error: string }> {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    select: { ownerId: true, mode: true },
  });

  if (!quiz || quiz.ownerId !== ownerId)
    return { ok: false, error: "Quiz not found." };
  if (quiz.mode !== "COLLAB")
    return { ok: false, error: "That isn't a group quiz." };

  const questionCount = await db.question.count({ where: { quizId } });
  if (questionCount === 0)
    return { ok: false, error: "Nobody has submitted a question yet." };

  await db.quiz.update({
    where: { id: quizId },
    data: { collabStage: CollabStage.LOCKED },
  });

  return { ok: true, questionCount };
}

export async function reopenCollab(quizId: string, ownerId: string) {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    select: { ownerId: true },
  });
  if (!quiz || quiz.ownerId !== ownerId) return { ok: false as const, error: "Quiz not found." };

  await db.quiz.update({
    where: { id: quizId },
    data: { collabStage: CollabStage.COLLECTING },
  });
  return { ok: true as const };
}

/**
 * The moderation escape hatch.
 *
 * Hosts running this with students genuinely need to be able to check that
 * nobody submitted something abusive. Refusing to provide that would push them
 * to not use the feature at all. But a silent backdoor would make the promise
 * to contributors a lie, so using it permanently stamps the quiz and every
 * contributor sees "the host reviewed submissions before playing".
 *
 * Honest and useful beats secret and useful.
 */
export async function reviewSubmissions(
  quizId: string,
  ownerId: string,
): Promise<
  | { ok: true; questions: RevealedQuestion[]; firstReview: boolean }
  | { ok: false; error: string }
> {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    select: { ownerId: true, mode: true, ownerReviewedAt: true },
  });

  if (!quiz || quiz.ownerId !== ownerId)
    return { ok: false, error: "Quiz not found." };
  if (quiz.mode !== "COLLAB")
    return { ok: false, error: "That isn't a group quiz." };

  const firstReview = quiz.ownerReviewedAt === null;
  if (firstReview) {
    await db.quiz.update({
      where: { id: quizId },
      data: { ownerReviewedAt: new Date() },
    });
  }

  const rows = await db.question.findMany({
    where: { quizId },
    orderBy: { order: "asc" },
  });

  const questions: RevealedQuestion[] = rows.map((row) => ({
    visible: true,
    id: row.id,
    order: row.order,
    type: row.type,
    prompt: row.prompt,
    payload: questionPayloadSchema.parse(row.payload),
    presentation: row.presentation,
    timeLimitSec: row.timeLimitSec,
    points: row.points,
    explanation: row.explanation,
    authorName: row.authorName,
    mine: row.authorId === ownerId,
  }));

  return { ok: true, questions, firstReview };
}

/** Owners can remove a submission outright — the counterpart to reviewing. */
export async function removeSubmission(
  questionId: string,
  ownerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const question = await db.question.findUnique({
    where: { id: questionId },
    select: { quiz: { select: { id: true, ownerId: true } } },
  });

  if (!question || question.quiz.ownerId !== ownerId)
    return { ok: false, error: "Question not found." };

  await db.question.delete({ where: { id: questionId } });
  return { ok: true };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
