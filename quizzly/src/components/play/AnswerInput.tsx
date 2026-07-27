"use client";

import { useState } from "react";

import type { PublicPayload, PlayerResponse } from "@/lib/question-schema";

/**
 * The player's answer control, one branch per question type.
 *
 * Every branch receives only `PublicPayload` — the answer-stripped view — so
 * there is no correct answer anywhere in this component's props, and therefore
 * none in the page's serialised React payload. That is the point: on a naive
 * implementation, "view source" wins the game.
 *
 * Touch targets are ≥44px throughout. Players are on phones, in a hurry,
 * often standing up.
 */

interface Props {
  payload: PublicPayload;
  disabled: boolean;
  onAnswer: (response: PlayerResponse) => void;
  /** Set once submitted, so the UI can show what they picked. */
  submitted: PlayerResponse | null;
}

const TILE_COLORS = [
  "var(--q-answer-1)",
  "var(--q-answer-2)",
  "var(--q-answer-3)",
  "var(--q-answer-4)",
];

const TILE_SHAPES = ["▲", "◆", "●", "■", "★", "⬟"];

export function AnswerInput({ payload, disabled, onAnswer, submitted }: Props) {
  switch (payload.type) {
    case "MULTIPLE_CHOICE":
    case "POLL":
      return (
        <ChoiceGrid
          options={payload.options}
          disabled={disabled}
          selectedIds={
            submitted?.kind === "choice" ? [submitted.optionId] : []
          }
          onPick={(id) => onAnswer({ kind: "choice", optionId: id })}
        />
      );

    case "MULTIPLE_SELECT":
      return (
        <MultiSelect
          options={payload.options}
          pickCount={payload.pickCount}
          disabled={disabled}
          submitted={submitted?.kind === "multi" ? submitted.optionIds : null}
          onSubmit={(ids) => onAnswer({ kind: "multi", optionIds: ids })}
        />
      );

    case "TRUE_FALSE":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { value: true, label: "True", color: TILE_COLORS[1]! },
            { value: false, label: "False", color: TILE_COLORS[0]! },
          ].map((opt) => {
            const chosen =
              submitted?.kind === "boolean" && submitted.value === opt.value;
            return (
              <button
                key={opt.label}
                type="button"
                disabled={disabled}
                onClick={() => onAnswer({ kind: "boolean", value: opt.value })}
                className="answer-tile min-h-24 px-5 py-6 text-2xl font-bold text-white"
                style={{
                  background: opt.color,
                  opacity: submitted && !chosen ? 0.4 : 1,
                }}
                aria-pressed={chosen}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );

    case "TYPE_ANSWER":
      return (
        <FreeText
          placeholder="Type your answer"
          maxLength={120}
          disabled={disabled}
          submittedText={submitted?.kind === "text" ? submitted.text : null}
          onSubmit={(text) => onAnswer({ kind: "text", text })}
        />
      );

    case "WORD_CLOUD":
      return (
        <FreeText
          placeholder="One word"
          maxLength={payload.maxWordLength}
          disabled={disabled}
          submittedText={
            submitted?.kind === "words" ? submitted.words.join(", ") : null
          }
          onSubmit={(text) =>
            onAnswer({
              kind: "words",
              words: text
                .split(/[,\s]+/)
                .map((w) => w.trim())
                .filter(Boolean)
                .slice(0, payload.maxWordsPerPlayer),
            })
          }
        />
      );

    case "NUMERIC":
      return (
        <NumberEntry
          unit={payload.unit}
          disabled={disabled}
          submittedValue={submitted?.kind === "number" ? submitted.value : null}
          onSubmit={(value) => onAnswer({ kind: "number", value })}
        />
      );

    case "SLIDER":
      return (
        <SliderEntry
          min={payload.min}
          max={payload.max}
          step={payload.step}
          unit={payload.unit}
          disabled={disabled}
          submittedValue={submitted?.kind === "number" ? submitted.value : null}
          onSubmit={(value) => onAnswer({ kind: "number", value })}
        />
      );

    case "ORDERING":
      return (
        <Ordering
          items={payload.items}
          disabled={disabled}
          submitted={submitted?.kind === "order" ? submitted.order : null}
          onSubmit={(order) => onAnswer({ kind: "order", order })}
        />
      );

    case "MATCHING":
      return (
        <Matching
          lefts={payload.lefts}
          rights={payload.rights}
          disabled={disabled}
          submitted={submitted?.kind === "matches" ? submitted.matches : null}
          onSubmit={(matches) => onAnswer({ kind: "matches", matches })}
        />
      );
  }
}

// ───────────────────────────── Sub-components ───────────────────────────────

function ChoiceGrid({
  options,
  disabled,
  selectedIds,
  onPick,
}: {
  options: Array<{ id: string; text: string; image?: string }>;
  disabled: boolean;
  selectedIds: string[];
  onPick: (id: string) => void;
}) {
  const hasAnswered = selectedIds.length > 0;

  return (
    <div
      className={`grid gap-3 ${options.length > 4 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
    >
      {options.map((option, i) => {
        const chosen = selectedIds.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(option.id)}
            aria-pressed={chosen}
            className="answer-tile flex min-h-24 items-center gap-3 px-4 py-5 text-left text-lg font-semibold text-white"
            style={{
              background: TILE_COLORS[i % TILE_COLORS.length],
              opacity: hasAnswered && !chosen ? 0.4 : 1,
            }}
          >
            <span aria-hidden className="text-xl opacity-90">
              {TILE_SHAPES[i % TILE_SHAPES.length]}
            </span>
            {option.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={option.image}
                alt=""
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            ) : null}
            <span className="flex-1">{option.text}</span>
          </button>
        );
      })}
    </div>
  );
}

function MultiSelect({
  options,
  pickCount,
  disabled,
  submitted,
  onSubmit,
}: {
  options: Array<{ id: string; text: string; image?: string }>;
  pickCount: number;
  disabled: boolean;
  submitted: string[] | null;
  onSubmit: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const locked = submitted !== null || disabled;
  const shown = submitted ?? selected;

  return (
    <div>
      <p className="mb-3 text-sm opacity-75">
        Pick {pickCount} — wrong picks cancel out right ones.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option, i) => {
          const chosen = shown.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={locked}
              aria-pressed={chosen}
              onClick={() =>
                setSelected((prev) =>
                  prev.includes(option.id)
                    ? prev.filter((id) => id !== option.id)
                    : [...prev, option.id],
                )
              }
              className="answer-tile flex min-h-20 items-center gap-3 px-4 py-4 text-left text-lg font-semibold text-white"
              style={{
                background: TILE_COLORS[i % TILE_COLORS.length],
                opacity: chosen ? 1 : 0.45,
                outline: chosen ? "3px solid rgba(255,255,255,0.9)" : "none",
                outlineOffset: "-3px",
              }}
            >
              <span aria-hidden>{chosen ? "☑" : "☐"}</span>
              <span className="flex-1">{option.text}</span>
            </button>
          );
        })}
      </div>

      {submitted === null ? (
        <button
          type="button"
          disabled={disabled || selected.length === 0}
          onClick={() => onSubmit(selected)}
          className="btn btn-primary mt-4 w-full py-3 text-base"
        >
          Lock in {selected.length} answer{selected.length === 1 ? "" : "s"}
        </button>
      ) : null}
    </div>
  );
}

function FreeText({
  placeholder,
  maxLength,
  disabled,
  submittedText,
  onSubmit,
}: {
  placeholder: string;
  maxLength: number;
  disabled: boolean;
  submittedText: string | null;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");

  if (submittedText !== null) {
    return (
      <div className="quiz-card p-5 text-center">
        <p className="text-sm opacity-70">You answered</p>
        <p className="mt-1 text-2xl font-bold">{submittedText}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <label className="sr-only" htmlFor="answer-text">
        Your answer
      </label>
      <input
        id="answer-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        // Autocorrect actively fights players typing proper nouns against a
        // timer, and autocapitalise makes answers look wrong even when right.
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        className="app-input py-4 text-center text-xl"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="btn btn-primary mt-3 w-full py-3 text-base"
      >
        Submit
      </button>
    </form>
  );
}

function NumberEntry({
  unit,
  disabled,
  submittedValue,
  onSubmit,
}: {
  unit?: string;
  disabled: boolean;
  submittedValue: number | null;
  onSubmit: (value: number) => void;
}) {
  const [text, setText] = useState("");

  if (submittedValue !== null) {
    return (
      <div className="quiz-card p-5 text-center">
        <p className="text-sm opacity-70">You answered</p>
        <p className="numeric mt-1 text-3xl font-bold">
          {submittedValue}
          {unit ? ` ${unit}` : ""}
        </p>
      </div>
    );
  }

  const parsed = Number(text.replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(parsed);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(parsed);
      }}
    >
      <label className="sr-only" htmlFor="answer-number">
        Your answer{unit ? ` in ${unit}` : ""}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="answer-number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          className="app-input numeric py-4 text-center text-2xl"
        />
        {unit ? <span className="text-lg opacity-70">{unit}</span> : null}
      </div>
      <button
        type="submit"
        disabled={disabled || !valid}
        className="btn btn-primary mt-3 w-full py-3 text-base"
      >
        Submit
      </button>
    </form>
  );
}

function SliderEntry({
  min,
  max,
  step,
  unit,
  disabled,
  submittedValue,
  onSubmit,
}: {
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled: boolean;
  submittedValue: number | null;
  onSubmit: (value: number) => void;
}) {
  const [value, setValue] = useState((min + max) / 2);
  const locked = submittedValue !== null;
  const shown = submittedValue ?? value;

  return (
    <div>
      <p className="numeric mb-4 text-center text-4xl font-bold">
        {shown}
        {unit ? <span className="ml-1 text-xl opacity-70">{unit}</span> : null}
      </p>

      <label className="sr-only" htmlFor="answer-slider">
        Your estimate
      </label>
      <input
        id="answer-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={locked || disabled}
        onChange={(e) => setValue(Number(e.target.value))}
        className="h-3 w-full cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(90deg, var(--q-accent) ${
            ((shown - min) / (max - min)) * 100
          }%, color-mix(in srgb, var(--q-text) 20%, transparent) ${
            ((shown - min) / (max - min)) * 100
          }%)`,
        }}
      />

      <div className="mt-1 flex justify-between text-sm opacity-60">
        <span className="numeric">{min}</span>
        <span className="numeric">{max}</span>
      </div>

      {!locked ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(value)}
          className="btn btn-primary mt-4 w-full py-3 text-base"
        >
          Lock it in
        </button>
      ) : null}
    </div>
  );
}

