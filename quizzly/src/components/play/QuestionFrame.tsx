"use client";

import { useEffect, useState } from "react";

import type { PlayerQuestionView } from "@/types/realtime";

/**
 * Renders a question according to its chosen layout.
 *
 * Layout is per-question, not per-quiz, so a round can open full-bleed on an
 * image and then drop into a stripped-back text layout for a lightning round.
 * All six layouts share the same children (the answer control) — only the
 * composition around it changes.
 */

export function QuestionFrame({
  view,
  children,
}: {
  view: PlayerQuestionView;
  children: React.ReactNode;
}) {
  const { presentation } = view;
  const accent = presentation.accentOverride;

  const prompt = (
    <h1
      className="quiz-display text-balance text-2xl font-extrabold leading-tight sm:text-3xl"
      style={accent ? { color: accent } : undefined}
    >
      {view.prompt}
    </h1>
  );

  const media = presentation.media ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={presentation.media}
      alt={presentation.mediaAlt ?? ""}
      className="w-full rounded-xl object-cover"
    />
  ) : null;

  const header = (
    <div className="mb-4 flex items-center justify-between text-sm opacity-70">
      <span>
        Question {view.index + 1}
        <span className="opacity-60"> of {view.total}</span>
      </span>
      <span className="numeric">{view.points} pts</span>
    </div>
  );

  const timer = presentation.hideTimer ? null : (
    <TimerBar endsAt={view.endsAt} serverNow={view.serverNow} />
  );

  switch (presentation.layout) {
    case "banner":
      return (
        <div className="animate-pop-in">
          {header}
          <div className="relative mb-5 overflow-hidden rounded-2xl">
            {media}
            <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/85 via-black/35 to-transparent p-5">
              <h1 className="quiz-display text-balance text-2xl font-extrabold leading-tight text-white sm:text-3xl">
                {view.prompt}
              </h1>
            </div>
          </div>
          {timer}
          <div className="mt-5">{children}</div>
        </div>
      );

    case "mediaSplit":
      return (
        <div className="animate-pop-in">
          {header}
          <div className="grid gap-5 sm:grid-cols-2 sm:items-center">
            <div className="overflow-hidden rounded-xl">{media}</div>
            <div>{prompt}</div>
          </div>
          <div className="mt-4">{timer}</div>
          <div className="mt-5">{children}</div>
        </div>
      );

    case "mediaTop":
      return (
        <div className="animate-pop-in">
          {header}
          {prompt}
          <div className="mt-4 overflow-hidden rounded-xl">{media}</div>
          <div className="mt-4">{timer}</div>
          <div className="mt-5">{children}</div>
        </div>
      );

    case "spotlight":
      return (
        <div className="animate-pop-in">
          {header}
          <div className="quiz-card mb-5 px-5 py-8 text-center">
            <h1
              className="quiz-display text-balance text-3xl font-extrabold leading-tight sm:text-4xl"
              style={accent ? { color: accent } : undefined}
            >
              {view.prompt}
            </h1>
          </div>
          {timer}
          <div className="mt-5">{children}</div>
        </div>
      );

    case "minimal":
      return (
        <div className="animate-pop-in">
          {prompt}
          <div className="mt-4">{timer}</div>
          <div className="mt-6">{children}</div>
        </div>
      );

    case "classic":
    default:
      return (
        <div className="animate-pop-in">
          {header}
          <div className="quiz-card mb-4 px-5 py-6">{prompt}</div>
          {timer}
          <div className="mt-5">{children}</div>
        </div>
      );
  }
}

/**
 * The countdown bar.
 *
 * Driven by a CSS animation rather than a React render loop: the browser
 * animates it on the compositor at whatever frame rate it can manage, and React
 * re-renders once per second only to update the numeric readout. Re-rendering
 * a progress bar 60 times a second is a classic way to make a quiz feel janky
 * on the cheap Android phones that make up half a classroom.
 *
 * `serverNow` corrects for clock skew — a player whose device clock is three
 * minutes fast would otherwise see the timer start already expired.
 */
function TimerBar({ endsAt, serverNow }: { endsAt: number; serverNow: number }) {
  const skew = Date.now() - serverNow;
  const totalMs = Math.max(0, endsAt - serverNow);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((endsAt + skew - Date.now()) / 1000)),
  );

  useEffect(() => {
    const tick = () => {
      setRemaining(Math.max(0, Math.ceil((endsAt + skew - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
    // `skew` is derived from props and stable for the life of a question.
  }, [endsAt, skew]);

  const urgent = remaining <= 5;

  return (
    <div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: "color-mix(in srgb, var(--q-text) 15%, transparent)" }}
      >
        <div
          className="timer-bar h-full rounded-full"
          style={{
            background: urgent ? "var(--q-wrong)" : "var(--q-accent)",
            animationDuration: `${totalMs}ms`,
          }}
        />
      </div>
      <p
        className="numeric mt-1.5 text-right text-sm font-semibold"
        style={{ color: urgent ? "var(--q-wrong)" : undefined }}
        role="timer"
        aria-live="off"
      >
        {remaining}s
      </p>
    </div>
  );
}
