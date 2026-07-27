import { z } from "zod";

/**
 * The question-type system.
 *
 * Every question type is defined exactly once, here: its payload shape, the
 * shape of a player's response, and how a response is graded. Adding an
 * eleventh type means adding one entry to each of the three unions below and
 * one branch in `grade()` — the editor, the play screen and the results page
 * all read from this file, so nothing else needs to change.
 *
 * `Question.payload` and `Answer.response` are JSON columns in Postgres. They
 * are parsed through these schemas on every read and write, so "JSON column"
 * never means "column of arbitrary unvalidated shape".
 */

// ────────────────────────────── Shared pieces ───────────────────────────────

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

export const optionSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().trim().max(300),
  /** Optional image URL — answers can be pictures instead of words. */
  image: z.string().url().max(2000).optional(),
});

export type QuizOption = z.infer<typeof optionSchema>;

// ─────────────────────────────── Payloads ───────────────────────────────────

export const multipleChoicePayload = z.object({
  type: z.literal("MULTIPLE_CHOICE"),
  options: z.array(optionSchema).min(2).max(6),
  correctId: z.string().min(1),
});

export const multipleSelectPayload = z.object({
  type: z.literal("MULTIPLE_SELECT"),
  options: z.array(optionSchema).min(2).max(6),
  correctIds: z.array(z.string().min(1)).min(1),
  /** Award a fraction of the points for a partially correct set. */
  partialCredit: z.boolean().default(true),
});

export const trueFalsePayload = z.object({
  type: z.literal("TRUE_FALSE"),
  correct: z.boolean(),
});

export const typeAnswerPayload = z.object({
  type: z.literal("TYPE_ANSWER"),
  /** Any of these count as right — lets you accept synonyms and spellings. */
  accepted: z.array(nonEmpty(200)).min(1).max(20),
  caseSensitive: z.boolean().default(false),
  /**
   * Allowed edit distance. 0 = exact. 1–2 forgives a typo, which matters a lot
   * when players are thumb-typing on a phone against a timer.
   */
  typoTolerance: z.number().int().min(0).max(3).default(1),
});

export const numericPayload = z.object({
  type: z.literal("NUMERIC"),
  correct: z.number(),
  /** Absolute tolerance: |answer - correct| <= tolerance counts as right. */
  tolerance: z.number().min(0).default(0),
  unit: z.string().trim().max(20).optional(),
});

export const orderingPayload = z.object({
  type: z.literal("ORDERING"),
  items: z.array(optionSchema).min(2).max(8),
  /** Item ids in the correct sequence. */
  correctOrder: z.array(z.string().min(1)).min(2),
  partialCredit: z.boolean().default(true),
});

export const matchingPayload = z.object({
  type: z.literal("MATCHING"),
  pairs: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        left: nonEmpty(160),
        right: nonEmpty(160),
      }),
    )
    .min(2)
    .max(6),
  partialCredit: z.boolean().default(true),
});

export const sliderPayload = z.object({
  type: z.literal("SLIDER"),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().default(1),
  correct: z.number(),
  tolerance: z.number().min(0).default(0),
  unit: z.string().trim().max(20).optional(),
});

/** No right answer — used to take the room's temperature. Scores zero. */
export const pollPayload = z.object({
  type: z.literal("POLL"),
  options: z.array(optionSchema).min(2).max(8),
});

/** Free text aggregated into a live word cloud. Also unscored. */
export const wordCloudPayload = z.object({
  type: z.literal("WORD_CLOUD"),
  maxWordsPerPlayer: z.number().int().min(1).max(5).default(1),
  maxWordLength: z.number().int().min(1).max(40).default(24),
});

export const questionPayloadSchema = z.discriminatedUnion("type", [
  multipleChoicePayload,
  multipleSelectPayload,
  trueFalsePayload,
  typeAnswerPayload,
  numericPayload,
  orderingPayload,
  matchingPayload,
  sliderPayload,
  pollPayload,
  wordCloudPayload,
]);

export type QuestionPayload = z.infer<typeof questionPayloadSchema>;
export type QuestionTypeName = QuestionPayload["type"];

// ───────────────────────────── Cross-field checks ───────────────────────────

/**
 * Shape validation alone lets you save a multiple-choice question whose
 * `correctId` matches no option — structurally valid, and unanswerable. These
 * checks close that gap and run on every save.
 */
