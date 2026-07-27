import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import { env } from "../env";
import type { QuestionPayload, QuizOption } from "../question-schema";
import { validatePayloadIntegrity } from "../question-schema";
import {
  AiError,
  type AiProvider,
  type GenerateRequest,
  type GenerateResult,
  type GeneratedQuestion,
} from "./provider";

/**
 * Claude-backed quiz generation.
 *
 * Two design notes worth keeping in mind if you change this file:
 *
 * 1. STRUCTURED OUTPUT, NOT PROMPTED JSON. The response is constrained by a
 *    JSON schema (`output_config.format`), so the model cannot return prose,
 *    a markdown fence, or a truncated object. That removes the whole class of
 *    "parse the model's JSON and hope" bugs. Every generated question is *then*
 *    run through the same validators a hand-written question goes through —
 *    schema-valid is not the same as answerable.
 *
 * 2. FLAT SCHEMA, MAPPED AFTERWARDS. Rather than mirroring the discriminated
 *    union of `QuestionPayload` (which needs `anyOf` and is fiddly under strict
 *    schemas), the model fills one flat question shape and `toPayload()` maps it.
 *    Unused fields come back as empty arrays. It is less elegant and markedly
 *    more reliable.
 */

const questionSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "MULTIPLE_CHOICE",
        "MULTIPLE_SELECT",
        "TRUE_FALSE",
        "TYPE_ANSWER",
        "NUMERIC",
      ],
      description: "Which question format this is.",
    },
    prompt: {
      type: "string",
      description: "The question itself, as shown on screen. One sentence where possible.",
    },
    options: {
      type: "array",
      items: { type: "string" },
      description:
        "Answer options for MULTIPLE_CHOICE (exactly 4) and MULTIPLE_SELECT (4 to 6). Empty array for every other type.",
    },
    correctIndexes: {
      type: "array",
      items: { type: "integer" },
      description:
        "Zero-based indexes into `options` that are correct. Exactly one entry for MULTIPLE_CHOICE, one or more for MULTIPLE_SELECT (never all of them). Empty for other types.",
    },
    booleanAnswer: {
      type: "boolean",
      description: "The answer for TRUE_FALSE. Ignored for every other type.",
    },
    acceptedAnswers: {
      type: "array",
      items: { type: "string" },
      description:
        "For TYPE_ANSWER: every spelling and synonym that should count as correct. Empty for other types.",
    },
    numericAnswer: {
      type: "number",
      description: "The answer for NUMERIC. Ignored for other types.",
    },
    numericTolerance: {
      type: "number",
      description:
        "Acceptable margin of error for NUMERIC. Use 0 for exact counts, a sensible margin for estimates.",
    },
    explanation: {
      type: "string",
      description:
        "One or two sentences explaining why the answer is right, shown after the question is scored.",
    },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
  },
  required: [
    "type",
    "prompt",
    "options",
    "correctIndexes",
    "booleanAnswer",
    "acceptedAnswers",
    "numericAnswer",
    "numericTolerance",
    "explanation",
    "difficulty",
  ],
  additionalProperties: false,
} as const;

const quizSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short, appealing quiz title. Under 60 characters." },
    description: { type: "string", description: "One sentence describing the quiz." },
    questions: { type: "array", items: questionSchema },
  },
  required: ["title", "description", "questions"],
  additionalProperties: false,
} as const;

interface RawQuestion {
  type: string;
  prompt: string;
  options: string[];
  correctIndexes: number[];
  booleanAnswer: boolean;
  acceptedAnswers: string[];
  numericAnswer: number;
  numericTolerance: number;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
}

function systemPrompt(req: GenerateRequest): string {
  return [
    "You write questions for a live, fast-paced multiplayer quiz game. Players answer on their phones against a timer, usually 20 seconds.",
    "",
    "What makes a good question here:",
    "- The prompt fits comfortably on a phone screen. Long setups lose the room.",
    "- Exactly one defensible answer. If two options could be argued, rewrite it.",
    "- Wrong options are plausible to someone who half-knows the topic, never filler or jokes.",
    "- Wrong options are similar in length and specificity to the right one. The longest, most detailed option must not be a reliable tell.",
    "- No 'all of the above', 'none of the above', or 'both A and B'.",
    "- The answer is not deducible from the wording of the prompt alone.",
    "- Vary what you ask about across the set. Do not ask the same fact two ways.",
    "",
    `Write ${req.count} questions in ${req.language}.`,
    req.audience ? `Audience: ${req.audience}. Pitch the vocabulary and assumed knowledge accordingly.` : "",
    req.difficulty === "mixed"
      ? "Spread difficulty across easy, medium and hard, opening with something accessible so nobody is discouraged early."
      : `Aim for ${req.difficulty} difficulty throughout.`,
    `Use only these question types: ${req.types.join(", ")}. Mix them up rather than defaulting to one.`,
    req.sourceText
      ? "Base every question strictly on the supplied source material. Do not introduce outside facts, and do not ask about anything the source does not state."
      : "Only assert facts you are confident are correct. If you are unsure of a specific figure or date, ask about something you are sure of instead.",
  ]
    .filter(Boolean)
    .join("\n");
}

function userPrompt(req: GenerateRequest): string {
  if (req.sourceText) {
    return [
      `Topic: ${req.topic}`,
      "",
      "Source material:",
      "<source>",
      req.sourceText,
      "</source>",
    ].join("\n");
  }
  return `Topic: ${req.topic}`;
}

