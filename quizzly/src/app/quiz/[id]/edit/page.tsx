import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAiAvailability } from "@/lib/ai";
import { questionPayloadSchema } from "@/lib/question-schema";
import { presentationSchema, themeSchema } from "@/lib/theme";
import { quizSettingsSchema } from "@/lib/scoring";
import { startGameAction } from "@/app/actions/quiz";
import { EditorClient } from "@/components/editor/EditorClient";

export const metadata = { title: "Edit quiz" };

export default async function EditQuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/quiz/${id}/edit`);

  const quiz = await db.quiz.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      title: true,
      description: true,
      theme: true,
      settings: true,
      mode: true,
      questions: { orderBy: { order: "asc" } },
    },
  });

  // Same response for "doesn't exist" and "isn't yours" — no existence oracle.
  if (!quiz || quiz.ownerId !== user.id) notFound();

  const ai = await getAiAvailability(user.id);

  // Parse stored JSON through the schemas here, once, so the client component
  // receives well-typed data and never has to defend against a bad row.
  const questions = quiz.questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    payload: questionPayloadSchema.parse(q.payload),
    presentation: presentationSchema.parse(q.presentation),
    timeLimitSec: q.timeLimitSec,
    points: q.points,
    explanation: q.explanation,
  }));

  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="sticky top-0 z-10 border-b border-ink-800 bg-ink-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3">
          <Link href="/dashboard" className="text-sm text-ink-400 hover:text-ink-200">
            ← Dashboard
          </Link>
          <span className="min-w-0 flex-1 truncate font-semibold text-white">
            {quiz.title}
          </span>
          <span className="hidden text-sm text-ink-500 sm:inline">
            {questions.length} question{questions.length === 1 ? "" : "s"}
          </span>
          <form action={startGameAction}>
            <input type="hidden" name="quizId" value={quiz.id} />
            <button
              type="submit"
              disabled={questions.length === 0}
              className="btn btn-primary py-1.5 text-sm"
            >
              Host
            </button>
          </form>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-5 py-6">
        <EditorClient
          quizId={quiz.id}
          title={quiz.title}
          description={quiz.description}
          initialQuestions={questions}
          initialTheme={themeSchema.parse(quiz.theme)}
          initialSettings={quizSettingsSchema.parse(quiz.settings)}
          ai={ai}
        />
      </main>
    </div>
  );
}