export function validatePayloadIntegrity(
  payload: QuestionPayload,
): { ok: true } | { ok: false; error: string } {
  switch (payload.type) {
    case "MULTIPLE_CHOICE": {
      const ids = new Set(payload.options.map((o) => o.id));
      if (ids.size !== payload.options.length)
        return { ok: false, error: "Answer options have duplicate ids." };
      if (!ids.has(payload.correctId))
        return { ok: false, error: "Mark one of the options as the correct answer." };
      return { ok: true };
    }

    case "MULTIPLE_SELECT": {
      const ids = new Set(payload.options.map((o) => o.id));
      if (ids.size !== payload.options.length)
        return { ok: false, error: "Answer options have duplicate ids." };
      if (payload.correctIds.some((id) => !ids.has(id)))
        return { ok: false, error: "A correct answer refers to an option that no longer exists." };
      if (payload.correctIds.length === payload.options.length)
        return { ok: false, error: "At least one option must be incorrect." };
      return { ok: true };
    }

    case "ORDERING": {
      const ids = new Set(payload.items.map((i) => i.id));
      if (ids.size !== payload.items.length)
        return { ok: false, error: "Items have duplicate ids." };
      if (payload.correctOrder.length !== payload.items.length)
        return { ok: false, error: "The correct order must list every item exactly once." };
      if (new Set(payload.correctOrder).size !== payload.correctOrder.length)
        return { ok: false, error: "The correct order repeats an item." };
      if (payload.correctOrder.some((id) => !ids.has(id)))
        return { ok: false, error: "The correct order refers to an item that no longer exists." };
      return { ok: true };
    }

    case "MATCHING": {
      const ids = new Set(payload.pairs.map((p) => p.id));
      if (ids.size !== payload.pairs.length)
        return { ok: false, error: "Pairs have duplicate ids." };
      const rights = payload.pairs.map((p) => p.right.toLowerCase());
      if (new Set(rights).size !== rights.length)
        return {
          ok: false,
          error: "Two pairs share the same right-hand value, so the question has more than one valid solution.",
        };
      return { ok: true };
    }

    case "SLIDER": {
      if (payload.min >= payload.max)
        return { ok: false, error: "The slider's minimum must be below its maximum." };
      if (payload.correct < payload.min || payload.correct > payload.max)
        return { ok: false, error: "The correct value sits outside the slider's range." };
      if ((payload.max - payload.min) / payload.step > 10_000)
        return { ok: false, error: "That range and step produce too many slider positions." };
      return { ok: true };
    }

    case "POLL": {
      const ids = new Set(payload.options.map((o) => o.id));
      if (ids.size !== payload.options.length)
        return { ok: false, error: "Poll options have duplicate ids." };
      return { ok: true };
    }

    default:
      return { ok: true };
  }
}

// ─────────────────────────────── Responses ──────────────────────────────────

export const responseSchema = z.union([
  z.object({ kind: z.literal("choice"), optionId: z.string().max(64) }),
  z.object({ kind: z.literal("multi"), optionIds: z.array(z.string().max(64)).max(8) }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({ kind: z.literal("text"), text: z.string().max(300) }),
  z.object({ kind: z.literal("number"), value: z.number().finite() }),
  z.object({ kind: z.literal("order"), order: z.array(z.string().max(64)).max(8) }),
  z.object({
    kind: z.literal("matches"),
    matches: z.record(z.string().max(64), z.string().max(64)),
  }),
  z.object({ kind: z.literal("words"), words: z.array(z.string().max(40)).max(5) }),
  /** Ran out of time without answering. */
  z.object({ kind: z.literal("timeout") }),
]);

export type PlayerResponse = z.infer<typeof responseSchema>;

// ──────────────────────────────── Grading ───────────────────────────────────

export interface GradeResult {
  correct: boolean;
  /** 0…1. Drives partial credit; binary types return exactly 0 or 1. */
  ratio: number;
  /** True for POLL / WORD_CLOUD, which contribute no points. */
  unscored: boolean;
}

const WRONG: GradeResult = { correct: false, ratio: 0, unscored: false };
const UNSCORED: GradeResult = { correct: true, ratio: 0, unscored: true };

/** Levenshtein distance, capped — we only ever care about "is it within N?". */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      rowMin = Math.min(rowMin, curr[j]!);
    }
    // Whole row already exceeds the cap — no later row can come back under it.
    if (rowMin > cap) return cap + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