/** Map one flat model-authored question onto a validated `QuestionPayload`. */
function toPayload(raw: RawQuestion): QuestionPayload | null {
  const opts = (texts: string[]): QuizOption[] =>
    texts.map((text, i) => ({ id: String.fromCharCode(97 + i), text: text.trim() }));

  switch (raw.type) {
    case "MULTIPLE_CHOICE": {
      if (raw.options.length < 2 || raw.correctIndexes.length !== 1) return null;
      const index = raw.correctIndexes[0]!;
      if (index < 0 || index >= raw.options.length) return null;
      const options = opts(raw.options);
      return {
        type: "MULTIPLE_CHOICE",
        options,
        correctId: options[index]!.id,
      };
    }

    case "MULTIPLE_SELECT": {
      if (raw.options.length < 2 || raw.correctIndexes.length < 1) return null;
      if (raw.correctIndexes.some((i) => i < 0 || i >= raw.options.length)) return null;
      const options = opts(raw.options);
      const correctIds = [...new Set(raw.correctIndexes)].map((i) => options[i]!.id);
      return {
        type: "MULTIPLE_SELECT",
        options,
        correctIds,
        partialCredit: true,
      };
    }

    case "TRUE_FALSE":
      return { type: "TRUE_FALSE", correct: raw.booleanAnswer };

    case "TYPE_ANSWER": {
      const accepted = raw.acceptedAnswers.map((a) => a.trim()).filter(Boolean);
      if (accepted.length === 0) return null;
      return {
        type: "TYPE_ANSWER",
        accepted: accepted.slice(0, 20),
        caseSensitive: false,
        typoTolerance: 1,
      };
    }

    case "NUMERIC":
      if (!Number.isFinite(raw.numericAnswer)) return null;
      return {
        type: "NUMERIC",
        correct: raw.numericAnswer,
        tolerance: Math.max(0, raw.numericTolerance || 0),
      };

    default:
      return null;
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";

  async generateQuiz(
    request: GenerateRequest,
    apiKey: string,
  ): Promise<GenerateResult> {
    const client = new Anthropic({ apiKey, maxRetries: 2 });

    let message;
    try {
      // Streamed because a 20-question generation with thinking enabled can
      // comfortably run past the SDK's non-streaming HTTP timeout. We don't
      // render tokens as they arrive, we just want the timeout protection —
      // hence `finalMessage()` rather than handling individual events.
      const stream = client.messages.stream({
        model: env.AI_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: quizSchema },
        },
        system: systemPrompt(request),
        messages: [{ role: "user", content: userPrompt(request) }],
      });

      message = await stream.finalMessage();
    } catch (err) {
      throw translateSdkError(err);
    }

    if (message.stop_reason === "refusal") {
      throw new AiError(
        "Claude declined to write questions on that topic. Try rephrasing it, or write these questions yourself.",
      );
    }

    if (message.stop_reason === "max_tokens") {
      throw new AiError(
        "The response was cut short. Try generating fewer questions at a time.",
        true,
      );
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new AiError("Claude returned an empty response. Please try again.", true);
    }

    let parsed: { title: string; description: string; questions: RawQuestion[] };
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      // Should be unreachable given the schema constraint, but a hard crash
      // here would be a confusing 500 rather than a retryable message.
      throw new AiError("Claude returned a malformed quiz. Please try again.", true);
    }

    const questions: GeneratedQuestion[] = [];
    for (const raw of parsed.questions ?? []) {
      const prompt = raw.prompt?.trim();
      if (!prompt) continue;

      const payload = toPayload(raw);
      if (!payload) continue;

      // Same integrity checks a human-authored question faces. A generated
      // question that fails is dropped rather than surfaced as a broken one.
      if (!validatePayloadIntegrity(payload).ok) continue;

      questions.push({
        type: payload.type,
        prompt,
        payload,
        explanation: raw.explanation?.trim() || null,
        difficulty: raw.difficulty ?? "medium",
      });
    }

    if (questions.length === 0) {
      throw new AiError(
        "None of the generated questions were usable. Try a more specific topic.",
        true,
      );
    }

    return {
      title: parsed.title?.trim() || request.topic.slice(0, 60),
      description: parsed.description?.trim() || "",
      questions,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  }
}

/**
 * Convert SDK errors into messages that are safe and useful to show a user.
 * Raw SDK errors can embed request details, so they never reach the browser.
 */
function translateSdkError(err: unknown): AiError {
  // Ordered most-specific first: every one of these extends APIError, so a
  // leading `instanceof APIError` check would swallow the lot.
  if (err instanceof AuthenticationError) {
    return new AiError(
      "The configured AI API key was rejected. Check ANTHROPIC_API_KEY, or the key saved in your settings.",
    );
  }
  if (err instanceof PermissionDeniedError) {
    return new AiError("That API key doesn't have access to the configured model.");
  }
  if (err instanceof RateLimitError) {
    return new AiError("The AI service is rate-limiting us. Wait a moment and try again.", true);
  }
  if (err instanceof APIConnectionError) {
    return new AiError("Couldn't reach the AI service. Check your connection and try again.", true);
  }
  if (err instanceof APIError) {
    return (err.status ?? 500) >= 500
      ? new AiError("The AI service is having trouble. Please try again shortly.", true)
      : new AiError("The AI service rejected that request.");
  }

  // Log the real error server-side; return something generic to the caller.
  console.error("[ai] unexpected generation error", err);
  return new AiError("Something went wrong generating questions. Please try again.", true);
}
