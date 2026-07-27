import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getQuestionsFor } from "@/lib/collab";
import { ContributeClient } from "@/components/collab/ContributeClient";

export const metadata = { title: "Contribute questions" };

export default async function ContributePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/collab/${id}/contribute`);

  const quiz = await db.quiz.findUnique({
    where: { id },
    select: {
      title: true,
      mode: true,
      collabStage: true,
      collabQuota: true,
      ownerReviewedAt: true,
      ownerId: true,
    },
  });
  if (!quiz || quiz.mode !== "COLLAB") notFound();

  const contributor = await db.collabContributor.findUnique({
    where: { quizId_userId: { quizId: id, userId: user.id } },
    select: { id: true },
  });
  if (!contributor) redirect("/collab/join");

  // Goes through the collab read layer, which returns other people's questions
  // as opaque placeholders — this page cannot leak them even by accident.
  const questions = await getQuestionsFor(id, user.id);
  const mine = questions.filter((q) => q.visible && q.mine);
  const otherCount = questions.length - mine.length;

  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="border-b border-ink-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/dashboard" className="text-sm text-ink-400 hover:text-ink-200">
            ← Dashboard
          </Link>
          <span className="text-sm text-ink-400">Contributing</span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-bold text-white">{quiz.title}</h1>
        <p className="mt-1 text-ink-400">
          You&apos;ve submitted {mine.length} of {quiz.collabQuota}.
          {otherCount > 0
            ? ` ${otherCount} other question${otherCount === 1 ? "" : "s"} submitted — you can't see them, and they can't see yours.`
            : ""}
        </p>

        {quiz.ownerReviewedAt ? (
          <p className="mt-4 rounded-lg border border-amber-800 bg-amber-950/50 px-4 py-3 text-sm text-amber-200">
            The host reviewed all submissions on{" "}
            {quiz.ownerReviewedAt.toLocaleDateString()} to check for anything
            inappropriate. They&apos;ve seen your questions.
          </p>
        ) : null}

        {quiz.collabStage === "LOCKED" ? (
          <p className="mt-4 rounded-lg border border-ink-700 bg-ink-900 px-4 py-3 text-sm text-ink-300">
            Submissions are closed. Your questions are locked in — see you at the
            game.
          </p>
        ) : null}

        <ContributeClient
          quizId={id}
          quota={quiz.collabQuota}
          locked={quiz.collabStage === "LOCKED"}
          existing={mine.map((q) => ({
            id: q.id,
            prompt: q.visible ? q.prompt : "",
            type: q.visible ? q.type : "",
          }))}
        />
      </main>
    </div>
  );
}