function normalise(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents: "café" === "cafe"
    .replace(/\s+/g, " ");
}

export function grade(
  payload: QuestionPayload,
  response: PlayerResponse,
): GradeResult {
  if (response.kind === "timeout") {
    return payload.type === "POLL" || payload.type === "WORD_CLOUD" ? UNSCORED : WRONG;
  }

  switch (payload.type) {
    case "MULTIPLE_CHOICE":
      if (response.kind !== "choice") return WRONG;
      return response.optionId === payload.correctId
        ? { correct: true, ratio: 1, unscored: false }
        : WRONG;

    case "TRUE_FALSE":
      if (response.kind !== "boolean") return WRONG;
      return response.value === payload.correct
        ? { correct: true, ratio: 1, unscored: false }
        : WRONG;

    case "MULTIPLE_SELECT": {
      if (response.kind !== "multi") return WRONG;

      const correct = new Set(payload.correctIds);
      const picked = new Set(response.optionIds);
      const hits = [...picked].filter((id) => correct.has(id)).length;
      const misses = [...picked].filter((id) => !correct.has(id)).length;

      const exact = hits === correct.size && misses === 0;
      if (exact) return { correct: true, ratio: 1, unscored: false };
      if (!payload.partialCredit) return WRONG;

      // Wrong picks cancel out right ones, so shotgunning every option scores 0
      // rather than guaranteeing partial credit.
      const ratio = Math.max(0, (hits - misses) / correct.size);
      return { correct: false, ratio, unscored: false };
    }

    case "TYPE_ANSWER": {
      if (response.kind !== "text") return WRONG;

      const given = payload.caseSensitive
        ? response.text.trim()
        : normalise(response.text);

      for (const raw of payload.accepted) {
        const target = payload.caseSensitive ? raw.trim() : normalise(raw);
        if (given === target) return { correct: true, ratio: 1, unscored: false };

        if (payload.typoTolerance > 0) {
          // Don't let fuzzy matching make very short answers meaningless —
          // with tolerance 2, "cat" would otherwise match "dog".
          const tolerance = Math.min(
            payload.typoTolerance,
            Math.floor(target.length / 3),
          );
          if (tolerance > 0 && editDistance(given, target, tolerance) <= tolerance) {
            return { correct: true, ratio: 1, unscored: false };
          }
        }
      }
      return WRONG;
    }

    case "NUMERIC":
      if (response.kind !== "number") return WRONG;
      return Math.abs(response.value - payload.correct) <= payload.tolerance
        ? { correct: true, ratio: 1, unscored: false }
        : WRONG;

    case "SLIDER":
      if (response.kind !== "number") return WRONG;
      return Math.abs(response.value - payload.correct) <= payload.tolerance
        ? { correct: true, ratio: 1, unscored: false }
        : WRONG;

    case "ORDERING": {
      if (response.kind !== "order") return WRONG;
      if (response.order.length !== payload.correctOrder.length) return WRONG;

      let inPlace = 0;
      for (let i = 0; i < payload.correctOrder.length; i++) {
        if (response.order[i] === payload.correctOrder[i]) inPlace++;
      }

      if (inPlace === payload.correctOrder.length)
        return { correct: true, ratio: 1, unscored: false };
      if (!payload.partialCredit) return WRONG;

      return {
        correct: false,
        ratio: inPlace / payload.correctOrder.length,
        unscored: false,
      };
    }

    case "MATCHING": {
      if (response.kind !== "matches") return WRONG;

      let hits = 0;
      for (const pair of payload.pairs) {
        if (response.matches[pair.id] === pair.right) hits++;
      }

      if (hits === payload.pairs.length)
        return { correct: true, ratio: 1, unscored: false };
      if (!payload.partialCredit) return WRONG;

      return { correct: false, ratio: hits / payload.pairs.length, unscored: false };
    }

    case "POLL":
    case "WORD_CLOUD":
      return UNSCORED;
  }
}

// ──────────────────────── Player-safe question view ─────────────────────────

