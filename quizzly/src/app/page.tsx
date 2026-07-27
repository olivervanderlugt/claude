import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { aiConfigured } from "@/lib/env";
import { QUESTION_TYPES } from "@/lib/question-schema";
import { BUILT_IN_THEMES } from "@/lib/theme";
import { JoinForm } from "@/components/JoinForm";

export default async function LandingPage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <span className="text-lg font-bold tracking-tight text-white">
          Quiz<span className="text-brand-400">zly</span>
        </span>
        <nav className="flex items-center gap-2 text-sm">
          {user ? (
            <Link href="/dashboard" className="btn btn-primary">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary">
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main id="main">
        {/* ── Join box first. Most people arriving here are players with a PIN,
               not hosts — making them hunt for the join field is the single
               most common failure of this genre of app. ── */}
        <section className="mx-auto max-w-6xl px-5 pb-14 pt-8">
          <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-center">
            <div>
              <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl">
                Live quizzes that
                <br />
                don&apos;t all look the same.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-300">
                Ten question types, themes you can actually customise, and a
                group mode where everybody writes questions nobody else can see
                until they appear on screen.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/signup" className="btn btn-primary px-5 py-3">
                  Build a quiz
                </Link>
                <Link href="#features" className="btn btn-ghost px-5 py-3">
                  See what&apos;s in it
                </Link>
              </div>
            </div>

            <div className="app-card p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">
                Got a game PIN?
              </h2>
              <p className="mt-1 text-sm text-ink-400">
                No account needed. Nothing but your nickname is stored.
              </p>
              <JoinForm className="mt-4" />
            </div>
          </div>
        </section>

        {/* ── Group quizzes: the headline differentiator, so it gets the space. ── */}
        <section className="border-y border-ink-800 bg-ink-900/40">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-400">
              The one nobody else does
            </p>
            <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-white">
              Blind group quizzes
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-300">
              Share one invite code. Everyone submits their own questions — and
              nobody, including the host, can read anyone else&apos;s until the
              question appears on screen mid-game. Everybody gets to play,
              because nobody knows what&apos;s coming.
            </p>

            <ol className="mt-9 grid gap-5 sm:grid-cols-3">
              {[
                {
                  step: "1",
                  title: "Share the code",
                  body: "Six characters. Contributors sign in, join, and see only their own submissions.",
                },
                {
                  step: "2",
                  title: "Everyone writes",
                  body: "Each person submits their quota. The progress board shows who's done — never what they wrote.",
                },
                {
                  step: "3",
                  title: "Play it together",
                  body: "Questions shuffle and reveal one at a time, each credited to whoever wrote it.",
                },
              ].map((item) => (
                <li key={item.step} className="app-card p-5">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                    {item.step}
                  </span>
                  <h3 className="mt-3 font-semibold text-white">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-400">
                    {item.body}
                  </p>
                </li>
              ))}
            </ol>

            <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-500">
              The privacy rule is enforced in the database layer, not just hidden
              in the interface. If the host uses the moderation option to check
              submissions for anything abusive, every contributor is told it
              happened.
            </p>
          </div>
        </section>

        {/* ── Question types ── */}
        <section id="features" className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Ten ways to ask something
          </h2>
          <p className="mt-3 max-w-2xl text-ink-300">
            Multiple choice is the default, not the ceiling. Ordering, matching
            and sliders all award partial credit, so a near-miss still counts.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QUESTION_TYPES.map((type) => (
              <li key={type.id} className="app-card flex gap-3 p-4">
                <span
                  aria-hidden
                  className="mt-0.5 text-lg leading-none text-brand-400"
                >
                  {type.icon}
                </span>
                <div>
                  <h3 className="font-semibold text-white">{type.label}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-400">
                    {type.blurb}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Theming ── */}
        <section className="border-t border-ink-800 bg-ink-900/40">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Make it look like yours
            </h2>
            <p className="mt-3 max-w-2xl text-ink-300">
              Ten built-in themes, six question layouts, and a custom theme
              editor underneath. Every colour, font pairing, answer shape and
              background is yours to change — and it travels with the quiz when
              you export it.
            </p>

            <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Object.entries(BUILT_IN_THEMES).map(([key, theme]) => (
                <li
                  key={key}
                  className="overflow-hidden rounded-xl border border-ink-800"
                >
                  <div
                    className="flex h-20 items-end gap-1 p-2"
                    style={{ background: theme.palette.surfaceAlt }}
                  >
                    {theme.palette.answers.map((color) => (
                      <span
                        key={color}
                        className="h-6 flex-1 rounded"
                        style={{ background: color }}
                      />
                    ))}
                  </div>
                  <div className="bg-ink-900 px-3 py-2 text-sm font-medium text-ink-200">
                    {theme.name}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── AI ── */}
        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="app-card p-7">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Draft a round in seconds
            </h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-ink-300">
              Give it a topic, or paste your source material and have questions
              written strictly from it. Everything lands in the editor as a
              draft — you review and edit before anyone plays it.
            </p>
            <p className="mt-4 text-sm text-ink-500">
              {aiConfigured
                ? "AI generation is enabled on this server."
                : "AI generation isn't configured on this server yet — everything else works without it. An administrator can switch it on by setting ANTHROPIC_API_KEY."}
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Quizzly — self-hosted, MIT licensed.</p>
          <nav className="flex gap-4">
            <Link href="/privacy" className="hover:text-ink-300">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-ink-300">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
