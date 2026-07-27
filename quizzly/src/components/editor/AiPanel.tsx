"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  GENERATABLE_TYPES,
  type AiAvailability,
  type GeneratableType,
} from "@/lib/ai/provider";
import { generateQuestionsAction } from "@/app/actions/quiz";

const TYPE_LABELS: Record<GeneratableType, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  MULTIPLE_SELECT: "Choose all that apply",
  TRUE_FALSE: "True or false",
  TYPE_ANSWER: "Type the answer",
  NUMERIC: "Number",
};

export function AiPanel({
  quizId,
  availability,
  quizTitle,
}: {
  quizId: string;
  availability: AiAvailability;
  quizTitle: string;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState(quizTitle === "Untitled quiz" ? "" : quizTitle);
  const [sourceText, setSourceText] = useState("");
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] =
    useState<"easy" | "medium" | "hard" | "mixed">("mixed");
  const [types, setTypes] = useState<GeneratableType[]>([
    "MULTIPLE_CHOICE",
    "TRUE_FALSE",
  ]);
  const [audience, setAudience] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!availability.available) {
    return (
      <div className="app-card max-w-2xl p-6">
        <h2 className="font-semibold text-white">AI drafting isn&apos;t set up</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          {availability.reason}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink-500">
          Everything else in Quizzly works without it — this panel is the only
          thing affected. To switch it on, set{" "}
          <code className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-xs">
            ANTHROPIC_API_KEY
          </code>{" "}
          in the server environment and restart, or save a personal key under
          Settings.
        </p>
      </div>
    );
  }

  function generate() {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await generateQuestionsAction(quizId, {
        topic,
        sourceText: sourceText.trim() || undefined,
        count,
        difficulty,
        types,
        audience: audience.trim() || undefined,
        language: "English",
      });

      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "Questions added.");
      router.refresh();
    });
  }

  const valid = topic.trim().length >= 3 && types.length > 0;

  return (
    <div className="max-w-2xl space-y-5">
      <div className="app-card p-5">
        <h2 className="font-semibold text-white">Draft questions with AI</h2>
        <p className="mt-1 text-sm text-ink-400">
          Everything lands in your question list as an editable draft. Nothing is
          played until you&apos;ve looked at it.
          {availability.source === "user"
            ? " Using your own API key."
            : " Using the server's API key."}
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="app-label" htmlFor="topic">
              Topic
            </label>
            <input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={4000}
              placeholder="The water cycle"
              className="app-input"
            />
          </div>

          <div>
            <label className="app-label" htmlFor="source">
              Source material{" "}
              <span className="font-normal text-ink-500">(optional)</span>
            </label>
            <textarea
              id="source"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value.slice(0, 20_000))}
              rows={5}
              placeholder="Paste your notes, an article, or a lesson plan. Questions will be written strictly from this and won't bring in outside facts."
              className="app-input resize-y text-sm"
            />
            <p className="mt-1 text-xs text-ink-500">
              {sourceText.length.toLocaleString()} / 20,000 characters
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="app-label" htmlFor="count">
                How many
              </label>
              <input
                id="count"
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="app-input"
              />
            </div>

            <div>
              <label className="app-label" htmlFor="difficulty">
                Difficulty
              </label>
              <select
                id="difficulty"
                value={difficulty}
                onChange={(e) =>
                  setDifficulty(e.target.value as typeof difficulty)
                }
                className="app-input"
              >
                <option value="mixed">Mixed</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <div>
              <label className="app-label" htmlFor="audience">
                Audience
              </label>
              <input
                id="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                maxLength={200}
                placeholder="Year 9 science"
                className="app-input"
              />
            </div>
          </div>

          <fieldset>
            <legend className="app-label">Question types to use</legend>
            <div className="flex flex-wrap gap-2">
              {GENERATABLE_TYPES.map((type) => {
                const active = types.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setTypes((prev) =>
                        prev.includes(type)
                          ? prev.filter((t) => t !== type)
                          : [...prev, type],
                      )
                    }
                    className={`btn py-1.5 text-sm ${active ? "btn-primary" : "btn-ghost"}`}
                  >
                    {TYPE_LABELS[type]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            role="status"
            className="mt-4 rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300"
          >
            {message}
          </p>
        ) : null}

        <button
          type="button"
          onClick={generate}
          disabled={pending || !valid}
          className="btn btn-primary mt-5"
        >
          {pending ? "Writing questions…" : `Draft ${count} question${count === 1 ? "" : "s"}`}
        </button>

        {pending ? (
          <p className="mt-2 text-xs text-ink-500">
            This usually takes 15–40 seconds.
          </p>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-ink-500">
        Generated questions are drafts. Check them for accuracy before you play —
        a confidently wrong question in front of a class is worse than no
        question at all.
      </p>
    </div>
  );
}
