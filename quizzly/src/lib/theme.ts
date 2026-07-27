import { z } from "zod";

/**
 * The theming system.
 *
 * A theme is plain data, stored on the quiz row and turned into CSS custom
 * properties at render time. That has two consequences worth knowing:
 *
 *  - Themes are portable. Export a quiz to JSON and its look travels with it.
 *  - Themes are user-authorable. The custom-theme editor writes the same shape
 *    the built-ins use, so a user-made theme is not a second-class citizen.
 *
 * Every colour is validated as a hex string, so a theme can never inject
 * arbitrary text into a style attribute.
 */

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex colour like #4f46e5");

// ────────────────────────────── Backgrounds ─────────────────────────────────

export const backgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("solid"), color: hexColor }),
  z.object({
    kind: z.literal("gradient"),
    from: hexColor,
    to: hexColor,
    angle: z.number().min(0).max(360).default(135),
  }),
  /** Several soft radial blooms — the "aurora" look. */
  z.object({
    kind: z.literal("mesh"),
    base: hexColor,
    blobs: z.array(hexColor).min(2).max(4),
  }),
  z.object({ kind: z.literal("grid"), base: hexColor, line: hexColor }),
  z.object({ kind: z.literal("dots"), base: hexColor, dot: hexColor }),
  /** Diagonal stripes radiating from a corner — game-show energy. */
  z.object({ kind: z.literal("rays"), base: hexColor, ray: hexColor }),
]);

export type Background = z.infer<typeof backgroundSchema>;

// ─────────────────────────────── Typography ─────────────────────────────────

/**
 * Font pairings are a fixed list rather than free text on purpose: it keeps the
 * CSP tight (no arbitrary remote font URLs) and stops users picking
 * combinations that are unreadable on a projector at the back of a hall.
 * All stacks resolve to fonts already present on the device — nothing is
 * fetched, so there is no third-party request and no cookie banner implication.
 */
