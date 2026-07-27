"use client";

import { useState, useTransition } from "react";

import type { QuizSettings } from "@/lib/scoring";
import { updateSettingsAction } from "@/app/actions/quiz";

export function SettingsEditor({
  quizId,
  initialSettings,
}: {
  quizId: string;
  initialSettings: QuizSettings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (partial: Partial<QuizSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    setMessage(null);
  };

  const patchScoring = (partial: Partial<QuizSettings["scoring"]>) =>
    setSettings((prev) => ({ ...prev, scoring: { ...prev.scoring, ...partial } }));

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateSettingsAction(quizId, settings);
      if (result.error) setError(result.error);
      else setMessage("Settings saved.");
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="app-card p-5">
        <h2 className="font-semibold text-white">Scoring</h2>

        <div className="mt-4 space-y-4">
          <Check
            label="Reward faster answers"
            hint="Points scale down the longer someone takes."
            checked={settings.scoring.speedBonus}
            onChange={(speedBonus) => patchScoring({ speedBonus })}
          />

          {settings.scoring.speedBonus ? (
            <div>
              <label className="app-label" htmlFor="floor">
                Slowest correct answer earns{" "}
                {Math.round(settings.scoring.slowestAnswerFraction * 100)}%
              </label>
              <input
                id="floor"
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.scoring.slowestAnswerFraction * 100}
                onChange={(e) =>
                  patchScoring({ slowestAnswerFraction: Number(e.target.value) / 100 })
                }
                className="w-full"
              />
              <p className="mt-1 text-xs text-ink-500">
                Keep this above zero — if the last seconds are worth nothing,
                players stop trying once they&apos;ve hesitated.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="app-label" htmlFor="streak">
                Streak bonus per question
              </label>
              <input
                id="streak"
                type="number"
                min={0}
                max={1000}
                step={25}
                value={settings.scoring.streakBonus}
                onChange={(e) =>
                  patchScoring({ streakBonus: Number(e.target.value) })
                }
                className="app-input"
              />
            </div>
            <div>
              <label className="app-label" htmlFor="streak-cap">
                Streak stops growing at
              </label>
              <input
                id="streak-cap"
                type="number"
                min={0}
                max={20}
                value={settings.scoring.streakCap}
                onChange={(e) => patchScoring({ streakCap: Number(e.target.value) })}
                className="app-input"
              />
              <p className="mt-1 text-xs text-ink-500">
                Stops an early leader running away with it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="app-card p-5">
        <h2 className="font-semibold text-white">Flow</h2>

        <div className="mt-4 space-y-4">
          <Check
            label="Shuffle question order"
            hint="Group quizzes always shuffle, regardless of this setting."
            checked={settings.shuffleQuestions}
            onChange={(shuffleQuestions) => patch({ shuffleQuestions })}
          />
          <Check
            label="Shuffle answer options"
            checked={settings.shuffleAnswers}
            onChange={(shuffleAnswers) => patch({ shuffleAnswers })}
          />
          <Check
            label="Show the correct answer after each question"
            checked={settings.showCorrectAnswer}
            onChange={(showCorrectAnswer) => patch({ showCorrectAnswer })}
          />
          <Check
            label="Show the leaderboard between questions"
            checked={settings.showLeaderboard}
            onChange={(showLeaderboard) => patch({ showLeaderboard })}
          />
          <Check
            label="Let players join after the game starts"
            hint="Latecomers start from zero."
            checked={settings.allowLateJoin}
            onChange={(allowLateJoin) => patch({ allowLateJoin })}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="app-label" htmlFor="countdown">
                &quot;Get ready&quot; countdown: {settings.countdownSeconds}s
              </label>
              <input
                id="countdown"
                type="range"
                min={0}
                max={10}
                value={settings.countdownSeconds}
                onChange={(e) =>
                  patch({ countdownSeconds: Number(e.target.value) })
                }
                className="w-full"
              />
            </div>
            <div>
              <label className="app-label" htmlFor="lb-size">
                Players shown on the leaderboard
              </label>
              <input
                id="lb-size"
                type="number"
                min={3}
                max={20}
                value={settings.leaderboardSize}
                onChange={(e) =>
                  patch({ leaderboardSize: Number(e.target.value) })
                }
                className="app-input"
              />
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-emerald-400">
          {message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-brand-500"
      />
      <span>
        <span className="text-sm font-medium text-ink-200">{label}</span>
        {hint ? <span className="block text-xs text-ink-500">{hint}</span> : null}
      </span>
    </label>
  );
}