/**
 * Ordering uses up/down buttons rather than drag-and-drop.
 *
 * Native HTML drag-and-drop does not work on touch devices at all, and a
 * custom pointer-events implementation is both fiddly and inaccessible to
 * keyboard and screen-reader users. Buttons work everywhere, for everyone, and
 * are faster under time pressure on a phone.
 */
function Ordering({
  items,
  disabled,
  submitted,
  onSubmit,
}: {
  items: Array<{ id: string; text: string }>;
  disabled: boolean;
  submitted: string[] | null;
  onSubmit: (order: string[]) => void;
}) {
  const [order, setOrder] = useState(items.map((i) => i.id));
  const locked = submitted !== null;
  const shown = submitted ?? order;
  const byId = new Map(items.map((i) => [i.id, i]));

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <div>
      <p className="mb-3 text-sm opacity-75">Put these in the right order.</p>

      <ol className="space-y-2">
        {shown.map((id, index) => (
          <li
            key={id}
            className="quiz-card flex items-center gap-3 px-3 py-3"
          >
            <span className="numeric w-6 text-center text-lg font-bold opacity-60">
              {index + 1}
            </span>
            <span className="flex-1 font-medium">{byId.get(id)?.text ?? id}</span>
            {!locked ? (
              <span className="flex gap-1">
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${byId.get(id)?.text ?? id} up`}
                  className="btn btn-ghost h-11 w-11 p-0 text-lg"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={disabled || index === shown.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${byId.get(id)?.text ?? id} down`}
                  className="btn btn-ghost h-11 w-11 p-0 text-lg"
                >
                  ↓
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {!locked ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit(order)}
          className="btn btn-primary mt-4 w-full py-3 text-base"
        >
          Lock in this order
        </button>
      ) : null}
    </div>
  );
}

function Matching({
  lefts,
  rights,
  disabled,
  submitted,
  onSubmit,
}: {
  lefts: Array<{ id: string; text: string }>;
  rights: string[];
  disabled: boolean;
  submitted: Record<string, string> | null;
  onSubmit: (matches: Record<string, string>) => void;
}) {
  const [matches, setMatches] = useState<Record<string, string>>({});
  const locked = submitted !== null;
  const shown = submitted ?? matches;
  const complete = lefts.every((l) => shown[l.id]);

  return (
    <div>
      <p className="mb-3 text-sm opacity-75">Match each item to its pair.</p>

      <div className="space-y-3">
        {lefts.map((left) => (
          <div key={left.id} className="quiz-card px-3 py-3">
            <label
              className="mb-2 block font-medium"
              htmlFor={`match-${left.id}`}
            >
              {left.text}
            </label>
            <select
              id={`match-${left.id}`}
              value={shown[left.id] ?? ""}
              disabled={locked || disabled}
              onChange={(e) =>
                setMatches((prev) => ({ ...prev, [left.id]: e.target.value }))
              }
              className="app-input"
            >
              <option value="">Choose…</option>
              {rights.map((right) => (
                <option key={right} value={right}>
                  {right}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {!locked ? (
        <button
          type="button"
          disabled={disabled || !complete}
          onClick={() => onSubmit(matches)}
          className="btn btn-primary mt-4 w-full py-3 text-base"
        >
          Lock in
        </button>
      ) : null}
    </div>
  );
}
