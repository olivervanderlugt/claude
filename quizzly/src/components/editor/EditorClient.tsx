"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  QUESTION_TYPES,
  type QuestionPayload,
  type QuestionTypeName,
} from "@/lib/question-schema";
import type { Presentation, Theme } from "@/lib/theme";
import type { QuizSettings } from "@/lib/scoring";
import type { AiAvailability } from "@/lib/ai/provider";
import {
  addQuestionAction,
  deleteQuestionAction,
  reorderQuestionAction,
  saveQuestionAction,
} from "@/app/actions/quiz";
import { QuestionEditor, type DraftQuestion } from "./QuestionEditor";
import { ThemeEditor } from "./ThemeEditor";
import { SettingsEditor } from "./SettingsEditor";
import { AiPanel } from "./AiPanel";

export interface EditorQuestion {
  id: string;
  prompt: string;
  payload: QuestionPayload;
  presentation: Presentation;
  timeLimitSec: number;
  points: number;
  explanation: string | null;
}

type Tab = "questions" | "design" | "settings" | "ai";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "questions", label: "Questions" },
  { id: "design", label: "Design" },
  { id: "settings", label: "Game rules" },
  { id: "ai", label: "AI draft" },
];

export function EditorClient({
  quizId,
  title,
  initialQuestions,
  initialTheme,
  initialSettings,
  ai,
}: {
  quizId: string;
  title: string;
  description: string | null;
  initialQuestions: EditorQuestion[];
  initialTheme: Theme;
  initialSettings: QuizSettings;
  ai: AiAvailability;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("questions");
  const [questions, setQuestions] = useState(initialQuestions);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialQuestions[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showTypePicker, setShowTypePicker] = useState(false);

  const selected = questions.find((q) => q.id === selectedId) ?? null;

  function updateSelected(next: DraftQuestion) {
    if (!selectedId) return;
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === selectedId
          ? {
              ...q,
              prompt: next.prompt,
              payload: next.payload,
              presentation: next.presentation,
              timeLimitSec: next.timeLimitSec,
              points: next.points,
              explanation: next.explanation,
            }
          : q,
      ),
    );
  }

  function save() {
    if (!selected) return;
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await saveQuestionAction({
        questionId: selected.id,
        prompt: selected.prompt,
        payload: selected.payload,
        presentation: selected.presentation,
        timeLimitSec: selected.timeLimitSec,
        points: selected.points,
        explanation: selected.explanation,
      });

      if (result.error) setError(result.error);
      else setMessage(result.message ?? "Saved.");
    });
  }

  function addQuestion(type: QuestionTypeName) {
    setShowTypePicker(false);
    setError(null);

    startTransition(async () => {
      const result = await addQuestionAction(quizId, type);
      if (result.error) {
        setError(result.error);
        return;
      }
      // The server is the source of truth for the new row, so refresh rather
      // than guessing what it created.
      router.refresh();
      if (result.questionId) setSelectedId(result.questionId);
    });
  }

  function remove(questionId: string) {
    startTransition(async () => {
      const result = await deleteQuestionAction(questionId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
      if (selectedId === questionId) setSelectedId(null);
      router.refresh();
    });
  }

  function reorder(questionId: string, direction: "up" | "down") {
    startTransition(async () => {
      await reorderQuestionAction(questionId, direction);
      router.refresh();
    });
  }

  return (
    <div>
      {/* ── Tabs ── */}
      <div role="tablist" className="mb-6 flex gap-1 border-b border-ink-800">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === item.id
                ? "border-brand-500 text-white"
                : "border-transparent text-ink-400 hover:text-ink-200"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "questions" ? (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* ── Question list ── */}
          <aside>
            <ol className="space-y-2">
              {questions.map((question, index) => (
                <li key={question.id} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(question.id);
                      setMessage(null);
                      setError(null);
                    }}
                    aria-current={selectedId === question.id}
                    className={`app-card min-w-0 flex-1 px-3 py-2.5 text-left ${
                      selectedId === question.id
                        ? "border-brand-600"
                        : "hover:border-ink-700"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium text-white">
                      {index + 1}. {question.prompt || "Untitled question"}
                    </span>
                    <span className="text-xs text-ink-500">
                      {question.payload.type.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </button>

                  <span className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => reorder(question.id, "up")}
                      disabled={index === 0 || pending}
                      aria-label={`Move question ${index + 1} up`}
                      className="btn btn-ghost flex-1 px-2 py-0 text-xs"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => reorder(question.id, "down")}
                      disabled={index === questions.length - 1 || pending}
                      aria-label={`Move question ${index + 1} down`}
                      className="btn btn-ghost flex-1 px-2 py-0 text-xs"
                    >
                      ↓
                    </button>
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-3">
              {showTypePicker ? (
                <div className="app-card p-2">
                  <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Pick a type
                  </p>
                  <ul className="max-h-80 overflow-y-auto">
                    {QUESTION_TYPES.map((type) => (
                      <li key={type.id}>
                        <button
                          type="button"
                          onClick={() => addQuestion(type.id)}
                          className="flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-ink-800"
                        >
                          <span aria-hidden className="text-brand-400">
                            {type.icon}
                          </span>
                          <span>
                            <span className="block text-sm font-medium text-white">
                              {type.label}
                            </span>
                            <span className="block text-xs text-ink-500">
                              {type.blurb}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => setShowTypePicker(false)}
                    className="btn btn-ghost mt-1 w-full py-1.5 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowTypePicker(true)}
                  disabled={pending}
                  className="btn btn-ghost w-full"
                >
                  + Add question
                </button>
              )}
            </div>
          </aside>

          {/* ── Editor ── */}
          <section className="app-card p-5">
            {selected ? (
              <QuestionEditor
                value={selected}
                onChange={updateSelected}
                onSave={save}
                onDelete={() => remove(selected.id)}
                saving={pending}
                error={error}
                message={message}
              />
            ) : (
              <p className="py-16 text-center text-ink-400">
                {questions.length === 0
                  ? "Add your first question to get started."
                  : "Pick a question from the list."}
              </p>
            )}
          </section>
        </div>
      ) : null}

      {tab === "design" ? (
        <ThemeEditor quizId={quizId} initialTheme={initialTheme} />
      ) : null}

      {tab === "settings" ? (
        <SettingsEditor quizId={quizId} initialSettings={initialSettings} />
      ) : null}

      {tab === "ai" ? (
        <AiPanel quizId={quizId} availability={ai} quizTitle={title} />
      ) : null}
    </div>
  );
}
