import { z } from "zod";

import type { QuestionPayload } from "../question-schema";

/**
 * Provider-agnostic contract for quiz generation.
 *
 * Only one implementation ships (Anthropic/Claude), but the app talks to this
 * interface rather than to the SDK directly. That keeps the generation feature
 * swappable, and — more usefully today — means every call site works unchanged
 * whether or not a key is configured.
 */

export const GENERATABLE_TYPES = [
  "MULTIPLE_CHOICE",
  "MULTIPLE_SELECT",
  "TRUE_FALSE",
  "TYPE_ANSWER",
  "NUMERIC",
] as const;

export type GeneratableType = (typeof GENERATABLE_TYPES)[number];

export const generateRequestSchema = z.object({
  /** What the quiz is about, or source text to build questions from. */
  topic: z.string().trim().min(3).max(4000),
  /** Optional longer source material to ground questions in. */
  sourceText: z.string().trim().max(20_000).optional(),
  count: z.number().int().min(1).max(20).default(8),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  /** Restrict to a subset of question types. */
  types: z
    .array(z.enum(GENERATABLE_TYPES))
    .min(1)
    .default(["MULTIPLE_CHOICE", "TRUE_FALSE"]),
  /** Natural-language audience hint, e.g. "GCSE biology students". */
  audience: z.string().trim().max(200).optional(),
  language: z.string().trim().max(40).default("English"),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export interface GeneratedQuestion {
  type: QuestionPayload["type"];
  prompt: string;
  payload: QuestionPayload;
  explanation: string | null;
  difficulty: "easy" | "medium" | "hard";
}

export interface GenerateResult {
  title: string;
  description: string;
  questions: GeneratedQuestion[];
  /** Surfaced in the UI so users can see what a generation cost. */
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly name: string;
  generateQuiz(request: GenerateRequest, apiKey: string): Promise<GenerateResult>;
}

/**
 * Whether a given user can generate right now, and on whose budget.
 *
 * Lives here rather than in `./index.ts` because client components need the
 * type, and `./index.ts` is `server-only` — importing it from a client
 * component is a build error even for a type-only import.
 */
export interface AiAvailability {
  available: boolean;
  /** Where the key came from — surfaced so users know whose budget they spend. */
  source: "user" | "server" | "none";
  reason?: string;
}

/**
 * Thrown for every failure users might actually see. Carries a message written
 * for a human, so route handlers can pass `.message` straight to the UI without
 * risking a raw SDK error (which could contain a key fragment or a stack trace)
 * reaching the browser.
 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiError";
  }
}
