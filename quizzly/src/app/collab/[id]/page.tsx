import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCollabProgress } from "@/lib/collab";
import { startGameAction } from "@/app/actions/quiz";
import { lockCollabAction, reopenCollabAction } from "@/app/actions/collab";
import { CopyableCode } from "@/components/CopyableCode";

export const metadata = { title: "Group quiz" };

/**
 * The host's control room for a blind group quiz.
 *
 * Note what is *not* on this page: any question content. The host sees who has
 * contributed and how many, and nothing else — they are a player too. Reading
 * submissions requires the explicit moderation route, which stamps the quiz.
 */
export default async function CollabManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/collab/${id}`);

  const quiz = await db.quiz.findUnique({
    where: { id },
    select: { ownerId: true, mode: true },
  });
  if (!quiz || quiz.mode !== "COLLAB") notFound();

  // A contributor who lands here gets sent to their own submission page rather
  // than the host controls.
  if (quiz.ownerId !== user.id) redirect(`/collab/${id}/contribute`);

  const progress = await getCollabProgress(id);
  if (!progress) notFound();

  const allDone =
    progress.contributors.length > 0 && progress.contributors.every((c) => c.done);

  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="border-b border-ink-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link href="/dashboard" className="text-sm text-ink-400 hover:text-ink-200">
            ← Dashboard
          </Link>
          <span className="text-sm text-ink-400">Group quiz</span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold text-white">{progress.quiz.title}</h1>
        <p className="mt-1 text-ink-400">
          {progress.totalQuestions} question
          {progress.totalQuestions === 1 ? "" : "s"} submitted by{" "}
          {progress.contributors.length} contributor
          {progress.contributors.length === 1 ? "" : "s"}
        </p>

        {/* ── Invite ── */}
        <section className="app-card mt-6 p-5">
          <h2 className="font-semibold text-white">Invite code</h2>
          <p className="mt-1 text-sm text-ink-400">
            Anyone with this code and an account can contribute.
          </p>
          <CopyableCode
            code={progress.quiz.collabCode ?? ""}
            joinPath="/collab/join"
          />
        </section>

        {/* ── The promise ── */}
        <section className="mt-6 rounded-xl border border-brand-800 bg-brand-950/40 p-5">
          <h2 className="font-semibold text-brand-200">
            What contributors have been told
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-300">
            <li>• Nobody can read anyone else&apos;s questions before the game.</li>
            <li>
              • That includes you. This page deliberately shows counts, not
              content.
            </li>
            <li>
              • Questions are shuffled at game start, so submission order gives
              nothing away.
            </li>
          </ul>

          {progress.quiz.ownerReviewedAt ? (
            <p className="mt-3 rounded-lg border border-amber-800 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
              You reviewed the submissions on{" "}
              {progress.quiz.ownerReviewedAt.toLocaleDateString()}. Every
              contributor can see this.
            </p>
          ) : (
            <p className="mt-3 text-sm text-ink-500">
              If you need to check for anything inappropriate, you can{" "}
              <Link
                href={`/collab/${id}/review`}
                className="font-medium text-brand-400 underline"
              >
                review submissions
              </Link>
              . Doing so is recorded and shown to everyone — it spoils the
              surprise for you, so only use it if you need to.
            </p>
          )}
        </section>

        {/* ── Progress ── */}
        <section className="mt-6">
          <h2 className="mb-3 font-semibold text-white">Who&apos;s contributed</h2>

          {progress.contributors.length === 0 ? (
            <p className="app-card p-6 text-center text-ink-400">
              Nobody has joined yet. Share the code above.
            </p>
          ) : (
            <ul className="space-y-2">
              {progress.contributors.map((contributor) => (
                <li
                  key={contributor.userId}
                  className="app-card flex items-center gap-4 p-4"
                >
                  <span className="flex-1 font-medium text-white">
                    {contributor.displayName}
                  </span>

                  <span className="flex items-center gap-1.5" aria-hidden>
                    {Array.from({ length: contributor.quota }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-2.5 w-2.5 rounded-full ${
                          i < contributor.submitted ? "bg-brand-500" : "bg-ink-700"
                        }`}
                      />
                    ))}
                  </span>

                  <span className="numeric w-16 text-right text-sm text-ink-400">
                    {contributor.submitted}/{contributor.quota}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Controls ── */}
        <section className="app-card mt-6 flex flex-wrap items-center gap-3 p-5">
          {progress.quiz.collabStage === "COLLECTING" ? (
            <>
              <form action={lockCollabAction}>
                <input type="hidden" name="quizId" value={id} />
                <button
                  type="submit"
                  disabled={progress.totalQuestions === 0}
                  className="btn btn-ghost"
                >
                  Close submissions
                </button>
              </form>
              <p className="text-sm text-ink-400">
                {allDone
                  ? "Everyone's hit their quota — you're good to go."
                  : "You can host before everyone finishes; latecomers just won't be included."}
              </p>
            </>
          ) : (
            <form action={reopenCollabAction}>
              <input type="hidden" name="quizId" value={id} />
              <button type="submit" className="btn btn-ghost">
                Reopen submissions
              </button>
            </form>
          )}

          <form action={startGameAction} className="ml-auto">
            <input type="hidden" name="quizId" value={id} />
            <button
              type="submit"
              disabled={progress.totalQuestions === 0}
              className="btn btn-primary"
            >
              Host the game
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