/**
 * What a payload looks like with every answer removed.
 *
 * This is the anti-cheat boundary. The naive implementation of a quiz game
 * sends the whole question to the client and hides the answer in the UI — which
 * means the answer is one devtools panel away, and the game is trivially
 * beatable. Nothing in this codebase sends a raw payload to a player: the
 * realtime layer sends `PublicPayload` while the question is live, and grading
 * happens on the server against the payload the server holds.
 *
 * The correct answer reaches players exactly once, in the reveal event, after
 * answers are locked.
 */
export type PublicPayload =
  | { type: "MULTIPLE_CHOICE"; options: QuizOption[] }
  | { type: "MULTIPLE_SELECT"; options: QuizOption[]; pickCount: number }
  | { type: "TRUE_FALSE" }
  | { type: "TYPE_ANSWER" }
  | { type: "NUMERIC"; unit?: string }
  | { type: "ORDERING"; items: QuizOption[] }
  | { type: "MATCHING"; lefts: Array<{ id: string; text: string }>; rights: string[] }
  | { type: "SLIDER"; min: number; max: number; step: number; unit?: string }
  | { type: "POLL"; options: QuizOption[] }
  | { type: "WORD_CLOUD"; maxWordsPerPlayer: number; maxWordLength: number };

/** Deterministic shuffle so host and players see the same order. */
function shuffleWithSeed<T>(items: T[], seed: string): T[] {
  // xmur3-style string hash into a mulberry32 PRNG. Small, dependency-free and
  // — critically — reproducible from a seed we already have (the question id).
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const random = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function toPublicPayload(
  payload: QuestionPayload,
  opts: { shuffleAnswers: boolean; seed: string },
): PublicPayload {
  const maybeShuffle = <T>(items: T[]) =>
    opts.shuffleAnswers ? shuffleWithSeed(items, opts.seed) : items;

  switch (payload.type) {
    case "MULTIPLE_CHOICE":
      return { type: "MULTIPLE_CHOICE", options: maybeShuffle(payload.options) };

    case "MULTIPLE_SELECT":
      return {
        type: "MULTIPLE_SELECT",
        options: maybeShuffle(payload.options),
        // Telling players how many to pick is standard for this format and
        // doesn't reveal which ones.
        pickCount: payload.correctIds.length,
      };

    case "TRUE_FALSE":
      return { type: "TRUE_FALSE" };

    case "TYPE_ANSWER":
      return { type: "TYPE_ANSWER" };

    case "NUMERIC":
      return { type: "NUMERIC", unit: payload.unit };

    case "ORDERING":
      // Always shuffled — presenting items in the correct order would give the
      // answer away to anyone who just doesn't touch them.
      return {
        type: "ORDERING",
        items: shuffleWithSeed(payload.items, opts.seed),
      };

    case "MATCHING":
      return {
        type: "MATCHING",
        lefts: payload.pairs.map((p) => ({ id: p.id, text: p.left })),
        // Right-hand values are shuffled and detached from their ids, so the
        // pairing cannot be read off the array order.
        rights: shuffleWithSeed(
          payload.pairs.map((p) => p.right),
          opts.seed,
        ),
      };

    case "SLIDER":
      return {
        type: "SLIDER",
        min: payload.min,
        max: payload.max,
        step: payload.step,
        unit: payload.unit,
      };

    case "POLL":
      return { type: "POLL", options: maybeShuffle(payload.options) };

    case "WORD_CLOUD":
      return {
        type: "WORD_CLOUD",
        maxWordsPerPlayer: payload.maxWordsPerPlayer,
        maxWordLength: payload.maxWordLength,
      };
  }
}

/** A human-readable correct answer, for the reveal screen and results export. */
export function describeCorrectAnswer(payload: QuestionPayload): string {
  switch (payload.type) {
    case "MULTIPLE_CHOICE":
      return payload.options.find((o) => o.id === payload.correctId)?.text ?? "—";
    case "MULTIPLE_SELECT":
      return payload.options
        .filter((o) => payload.correctIds.includes(o.id))
        .map((o) => o.text)
        .join(", ");
    case "TRUE_FALSE":
      return payload.correct ? "True" : "False";
    case "TYPE_ANSWER":
      return payload.accepted[0] ?? "—";
    case "NUMERIC":
      return `${payload.correct}${payload.unit ? ` ${payload.unit}` : ""}`;
    case "SLIDER":
      return `${payload.correct}${payload.unit ? ` ${payload.unit}` : ""}`;
    case "ORDERING":
      return payload.correctOrder
        .map((id) => payload.items.find((i) => i.id === id)?.text ?? "?")
        .join(" → ");
    case "MATCHING":
      return payload.pairs.map((p) => `${p.left} → ${p.right}`).join(", ");
    case "POLL":
    case "WORD_CLOUD":
      return "No right answer";
  }
}

// ───────────────────────── Editor-facing metadata ───────────────────────────

export interface QuestionTypeMeta {
  id: QuestionTypeName;
  label: string;
  /** One line shown in the "add question" picker. */
  blurb: string;
  icon: string;
  scored: boolean;
  /** Sensible starting payload when the author picks this type. */
  defaults: () => QuestionPayload;
}

const opt = (id: string, text: string): QuizOption => ({ id, text });

export const QUESTION_TYPES: QuestionTypeMeta[] = [
  {
    id: "MULTIPLE_CHOICE",
    label: "Multiple choice",
    blurb: "Four answers, one right. The classic.",
    icon: "◆",
    scored: true,
    defaults: () => ({
      type: "MULTIPLE_CHOICE",
      options: [opt("a", ""), opt("b", ""), opt("c", ""), opt("d", "")],
      correctId: "a",
    }),
  },
  {
    id: "MULTIPLE_SELECT",
    label: "Choose all that apply",
    blurb: "Several right answers — wrong picks cancel out right ones.",
    icon: "▤",
    scored: true,
    defaults: () => ({
      type: "MULTIPLE_SELECT",
      options: [opt("a", ""), opt("b", ""), opt("c", ""), opt("d", "")],
      correctIds: ["a"],
      partialCredit: true,
    }),
  },
  {
    id: "TRUE_FALSE",
    label: "True or false",
    blurb: "Fastest question to write, fastest to answer.",
    icon: "⊙",
    scored: true,
    defaults: () => ({ type: "TRUE_FALSE", correct: true }),
  },
  {
    id: "TYPE_ANSWER",
    label: "Type the answer",
    blurb: "Players type it in. Forgives typos and accepts synonyms.",
    icon: "⌨",
    scored: true,
    defaults: () => ({
      type: "TYPE_ANSWER",
      accepted: [""],
      caseSensitive: false,
      typoTolerance: 1,
    }),
  },
  {
    id: "NUMERIC",
    label: "Number",
    blurb: "A numeric answer with an optional margin of error.",
    icon: "#",
    scored: true,
    defaults: () => ({ type: "NUMERIC", correct: 0, tolerance: 0 }),
  },
  {
    id: "SLIDER",
    label: "Slider",
    blurb: "Drag to estimate. Great for dates, percentages and prices.",
    icon: "⟷",
    scored: true,
    defaults: () => ({
      type: "SLIDER",
      min: 0,
      max: 100,
      step: 1,
      correct: 50,
      tolerance: 5,
    }),
  },
  {
    id: "ORDERING",
    label: "Put in order",
    blurb: "Drag items into sequence. Partial credit per correct position.",
    icon: "≡",
    scored: true,
    defaults: () => ({
      type: "ORDERING",
      items: [opt("a", ""), opt("b", ""), opt("c", "")],
      correctOrder: ["a", "b", "c"],
      partialCredit: true,
    }),
  },
  {
    id: "MATCHING",
    label: "Match pairs",
    blurb: "Connect left to right. Partial credit per correct pair.",
    icon: "⇄",
    scored: true,
    defaults: () => ({
      type: "MATCHING",
      pairs: [
        { id: "a", left: "", right: "" },
        { id: "b", left: "", right: "" },
      ],
      partialCredit: true,
    }),
  },
  {
    id: "POLL",
    label: "Poll",
    blurb: "No right answer — just see what the room thinks.",
    icon: "▦",
    scored: false,
    defaults: () => ({
      type: "POLL",
      options: [opt("a", ""), opt("b", ""), opt("c", "")],
    }),
  },
  {
    id: "WORD_CLOUD",
    label: "Word cloud",
    blurb: "Open text that builds into a live cloud as answers land.",
    icon: "❋",
    scored: false,
    defaults: () => ({
      type: "WORD_CLOUD",
      maxWordsPerPlayer: 1,
      maxWordLength: 24,
    }),
  },
];

export const QUESTION_TYPE_MAP = new Map(QUESTION_TYPES.map((t) => [t.id, t]));
