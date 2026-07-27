"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  QuestionEditor,
  emptyDraft,
  type DraftQuestion,
} from "@/components/editor/QuestionEditor";
import {
  submitQuestionAction,
  withdrawQuestionAction,
} from "@/app/actions/collab";

interface ExistingQuestion {
  id: string;
  prompt: string;
  type: string;
}

export function ContributeClient({
  quizId,
  quota,
  locked,
  existing,
}: {
  quizId: string;
  quota: number;
  locked: boolean;
  existing: ExistingQuestion[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftQuestion>(() => emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await submitQuestionAction(quizId, {
        prompt: draft.prompt,
        payload: draft.payload,
        presentation: draft.presentation,
        timeLimitSec: draft.timeLimitSec,
        points: draft.points,
        explanation: draft.explanation,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setMessage(result.message ?? "Submitted.");
      // Reset to a blank draft so the next question starts clean.
      setDraft(emptyDraft());
      router.refresh();
    });
  }

  function withdraw(questionId: string) {
    startTransition(async () => {
      const result = await withdrawQuestionAction(questionId, quizId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-8 space-y-8">
      {/* ── Already submitted ── */}
      <section>
        <h2 className="mb-3 font-semibold text-white">Your questions</h2>

        {existing.length === 0 ? (
          <p className="app-card p-5 text-sm text-ink-400">
            Nothing submitted yet. Write your first below.
          </p>
        ) : (
          <ul className="space-y-2">
            {existing.map((question, index) => (
              <li
                key={question.id}
                className="app-card flex items-center gap-3 p-4"
              >
                <span className="numeric w-6 text-center text-sm text-ink-500">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-white">
                    {question.prompt || "(no prompt)"}
                  </span>
                  <span className="text-xs text-ink-500">{question.type}</span>
                </span>
                {!locked ? (
                  <button
                    type="button"
                    onClick={() => withdraw(question.id)}
                    disabled={pending}
                    className="btn btn-ghost py-1.5 text-sm text-red-400"
                  >
                    Withdraw
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── New question ── */}
      {!locked ? (
        <section className="app-card p-5">
          <h2 className="mb-1 font-semibold text-white">
            {existing.length >= quota
              ? "Add another (you've hit your quota)"
              : `Write question ${existing.length + 1}`}
          </h2>
          <p className="mb-5 text-sm text-ink-400">
            Only you can see this until it appears on screen during the game.
          </p>

          <QuestionEditor
            value={draft}
            onChange={setDraft}
            onSave={submit}
            saving={pending}
            error={error}
            message={message}
            saveLabel="Submit question"
          />
        </section>
      ) : null}
    </div>
  );
}
