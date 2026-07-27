"use client";

import { useState, useTransition } from "react";

import {
  ANSWER_SHAPES,
  BUILT_IN_THEMES,
  FONT_PAIRS,
  themeToCssVars,
  type AnswerShapeId,
  type Background,
  type FontPairId,
  type Theme,
} from "@/lib/theme";
import { updateThemeAction } from "@/app/actions/quiz";

/**
 * Theme editor with a live preview.
 *
 * The preview is a real render of the answer tiles using the same CSS custom
 * properties the game uses, rather than an approximation — so what you see here
 * is genuinely what the room will see on the projector.
 */
export function ThemeEditor({
  quizId,
  initialTheme,
}: {
  quizId: string;
  initialTheme: Theme;
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (partial: Partial<Theme>) => {
    setTheme((prev) => ({ ...prev, ...partial }));
    setMessage(null);
  };

  const patchPalette = (partial: Partial<Theme["palette"]>) =>
    setTheme((prev) => ({ ...prev, palette: { ...prev.palette, ...partial } }));

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateThemeAction(quizId, theme);
      if (result.error) setError(result.error);
      else setMessage("Theme saved.");
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {/* ── Presets ── */}
        <section className="app-card p-5">
          <h2 className="font-semibold text-white">Start from a preset</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(BUILT_IN_THEMES).map(([key, preset]) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => {
                    setTheme(preset);
                    setMessage(null);
                  }}
                  className={`w-full overflow-hidden rounded-lg border text-left transition-colors ${
                    theme.name === preset.name
                      ? "border-brand-500"
                      : "border-ink-800 hover:border-ink-600"
                  }`}
                >
                  <span
                    className="flex h-12 items-end gap-1 p-1.5"
                    style={{ background: preset.palette.surfaceAlt }}
                  >
                    {preset.palette.answers.map((color) => (
                      <span
                        key={color}
                        className="h-4 flex-1 rounded-sm"
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                  <span className="block px-2 py-1.5 text-xs font-medium text-ink-200">
                    {preset.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Typography and shape ── */}
        <section className="app-card p-5">
          <h2 className="font-semibold text-white">Type &amp; shape</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="app-label" htmlFor="font">
                Font pairing
              </label>
              <select
                id="font"
                value={theme.font}
                onChange={(e) => patch({ font: e.target.value as FontPairId })}
                className="app-input"
              >
                {Object.entries(FONT_PAIRS).map(([id, pair]) => (
                  <option key={id} value={id}>
                    {pair.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-500">
                All system fonts — nothing is downloaded, so nothing is tracked.
              </p>
            </div>

            <div>
              <label className="app-label" htmlFor="shape">
                Answer shape
              </label>
              <select
                id="shape"
                value={theme.answerShape}
                onChange={(e) =>
                  patch({ answerShape: e.target.value as AnswerShapeId })
                }
                className="app-input"
              >
                {Object.entries(ANSWER_SHAPES).map(([id, shape]) => (
                  <option key={id} value={id}>
                    {shape.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={theme.animations}
              onChange={(e) => patch({ animations: e.target.checked })}
              className="h-5 w-5 accent-brand-500"
            />
            <span className="text-sm text-ink-200">
              Animations
              <span className="block text-xs text-ink-500">
                Always overridden by the player&apos;s reduce-motion setting.
              </span>
            </span>
          </label>
        </section>

        {/* ── Colours ── */}
        <section className="app-card p-5">
          <h2 className="font-semibold text-white">Colours</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ColorField
              label="Card surface"
              value={theme.palette.surface}
              onChange={(surface) => patchPalette({ surface })}
            />
            <ColorField
              label="Text"
              value={theme.palette.text}
              onChange={(text) => patchPalette({ text })}
            />
            <ColorField
              label="Accent"
              value={theme.palette.accent}
              onChange={(accent) => patchPalette({ accent })}
            />
            <ColorField
              label="Muted text"
              value={theme.palette.muted}
              onChange={(muted) => patchPalette({ muted })}
            />
            <ColorField
              label="Correct"
              value={theme.palette.correct}
              onChange={(correct) => patchPalette({ correct })}
            />
            <ColorField
              label="Wrong"
              value={theme.palette.wrong}
              onChange={(wrong) => patchPalette({ wrong })}
            />
          </div>

          <p className="app-label mt-5">Answer tiles</p>
          <div className="grid grid-cols-4 gap-2">
            {theme.palette.answers.map((color, index) => (
              <ColorField
                key={index}
                label={`Tile ${index + 1}`}
                value={color}
                onChange={(next) =>
                  patchPalette({
                    answers: theme.palette.answers.map((c, i) =>
                      i === index ? next : c,
                    ) as Theme["palette"]["answers"],
                  })
                }
              />
            ))}
          </div>
        </section>

        {/* ── Background ── */}
        <section className="app-card p-5">
          <h2 className="font-semibold text-white">Background</h2>
          <BackgroundEditor
            background={theme.background}
            onChange={(background) => patch({ background })}
          />
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
          {pending ? "Saving…" : "Save theme"}
        </button>
      </div>

      {/* ── Live preview ── */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="app-label">Preview</p>
        <div
          className="quiz-surface overflow-hidden rounded-xl border border-ink-800 p-5"
          style={{ ...themeToCssVars(theme), minHeight: "auto" }}
        >
          <div className="quiz-card mb-4 px-4 py-5">
            <p className="quiz-display text-lg font-extrabold">
              Which planet is closest to the Sun?
            </p>
          </div>

          <div className="mb-4 h-2.5 w-full overflow-hidden rounded-full"
            style={{ background: "color-mix(in srgb, var(--q-text) 15%, transparent)" }}
          >
            <div
              className="h-full w-2/3 rounded-full"
              style={{ background: "var(--q-accent)" }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {["Mercury", "Venus", "Mars", "Neptune"].map((label, index) => (
              <div
                key={label}
                className="answer-tile px-3 py-4 text-sm font-semibold text-white"
                style={{ background: `var(--q-answer-${index + 1})` }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `color-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label className="app-label" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-ink-700 bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            // Only propagate complete, valid hex values — the schema rejects
            // anything else on save, and a half-typed value shouldn't blank the
            // preview on every keystroke.
            if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(next)) onChange(next);
          }}
          maxLength={7}
          className="app-input font-mono text-sm"
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  );
}

function BackgroundEditor({
  background,
  onChange,
}: {
  background: Background;
  onChange: (background: Background) => void;
}) {
  function switchKind(kind: Background["kind"]) {
    // Each background variant has different required fields, so switching
    // builds a fresh valid object rather than spreading incompatible ones.
    const base = "base" in background ? background.base : "#101223";
    switch (kind) {
      case "solid":
        return onChange({ kind: "solid", color: base });
      case "gradient":
        return onChange({ kind: "gradient", from: base, to: "#4338ca", angle: 135 });
      case "mesh":
        return onChange({ kind: "mesh", base, blobs: ["#4338ca", "#7c3aed"] });
      case "grid":
        return onChange({ kind: "grid", base, line: "#2a2d4a" });
      case "dots":
        return onChange({ kind: "dots", base, dot: "#2a2d4a" });
      case "rays":
        return onChange({ kind: "rays", base, ray: "#22084a" });
    }
  }

  return (
    <div className="mt-3 space-y-4">
      <div>
        <label className="app-label" htmlFor="bg-kind">
          Style
        </label>
        <select
          id="bg-kind"
          value={background.kind}
          onChange={(e) => switchKind(e.target.value as Background["kind"])}
          className="app-input"
        >
          <option value="solid">Solid</option>
          <option value="gradient">Gradient</option>
          <option value="mesh">Aurora</option>
          <option value="grid">Grid</option>
          <option value="dots">Dots</option>
          <option value="rays">Rays</option>
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {background.kind === "solid" ? (
          <ColorField
            label="Colour"
            value={background.color}
            onChange={(color) => onChange({ ...background, color })}
          />
        ) : null}

        {background.kind === "gradient" ? (
          <>
            <ColorField
              label="From"
              value={background.from}
              onChange={(from) => onChange({ ...background, from })}
            />
            <ColorField
              label="To"
              value={background.to}
              onChange={(to) => onChange({ ...background, to })}
            />
            <div>
              <label className="app-label" htmlFor="bg-angle">
                Angle: {background.angle}°
              </label>
              <input
                id="bg-angle"
                type="range"
                min={0}
                max={360}
                value={background.angle}
                onChange={(e) =>
                  onChange({ ...background, angle: Number(e.target.value) })
                }
                className="w-full"
              />
            </div>
          </>
        ) : null}

        {background.kind === "mesh" ? (
          <>
            <ColorField
              label="Base"
              value={background.base}
              onChange={(base) => onChange({ ...background, base })}
            />
            {background.blobs.map((blob, index) => (
              <ColorField
                key={index}
                label={`Bloom ${index + 1}`}
                value={blob}
                onChange={(next) =>
                  onChange({
                    ...background,
                    blobs: background.blobs.map((b, i) => (i === index ? next : b)),
                  })
                }
              />
            ))}
          </>
        ) : null}

        {background.kind === "grid" ? (
          <>
            <ColorField
              label="Base"
              value={background.base}
              onChange={(base) => onChange({ ...background, base })}
            />
            <ColorField
              label="Lines"
              value={background.line}
              onChange={(line) => onChange({ ...background, line })}
            />
          </>
        ) : null}

        {background.kind === "dots" ? (
          <>
            <ColorField
              label="Base"
              value={background.base}
              onChange={(base) => onChange({ ...background, base })}
            />
            <ColorField
              label="Dots"
              value={background.dot}
              onChange={(dot) => onChange({ ...background, dot })}
            />
          </>
        ) : null}

        {background.kind === "rays" ? (
          <>
            <ColorField
              label="Base"
              value={background.base}
              onChange={(base) => onChange({ ...background, base })}
            />
            <ColorField
              label="Rays"
              value={background.ray}
              onChange={(ray) => onChange({ ...background, ray })}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
