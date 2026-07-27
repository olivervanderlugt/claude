"use client";

import { useState } from "react";

import {
  QUESTION_TYPES,
  QUESTION_TYPE_MAP,
  type QuestionPayload,
  type QuestionTypeName,
  type QuizOption,
} from "@/lib/question-schema";
import {
  DEFAULT_PRESENTATION,
  LAYOUTS,
  type LayoutId,
  type Presentation,
} from "@/lib/theme";

/**
 * The question editor, shared by the quiz builder and the group-quiz
 * contribution flow.
 *
 * Sharing it is what keeps a contributed question a first-class question:
 * contributors get the same ten types, the same layouts and the same timing
 * controls the quiz owner has, rather than a cut-down "suggest a question" box.
 */

export interface DraftQuestion {
  id?: string;
  prompt: string;
  payload: QuestionPayload;
  presentation: Presentation;
  timeLimitSec: number;
  points: number;
  explanation: string | null;
}

interface Props {
  value: DraftQuestion;
  onChange: (next: DraftQuestion) => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  error: string | null;
  message: string | null;
  /** Contributors submit; owners save. Only the wording differs. */
  saveLabel?: string;
}

export function QuestionEditor({
  value,
  onChange,
  onSave,
  onDelete,
  saving,
  error,
  message,
  saveLabel = "Save question",
}: Props) {
  const [showLayout, setShowLayout] = useState(false);
  const meta = QUESTION_TYPE_MAP.get(value.payload.type);

  const patch = (partial: Partial<DraftQuestion>) =>
    onChange({ ...value, ...partial });

  const setPayload = (payload: QuestionPayload) => patch({ payload });

  function changeType(type: QuestionTypeName) {
    const next = QUESTION_TYPE_MAP.get(type);
    if (!next) return;
    // Switching type resets the payload — the shapes don't map onto each other,
    // and silently keeping half the old data produces invalid questions.
    patch({
      payload: next.defaults(),
      points: next.scored ? value.points || 1000 : 0,
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Type ── */}
      <div>
        <label className="app-label" htmlFor="q-type">
          Question type
        </label>
        <select
          id="q-type"
          value={value.payload.type}
          onChange={(e) => changeType(e.target.value as QuestionTypeName)}
          className="app-input"
        >
          {QUESTION_TYPES.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
        {meta ? (
          <p className="mt-1.5 text-xs text-ink-500">{meta.blurb}</p>
        ) : null}
      </div>

      {/* ── Prompt ── */}
      <div>
        <label className="app-label" htmlFor="q-prompt">
          Question
        </label>
        <textarea
          id="q-prompt"
          value={value.prompt}
          onChange={(e) => patch({ prompt: e.target.value })}
          rows={2}
          maxLength={500}
          placeholder="What are you asking?"
          className="app-input resize-y"
        />
      </div>

      {/* ── Type-specific fields ── */}
      <PayloadEditor payload={value.payload} onChange={setPayload} />

      {/* ── Timing and points ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="app-label" htmlFor="q-time">
            Time limit: {value.timeLimitSec}s
          </label>
          <input
            id="q-time"
            type="range"
            min={5}
            max={120}
            step={5}
            value={value.timeLimitSec}
            onChange={(e) => patch({ timeLimitSec: Number(e.target.value) })}
            className="w-full"
          />
        </div>
        <div>
          <label className="app-label" htmlFor="q-points">
            Points
          </label>
          <input
            id="q-points"
            type="number"
            min={0}
            max={10000}
            step={100}
            value={value.points}
            onChange={(e) => patch({ points: Number(e.target.value) })}
            disabled={meta ? !meta.scored : false}
            className="app-input"
          />
          {meta && !meta.scored ? (
            <p className="mt-1 text-xs text-ink-500">
              This type doesn&apos;t score points.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Explanation ── */}
      <div>
        <label className="app-label" htmlFor="q-explanation">
          Explanation <span className="font-normal text-ink-500">(optional)</span>
        </label>
        <input
          id="q-explanation"
          value={value.explanation ?? ""}
          onChange={(e) => patch({ explanation: e.target.value })}
          maxLength={500}
          placeholder="Shown after the answer is revealed"
          className="app-input"
        />
      </div>

      {/* ── Layout ── */}
      <div>
        <button
          type="button"
          onClick={() => setShowLayout((v) => !v)}
          aria-expanded={showLayout}
          className="text-sm font-medium text-brand-400 hover:underline"
        >
          {showLayout ? "Hide" : "Show"} layout &amp; image options
        </button>

        {showLayout ? (
          <LayoutEditor
            presentation={value.presentation}
            onChange={(presentation) => patch({ presentation })}
          />
        ) : null}
      </div>

      {/* ── Feedback + actions ── */}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300"
        >
          {message}
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="btn btn-primary"
        >
          {saving ? "Saving…" : saveLabel}
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="btn btn-ghost text-red-400"
          >
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────────── Payload editors ──────────────────────────────

function PayloadEditor({
  payload,
  onChange,
}: {
  payload: QuestionPayload;
  onChange: (payload: QuestionPayload) => void;
}) {
  switch (payload.type) {
    case "MULTIPLE_CHOICE":
      return (
        <OptionList
          options={payload.options}
          correct={[payload.correctId]}
          multi={false}
          onOptionsChange={(options) => onChange({ ...payload, options })}
          onCorrectChange={([id]) =>
            onChange({ ...payload, correctId: id ?? payload.correctId })
          }
        />
      );

    case "MULTIPLE_SELECT":
      return (
        <>
          <OptionList
            options={payload.options}
            correct={payload.correctIds}
            multi
            onOptionsChange={(options) => onChange({ ...payload, options })}
            onCorrectChange={(correctIds) => onChange({ ...payload, correctIds })}
          />
          <Toggle
            label="Award partial credit"
            hint="Right picks earn points, wrong picks subtract them."
            checked={payload.partialCredit}
            onChange={(partialCredit) => onChange({ ...payload, partialCredit })}
          />
        </>
      );

    case "TRUE_FALSE":
      return (
        <fieldset>
          <legend className="app-label">Correct answer</legend>
          <div className="flex gap-2">
            {[true, false].map((option) => (
              <button
                key={String(option)}
                type="button"
                onClick={() => onChange({ ...payload, correct: option })}
                aria-pressed={payload.correct === option}
                className={`btn flex-1 ${
                  payload.correct === option ? "btn-primary" : "btn-ghost"
                }`}
              >
                {option ? "True" : "False"}
              </button>
            ))}
          </div>
        </fieldset>
      );

    case "TYPE_ANSWER":
      return (
        <div>
          <label className="app-label">Accepted answers</label>
          <p className="mb-2 text-xs text-ink-500">
            One per line. Any of them counts as correct — add spellings and
            synonyms.
          </p>
          <textarea
            value={payload.accepted.join("\n")}
            onChange={(e) =>
              onChange({
                ...payload,
                accepted: e.target.value.split("\n").map((s) => s),
              })
            }
            rows={3}
            className="app-input resize-y font-mono text-sm"
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="app-label" htmlFor="typo">
                Typo tolerance: {payload.typoTolerance}
              </label>
              <input
                id="typo"
                type="range"
                min={0}
                max={3}
                value={payload.typoTolerance}
                onChange={(e) =>
                  onChange({ ...payload, typoTolerance: Number(e.target.value) })
                }
                className="w-full"
              />
              <p className="mt-1 text-xs text-ink-500">
                0 is exact. 1 forgives a slip of the thumb.
              </p>
            </div>
            <Toggle
              label="Case sensitive"
              checked={payload.caseSensitive}
              onChange={(caseSensitive) => onChange({ ...payload, caseSensitive })}
            />
          </div>
        </div>
      );

    case "NUMERIC":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Correct value"
            value={payload.correct}
            onChange={(correct) => onChange({ ...payload, correct })}
          />
          <NumberField
            label="± Tolerance"
            value={payload.tolerance}
            min={0}
            onChange={(tolerance) => onChange({ ...payload, tolerance })}
          />
          <div>
            <label className="app-label" htmlFor="num-unit">
              Unit
            </label>
            <input
              id="num-unit"
              value={payload.unit ?? ""}
              onChange={(e) =>
                onChange({ ...payload, unit: e.target.value || undefined })
              }
              maxLength={20}
              placeholder="km"
              className="app-input"
            />
          </div>
        </div>
      );

    case "SLIDER":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Minimum"
            value={payload.min}
            onChange={(min) => onChange({ ...payload, min })}
          />
          <NumberField
            label="Maximum"
            value={payload.max}
            onChange={(max) => onChange({ ...payload, max })}
          />
          <NumberField
            label="Step"
            value={payload.step}
            min={0.001}
            onChange={(step) => onChange({ ...payload, step })}
          />
          <NumberField
            label="Correct value"
            value={payload.correct}
            onChange={(correct) => onChange({ ...payload, correct })}
          />
          <NumberField
            label="± Tolerance"
            value={payload.tolerance}
            min={0}
            onChange={(tolerance) => onChange({ ...payload, tolerance })}
          />
          <div>
            <label className="app-label" htmlFor="slider-unit">
              Unit
            </label>
            <input
              id="slider-unit"
              value={payload.unit ?? ""}
              onChange={(e) =>
                onChange({ ...payload, unit: e.target.value || undefined })
              }
              maxLength={20}
              placeholder="%"
              className="app-input"
            />
          </div>
        </div>
      );

    case "ORDERING":
      return (
        <div>
          <label className="app-label">Items, in the correct order</label>
          <p className="mb-2 text-xs text-ink-500">
            Players see them shuffled.
          </p>
          <div className="space-y-2">
            {payload.correctOrder.map((id, index) => {
              const item = payload.items.find((i) => i.id === id);
              if (!item) return null;
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="numeric w-6 text-center text-sm text-ink-500">
                    {index + 1}
                  </span>
                  <input
                    value={item.text}
                    onChange={(e) =>
                      onChange({
                        ...payload,
                        items: payload.items.map((i) =>
                          i.id === id ? { ...i, text: e.target.value } : i,
                        ),
                      })
                    }
                    maxLength={200}
                    placeholder={`Item ${index + 1}`}
                    className="app-input"
                    aria-label={`Item at position ${index + 1}`}
                  />
                  {payload.items.length > 2 ? (
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...payload,
                          items: payload.items.filter((i) => i.id !== id),
                          correctOrder: payload.correctOrder.filter((o) => o !== id),
                        })
                      }
                      aria-label={`Remove item ${index + 1}`}
                      className="btn btn-ghost px-3 text-red-400"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {payload.items.length < 8 ? (
            <button
              type="button"
              onClick={() => {
                const id = nextId(payload.items);
                onChange({
                  ...payload,
                  items: [...payload.items, { id, text: "" }],
                  correctOrder: [...payload.correctOrder, id],
                });
              }}
              className="btn btn-ghost mt-2 text-sm"
            >
              + Add item
            </button>
          ) : null}
        </div>
      );

    case "MATCHING":
      return (
        <div>
          <label className="app-label">Pairs</label>
          <div className="space-y-2">
            {payload.pairs.map((pair, index) => (
              <div key={pair.id} className="flex items-center gap-2">
                <input
                  value={pair.left}
                  onChange={(e) =>
                    onChange({
                      ...payload,
                      pairs: payload.pairs.map((p) =>
                        p.id === pair.id ? { ...p, left: e.target.value } : p,
                      ),
                    })
                  }
                  placeholder="Left"
                  maxLength={160}
                  className="app-input"
                  aria-label={`Pair ${index + 1} left`}
                />
                <span aria-hidden className="text-ink-500">
                  →
                </span>
                <input
                  value={pair.right}
                  onChange={(e) =>
                    onChange({
                      ...payload,
                      pairs: payload.pairs.map((p) =>
                        p.id === pair.id ? { ...p, right: e.target.value } : p,
                      ),
                    })
                  }
                  placeholder="Right"
                  maxLength={160}
                  className="app-input"
                  aria-label={`Pair ${index + 1} right`}
                />
                {payload.pairs.length > 2 ? (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...payload,
                        pairs: payload.pairs.filter((p) => p.id !== pair.id),
                      })
                    }
                    aria-label={`Remove pair ${index + 1}`}
                    className="btn btn-ghost px-3 text-red-400"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {payload.pairs.length < 6 ? (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...payload,
                  pairs: [
                    ...payload.pairs,
                    { id: nextId(payload.pairs), left: "", right: "" },
                  ],
                })
              }
              className="btn btn-ghost mt-2 text-sm"
            >
              + Add pair
            </button>
          ) : null}
        </div>
      );

    case "POLL":
      return (
        <OptionList
          options={payload.options}
          correct={[]}
          multi={false}
          hideCorrect
          onOptionsChange={(options) => onChange({ ...payload, options })}
          onCorrectChange={() => {}}
        />
      );

    case "WORD_CLOUD":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Words per player"
            value={payload.maxWordsPerPlayer}
            min={1}
            max={5}
            onChange={(maxWordsPerPlayer) =>
              onChange({ ...payload, maxWordsPerPlayer })
            }
          />
          <NumberField
            label="Max word length"
            value={payload.maxWordLength}
            min={1}
            max={40}
            onChange={(maxWordLength) => onChange({ ...payload, maxWordLength })}
          />
        </div>
      );
  }
}

// ──────────────────────────────── Helpers ──────────────────────────────────

function OptionList({
  options,
  correct,
  multi,
  hideCorrect = false,
  onOptionsChange,
  onCorrectChange,
}: {
  options: QuizOption[];
  correct: string[];
  multi: boolean;
  hideCorrect?: boolean;
  onOptionsChange: (options: QuizOption[]) => void;
  onCorrectChange: (correct: string[]) => void;
}) {
  return (
    <div>
      <label className="app-label">
        Answer options
        {!hideCorrect ? (
          <span className="ml-1 font-normal text-ink-500">
            — {multi ? "tick every correct one" : "tick the correct one"}
          </span>
        ) : null}
      </label>

      <div className="space-y-2">
        {options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            {!hideCorrect ? (
              <input
                type={multi ? "checkbox" : "radio"}
                name="correct-option"
                checked={correct.includes(option.id)}
                onChange={() => {
                  if (multi) {
                    onCorrectChange(
                      correct.includes(option.id)
                        ? correct.filter((id) => id !== option.id)
                        : [...correct, option.id],
                    );
                  } else {
                    onCorrectChange([option.id]);
                  }
                }}
                aria-label={`Option ${index + 1} is correct`}
                className="h-5 w-5 shrink-0 accent-brand-500"
              />
            ) : null}

            <input
              value={option.text}
              onChange={(e) =>
                onOptionsChange(
                  options.map((o) =>
                    o.id === option.id ? { ...o, text: e.target.value } : o,
                  ),
                )
              }
              maxLength={300}
              placeholder={`Option ${index + 1}`}
              className="app-input"
              aria-label={`Option ${index + 1} text`}
            />

            {options.length > 2 ? (
              <button
                type="button"
                onClick={() =>
                  onOptionsChange(options.filter((o) => o.id !== option.id))
                }
                aria-label={`Remove option ${index + 1}`}
                className="btn btn-ghost px-3 text-red-400"
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {options.length < 6 ? (
        <button
          type="button"
          onClick={() =>
            onOptionsChange([...options, { id: nextId(options), text: "" }])
          }
          className="btn btn-ghost mt-2 text-sm"
        >
          + Add option
        </button>
      ) : null}
    </div>
  );
}

function LayoutEditor({
  presentation,
  onChange,
}: {
  presentation: Presentation;
  onChange: (presentation: Presentation) => void;
}) {
  const needsImage =
    presentation.layout === "banner" ||
    presentation.layout === "mediaSplit" ||
    presentation.layout === "mediaTop";

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-ink-800 p-4">
      <div>
        <label className="app-label" htmlFor="layout">
          Layout
        </label>
        <select
          id="layout"
          value={presentation.layout}
          onChange={(e) =>
            onChange({ ...presentation, layout: e.target.value as LayoutId })
          }
          className="app-input"
        >
          {Object.entries(LAYOUTS).map(([id, layout]) => (
            <option key={id} value={id}>
              {layout.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-ink-500">
          {LAYOUTS[presentation.layout].blurb}
        </p>
      </div>

      <div>
        <label className="app-label" htmlFor="media">
          Image URL {needsImage ? <span className="text-red-400">*</span> : null}
        </label>
        <input
          id="media"
          type="url"
          value={presentation.media ?? ""}
          onChange={(e) =>
            onChange({ ...presentation, media: e.target.value || undefined })
          }
          placeholder="https://…"
          className="app-input"
        />
      </div>

      {presentation.media ? (
        <div>
          <label className="app-label" htmlFor="media-alt">
            Describe the image <span className="text-red-400">*</span>
          </label>
          <input
            id="media-alt"
            value={presentation.mediaAlt ?? ""}
            onChange={(e) =>
              onChange({ ...presentation, mediaAlt: e.target.value })
            }
            maxLength={300}
            placeholder="A red double-decker bus on Westminster Bridge"
            className="app-input"
          />
          <p className="mt-1 text-xs text-ink-500">
            Required. Without it, players using a screen reader can&apos;t
            answer this question.
          </p>
        </div>
      ) : null}

      <Toggle
        label="Hide the countdown bar"
        hint="Useful for discussion questions where the timer adds pressure you don't want."
        checked={presentation.hideTimer}
        onChange={(hideTimer) => onChange({ ...presentation, hideTimer })}
      />
    </div>
  );
}

function Toggle({
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

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const id = `num-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label className="app-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step="any"
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        className="app-input"
      />
    </div>
  );
}

/** Next free single-letter id. Stable, short, and readable in stored JSON. */
function nextId(items: Array<{ id: string }>): string {
  const used = new Set(items.map((i) => i.id));
  for (let i = 0; i < 26; i++) {
    const candidate = String.fromCharCode(97 + i);
    if (!used.has(candidate)) return candidate;
  }
  return `x${items.length}`;
}

export function emptyDraft(type: QuestionTypeName = "MULTIPLE_CHOICE"): DraftQuestion {
  const meta = QUESTION_TYPE_MAP.get(type)!;
  return {
    prompt: "",
    payload: meta.defaults(),
    presentation: { ...DEFAULT_PRESENTATION },
    timeLimitSec: 20,
    points: meta.scored ? 1000 : 0,
    explanation: null,
  };
}
