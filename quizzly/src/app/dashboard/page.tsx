import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logoutAction } from "@/app/actions/auth";
import { createQuizAction, deleteQuizAction, startGameAction } from "@/app/actions/quiz";

export const metadata = { title: "Your quizzes" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  const quizzes = await db.quiz.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      mode: true,
      updatedAt: true,
      collabCode: true,
      collabStage: true,
      _count: { select: { questions: true, games: true } },
    },
  });

  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="border-b border-ink-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Link href="/dashboard" className="font-bold tracking-tight text-white">
            Quiz<span className="text-brand-400">zly</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-ink-400 sm:inline">{user.displayName}</span>
            <Link href="/settings" className="btn btn-ghost py-1.5 text-sm">
              Settings
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="btn btn-ghost py-1.5 text-sm">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="text-2xl font-bold text-white">Your quizzes</h1>

        {/* ── Create ── */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <form action={createQuizAction} className="app-card p-5">
            <input type="hidden" name="mode" value="SOLO" />
            <h2 className="font-semibold text-white">New quiz</h2>
            <p className="mt-1 text-sm text-ink-400">
              You write the questions.
            </p>
            <label className="sr-only" htmlFor="solo-title">
              Quiz title
            </label>
            <input
              id="solo-title"
              name="title"
              maxLength={120}
              placeholder="Friday pub quiz"
              className="app-input mt-3"
            />
            <button type="submit" className="btn btn-primary mt-3 w-full">
              Create quiz
            </button>
          </form>

          <form action={createQuizAction} className="app-card border-brand-700 p-5">
            <input type="hidden" name="mode" value="COLLAB" />
            <h2 className="font-semibold text-white">
              New group quiz
              <span className="ml-2 rounded bg-brand-600 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-white">
                blind
              </span>
            </h2>
            <p className="mt-1 text-sm text-ink-400">
              Everyone submits questions nobody else can see until game time.
            </p>
            <label className="sr-only" htmlFor="collab-title">
              Quiz title
            </label>
            <input
              id="collab-title"
              name="title"
              maxLength={120}
              placeholder="Team offsite quiz"
              className="app-input mt-3"
            />
            <label className="app-label mt-3" htmlFor="quota">
              Questions each
            </label>
            <input
              id="quota"
              name="quota"
              type="number"
              min={1}
              max={10}
              defaultValue={3}
              className="app-input"
            />
            <button type="submit" className="btn btn-primary mt-3 w-full">
              Create group quiz
            </button>
          </form>
        </div>

        {/* ── List ── */}
        <section className="mt-10">
          {quizzes.length === 0 ? (
            <p className="app-card p-8 text-center text-ink-400">
              Nothing here yet. Create your first quiz above.
            </p>
          ) : (
            <ul className="space-y-3">
              {quizzes.map((quiz) => (
                <li
                  key={quiz.id}
                  className="app-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-white">
                        {quiz.title}
                      </h3>
                      {quiz.mode === "COLLAB" ? (
                        <span className="rounded bg-brand-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-300">
                          group · {quiz.collabStage === "COLLECTING" ? "collecting" : "locked"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-400">
                      {quiz._count.questions} question
                      {quiz._count.questions === 1 ? "" : "s"}
                      {quiz._count.games > 0
                        ? ` · played ${quiz._count.games} time${quiz._count.games === 1 ? "" : "s"}`
                        : ""}
                      {quiz.collabCode ? ` · code ${quiz.collabCode}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {quiz.mode === "COLLAB" ? (
                      <Link
                        href={`/collab/${quiz.id}`}
                        className="btn btn-ghost py-1.5 text-sm"
                      >
                        Manage
                      </Link>
                    ) : (
                      <Link
                        href={`/quiz/${quiz.id}/edit`}
                        className="btn btn-ghost py-1.5 text-sm"
                      >
                        Edit
                      </Link>
                    )}

                    <form action={startGameAction}>
                      <input type="hidden" name="quizId" value={quiz.id} />
                      <button
                        type="submit"
                        disabled={quiz._count.questions === 0}
                        className="btn btn-primary py-1.5 text-sm"
                      >
                        Host
                      </button>
                    </form>

                    <form action={deleteQuizAction}>
                      <input type="hidden" name="quizId" value={quiz.id} />
                      <button
                        type="submit"
                        className="btn btn-ghost py-1.5 text-sm text-red-400"
                        aria-label={`Delete ${quiz.title}`}
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