export const FONT_PAIRS = {
  system: {
    label: "System",
    display: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    body: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  editorial: {
    label: "Editorial",
    display: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
    body: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  geometric: {
    label: "Geometric",
    display: "'Avenir Next', 'Century Gothic', ui-rounded, system-ui, sans-serif",
    body: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  },
  mono: {
    label: "Terminal",
    display: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",
    body: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",
  },
  rounded: {
    label: "Rounded",
    display: "ui-rounded, 'SF Pro Rounded', 'Segoe UI Variable', system-ui, sans-serif",
    body: "ui-rounded, 'SF Pro Rounded', 'Segoe UI Variable', system-ui, sans-serif",
  },
  condensed: {
    label: "Condensed",
    display: "'Haettenschweiler', 'Arial Narrow', 'Oswald', Impact, sans-serif",
    body: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  },
} as const;

export type FontPairId = keyof typeof FONT_PAIRS;

const fontPairId = z.enum(
  Object.keys(FONT_PAIRS) as [FontPairId, ...FontPairId[]],
);

// ───────────────────────────── Answer styling ───────────────────────────────

export const ANSWER_SHAPES = {
  rounded: { label: "Rounded", radius: "0.9rem" },
  pill: { label: "Pill", radius: "999px" },
  sharp: { label: "Sharp", radius: "0" },
  soft: { label: "Soft", radius: "1.75rem" },
} as const;

export type AnswerShapeId = keyof typeof ANSWER_SHAPES;

// ──────────────────────────────── Theme ─────────────────────────────────────

export const themeSchema = z.object({
  name: z.string().trim().min(1).max(48),
  palette: z.object({
    surface: hexColor,
    surfaceAlt: hexColor,
    text: hexColor,
    muted: hexColor,
    accent: hexColor,
    accentText: hexColor,
    correct: hexColor,
    wrong: hexColor,
    /** One colour per answer tile — the four-colour grid people expect. */
    answers: z.array(hexColor).length(4),
  }),
  background: backgroundSchema,
  font: fontPairId,
  answerShape: z.enum(
    Object.keys(ANSWER_SHAPES) as [AnswerShapeId, ...AnswerShapeId[]],
  ),
  /** Respect the OS "reduce motion" setting on top of this. */
  animations: z.boolean().default(true),
});

export type Theme = z.infer<typeof themeSchema>;

// ────────────────────────────── Built-ins ───────────────────────────────────

export const BUILT_IN_THEMES: Record<string, Theme> = {
  midnight: {
    name: "Midnight",
    palette: {
      surface: "#0f1020",
      surfaceAlt: "#1a1c33",
      text: "#f4f4ff",
      muted: "#a3a3c2",
      accent: "#6366f1",
      accentText: "#ffffff",
      correct: "#22c55e",
      wrong: "#ef4444",
      answers: ["#ef4444", "#3b82f6", "#f59e0b", "#22c55e"],
    },
    background: { kind: "mesh", base: "#0f1020", blobs: ["#4338ca", "#7c3aed", "#0891b2"] },
    font: "geometric",
    answerShape: "rounded",
    animations: true,
  },
  daylight: {
    name: "Daylight",
    palette: {
      surface: "#ffffff",
      surfaceAlt: "#f4f5fb",
      text: "#16172b",
      muted: "#61627a",
      accent: "#4f46e5",
      accentText: "#ffffff",
      correct: "#15803d",
      wrong: "#dc2626",
      answers: ["#dc2626", "#2563eb", "#d97706", "#16a34a"],
    },
    background: { kind: "gradient", from: "#eef2ff", to: "#faf5ff", angle: 135 },
    font: "system",
    answerShape: "rounded",
    animations: true,
  },
  chalkboard: {
    name: "Chalkboard",
    palette: {
      surface: "#1f2d27",
      surfaceAlt: "#2a3c34",
      text: "#f2f7f4",
      muted: "#a8bdb4",
      accent: "#f4d35e",
      accentText: "#1f2d27",
      correct: "#7ee081",
      wrong: "#ee6055",
      answers: ["#ee6055", "#60d394", "#f4d35e", "#aaf683"],
    },
    background: { kind: "dots", base: "#1f2d27", dot: "#34473f" },
    font: "editorial",
    answerShape: "sharp",
    animations: true,
  },
  neon: {
    name: "Neon Arcade",
    palette: {
      surface: "#0a0118",
      surfaceAlt: "#170a2e",
      text: "#f0e7ff",
      muted: "#9d8bbc",
      accent: "#ff2e97",
      accentText: "#ffffff",
      correct: "#00f5a0",
      wrong: "#ff3864",
      answers: ["#ff3864", "#00d9ff", "#ffcc00", "#00f5a0"],
    },
    background: { kind: "rays", base: "#0a0118", ray: "#22084a" },
    font: "condensed",
    answerShape: "sharp",
    animations: true,
  },
  paper: {
    name: "Paper",
    palette: {
      surface: "#fdfcf7",
      surfaceAlt: "#f2efe4",
      text: "#2b2620",
      muted: "#6f6558",
      accent: "#b45309",
      accentText: "#ffffff",
      correct: "#4d7c0f",
      wrong: "#b91c1c",
      answers: ["#b91c1c", "#1d4ed8", "#b45309", "#4d7c0f"],
    },
    background: { kind: "grid", base: "#fdfcf7", line: "#e7e1d2" },
    font: "editorial",
    answerShape: "soft",
    animations: true,
  },
  terminal: {
    name: "Terminal",
    palette: {
      surface: "#0c0c0c",
      surfaceAlt: "#161616",
      text: "#33ff66",
      muted: "#1f8f3d",
      accent: "#33ff66",
      accentText: "#0c0c0c",
      correct: "#33ff66",
      wrong: "#ff4444",
      answers: ["#ff4444", "#44aaff", "#ffcc33", "#33ff66"],
    },
    background: { kind: "solid", color: "#0c0c0c" },
    font: "mono",
    answerShape: "sharp",
    animations: false,
  },
  bubblegum: {
    name: "Bubblegum",
    palette: {
      surface: "#fff5f9",
      surfaceAlt: "#ffe3ee",
      text: "#3d1f2e",
      muted: "#8a6076",
      accent: "#ec4899",
      accentText: "#ffffff",
      correct: "#10b981",
      wrong: "#f43f5e",
      answers: ["#f43f5e", "#8b5cf6", "#f59e0b", "#10b981"],
    },
    background: {
      kind: "mesh",
      base: "#fff5f9",
      blobs: ["#fbcfe8", "#ddd6fe", "#bfdbfe"],
    },
    font: "rounded",
    answerShape: "pill",
    animations: true,
  },
  slate: {
    name: "Slate",
    palette: {
      surface: "#f8fafc",
      surfaceAlt: "#eef2f6",
      text: "#0f172a",
      muted: "#64748b",
      accent: "#0f172a",
      accentText: "#ffffff",
      correct: "#059669",
      wrong: "#e11d48",
      answers: ["#e11d48", "#0284c7", "#ca8a04", "#059669"],
    },
    background: { kind: "solid", color: "#f8fafc" },
    font: "system",
    answerShape: "rounded",
    animations: true,
  },
  sunset: {
    name: "Sunset",
    palette: {
      surface: "#1b1023",
      surfaceAlt: "#2d1832",
      text: "#ffeede",
      muted: "#c9a9b4",
      accent: "#fb923c",
      accentText: "#1b1023",
      correct: "#4ade80",
      wrong: "#f87171",
      answers: ["#f87171", "#60a5fa", "#fbbf24", "#4ade80"],
    },
    background: { kind: "gradient", from: "#7c2d5e", to: "#1b1023", angle: 160 },
    font: "geometric",
    answerShape: "soft",
    animations: true,
  },
  forest: {
    name: "Forest",
    palette: {
      surface: "#0f1c15",
      surfaceAlt: "#172b20",
      text: "#e8f5ec",
      muted: "#93b3a1",
      accent: "#34d399",
      accentText: "#0f1c15",
      correct: "#4ade80",
      wrong: "#fb7185",
      answers: ["#fb7185", "#38bdf8", "#facc15", "#4ade80"],
    },
    background: { kind: "mesh", base: "#0f1c15", blobs: ["#166534", "#0f766e"] },
    font: "rounded",
    answerShape: "rounded",
    animations: true,
  },
};

export const DEFAULT_THEME = BUILT_IN_THEMES.midnight!;

// ─────────────────────────── Theme → CSS variables ──────────────────────────

function backgroundCss(bg: Background): string {
  switch (bg.kind) {
    case "solid":
      return bg.color;

    case "gradient":
      return `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;

    case "mesh": {
      // Radial blooms at fixed anchor points, layered over the base colour.
      const anchors = [
        "20% 20%",
        "80% 25%",
        "35% 85%",
        "85% 80%",
      ];
      const layers = bg.blobs
        .map(
          (color, i) =>
            `radial-gradient(closest-side at ${anchors[i % anchors.length]}, ${color}66, transparent)`,
        )
        .join(", ");
      return `${layers}, ${bg.base}`;
    }

    case "grid":
      return (
        `linear-gradient(${bg.line} 1px, transparent 1px), ` +
        `linear-gradient(90deg, ${bg.line} 1px, transparent 1px), ` +
        `${bg.base}`
      );

    case "dots":
      return `radial-gradient(${bg.dot} 1.4px, transparent 1.4px), ${bg.base}`;

    case "rays":
      return `repeating-conic-gradient(from 0deg at 50% 0%, ${bg.ray} 0deg 6deg, transparent 6deg 12deg), ${bg.base}`;
  }
}

function backgroundSize(bg: Background): string {
  if (bg.kind === "grid") return "44px 44px, 44px 44px, auto";
  if (bg.kind === "dots") return "22px 22px, auto";
  return "auto";
}

/**
 * Turn a theme into the CSS custom properties the UI reads.
 *
 * Returned as a plain object for React's `style` prop rather than a string, so
 * there is no place for an injected value to escape into raw CSS — and no need
 * for `dangerouslySetInnerHTML` anywhere in the render path.
 */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const fonts = FONT_PAIRS[theme.font];
  const shape = ANSWER_SHAPES[theme.answerShape];

  return {
    "--q-surface": theme.palette.surface,
    "--q-surface-alt": theme.palette.surfaceAlt,
    "--q-text": theme.palette.text,
    "--q-muted": theme.palette.muted,
    "--q-accent": theme.palette.accent,
    "--q-accent-text": theme.palette.accentText,
    "--q-correct": theme.palette.correct,
    "--q-wrong": theme.palette.wrong,
    "--q-answer-1": theme.palette.answers[0]!,
    "--q-answer-2": theme.palette.answers[1]!,
    "--q-answer-3": theme.palette.answers[2]!,
    "--q-answer-4": theme.palette.answers[3]!,
    "--q-font-display": fonts.display,
    "--q-font-body": fonts.body,
    "--q-answer-radius": shape.radius,
    "--q-bg": backgroundCss(theme.background),
    "--q-bg-size": backgroundSize(theme.background),
    "--q-motion": theme.animations ? "1" : "0",
  };
}

// ──────────────────────────── Question layouts ──────────────────────────────

/**
 * Layouts change how a single question is composed on screen. They are per
 * question, not per quiz, so a quiz can open with a full-bleed image round and
 * then drop into a tight text-only lightning round.
 */
export const LAYOUTS = {
  classic: {
    label: "Classic",
    blurb: "Prompt on top, answers in a 2×2 grid.",
  },
  spotlight: {
    label: "Spotlight",
    blurb: "Oversized prompt, answers in a single column. Best for long questions.",
  },
  mediaTop: {
    label: "Image above",
    blurb: "Image sits between the prompt and the answers.",
  },
  mediaSplit: {
    label: "Split",
    blurb: "Image on one side, prompt and answers on the other.",
  },
  banner: {
    label: "Full bleed",
    blurb: "Image fills the screen with the prompt overlaid.",
  },
  minimal: {
    label: "Minimal",
    blurb: "No chrome, no colour blocks. Just the words.",
  },
} as const;

export type LayoutId = keyof typeof LAYOUTS;

export const presentationSchema = z.object({
  layout: z
    .enum(Object.keys(LAYOUTS) as [LayoutId, ...LayoutId[]])
    .default("classic"),
  /** Image shown with the question. */
  media: z.string().url().max(2000).optional(),
  /** Alt text — required whenever media is set, checked in `validatePresentation`. */
  mediaAlt: z.string().trim().max(300).optional(),
  /** Overrides the theme accent for this one question. */
  accentOverride: hexColor.optional(),
  /** Hide the countdown bar, e.g. for a discussion question. */
  hideTimer: z.boolean().default(false),
});

export type Presentation = z.infer<typeof presentationSchema>;

export const DEFAULT_PRESENTATION: Presentation = {
  layout: "classic",
  hideTimer: false,
};

/**
 * An image with no alt text is invisible to screen-reader users, and in a live
 * quiz that means the question is literally unanswerable for them. So this is a
 * hard validation error on save, not a lint warning.
 */
export function validatePresentation(
  p: Presentation,
): { ok: true } | { ok: false; error: string } {
  if (p.media && !p.mediaAlt?.trim()) {
    return {
      ok: false,
      error:
        "Describe the image in the alt-text field — without it, players using a screen reader cannot answer this question.",
    };
  }
  if ((p.layout === "banner" || p.layout === "mediaSplit" || p.layout === "mediaTop") && !p.media) {
    return {
      ok: false,
      error: `The "${LAYOUTS[p.layout].label}" layout needs an image.`,
    };
  }
  return { ok: true };
}
