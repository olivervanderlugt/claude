import { describe, expect, it } from "vitest";

import {
  grade,
  toPublicPayload,
  validatePayloadIntegrity,
  type QuestionPayload,
} from "./question-schema";

const opts = (...texts: string[]) =>
  texts.map((text, i) => ({ id: String.fromCharCode(97 + i), text }));

describe("grade — MULTIPLE_CHOICE", () => {
  const payload: QuestionPayload = {
    type: "MULTIPLE_CHOICE",
    options: opts("Mercury", "Venus", "Mars"),
    correctId: "a",
  };

  it("accepts the right option", () => {
    expect(grade(payload, { kind: "choice", optionId: "a" }).correct).toBe(true);
  });

  it("rejects a wrong option", () => {
    expect(grade(payload, { kind: "choice", optionId: "b" }).correct).toBe(false);
  });

  it("rejects a mismatched response shape", () => {
    // A tampered client sending the wrong response kind must not score.
    expect(grade(payload, { kind: "number", value: 1 }).correct).toBe(false);
  });

  it("scores a timeout as wrong", () => {
    expect(grade(payload, { kind: "timeout" }).correct).toBe(false);
  });
});

describe("grade — MULTIPLE_SELECT", () => {
  const payload: QuestionPayload = {
    type: "MULTIPLE_SELECT",
    options: opts("A", "B", "C", "D"),
    correctIds: ["a", "b"],
    partialCredit: true,
  };

  it("gives full marks for exactly the right set", () => {
    const result = grade(payload, { kind: "multi", optionIds: ["a", "b"] });
    expect(result.correct).toBe(true);
    expect(result.ratio).toBe(1);
  });

  it("gives partial credit for one of two", () => {
    const result = grade(payload, { kind: "multi", optionIds: ["a"] });
    expect(result.correct).toBe(false);
    expect(result.ratio).toBe(0.5);
  });

  it("scores zero for selecting everything", () => {
    // Shotgunning must not be a winning strategy: 2 hits − 2 misses = 0.
    const result = grade(payload, {
      kind: "multi",
      optionIds: ["a", "b", "c", "d"],
    });
    expect(result.ratio).toBe(0);
  });

  it("never returns a negative ratio", () => {
    const result = grade(payload, { kind: "multi", optionIds: ["c", "d"] });
    expect(result.ratio).toBe(0);
  });

  it("is all-or-nothing when partial credit is off", () => {
    const strict = { ...payload, partialCredit: false } as QuestionPayload;
    expect(grade(strict, { kind: "multi", optionIds: ["a"] }).ratio).toBe(0);
  });
});

describe("grade — TYPE_ANSWER", () => {
  const payload: QuestionPayload = {
    type: "TYPE_ANSWER",
    accepted: ["Paris"],
    caseSensitive: false,
    typoTolerance: 1,
  };

  it("matches case-insensitively", () => {
    expect(grade(payload, { kind: "text", text: "paris" }).correct).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(grade(payload, { kind: "text", text: "  Paris  " }).correct).toBe(true);
  });

  it("forgives a single-character typo", () => {
    expect(grade(payload, { kind: "text", text: "Pariss" }).correct).toBe(true);
  });

  it("still rejects a genuinely different answer", () => {
    expect(grade(payload, { kind: "text", text: "London" }).correct).toBe(false);
  });

  it("strips accents so 'cafe' matches 'café'", () => {
    const accented: QuestionPayload = {
      type: "TYPE_ANSWER",
      accepted: ["café"],
      caseSensitive: false,
      typoTolerance: 0,
    };
    expect(grade(accented, { kind: "text", text: "cafe" }).correct).toBe(true);
  });

  it("does not let fuzzy matching swallow short answers", () => {
    // With a naive tolerance of 2, "dog" would match "cat". The tolerance is
    // scaled down for short targets to prevent exactly this.
    const short: QuestionPayload = {
      type: "TYPE_ANSWER",
      accepted: ["cat"],
      caseSensitive: false,
      typoTolerance: 2,
    };
    expect(grade(short, { kind: "text", text: "dog" }).correct).toBe(false);
  });

  it("accepts any of several listed answers", () => {
    const synonyms: QuestionPayload = {
      type: "TYPE_ANSWER",
      accepted: ["H2O", "water"],
      caseSensitive: false,
      typoTolerance: 0,
    };
    expect(grade(synonyms, { kind: "text", text: "water" }).correct).toBe(true);
  });
});

describe("grade — NUMERIC", () => {
  const payload: QuestionPayload = {
    type: "NUMERIC",
    correct: 100,
    tolerance: 5,
  };

  it("accepts a value inside the tolerance", () => {
    expect(grade(payload, { kind: "number", value: 104 }).correct).toBe(true);
  });

  it("accepts the exact boundary", () => {
    expect(grade(payload, { kind: "number", value: 105 }).correct).toBe(true);
  });

  it("rejects a value outside the tolerance", () => {
    expect(grade(payload, { kind: "number", value: 106 }).correct).toBe(false);
  });
});

describe("grade — ORDERING", () => {
  const payload: QuestionPayload = {
    type: "ORDERING",
    items: opts("First", "Second", "Third"),
    correctOrder: ["a", "b", "c"],
    partialCredit: true,
  };

  it("gives full marks for the exact order", () => {
    expect(grade(payload, { kind: "order", order: ["a", "b", "c"] }).ratio).toBe(1);
  });

  it("gives credit per item in the right position", () => {
    const result = grade(payload, { kind: "order", order: ["a", "c", "b"] });
    expect(result.ratio).toBeCloseTo(1 / 3);
  });

  it("rejects an order of the wrong length", () => {
    expect(grade(payload, { kind: "order", order: ["a", "b"] }).correct).toBe(false);
  });
});

describe("grade — MATCHING", () => {
  const payload: QuestionPayload = {
    type: "MATCHING",
    pairs: [
      { id: "a", left: "France", right: "Paris" },
      { id: "b", left: "Japan", right: "Tokyo" },
    ],
    partialCredit: true,
  };

  it("gives full marks when every pair matches", () => {
    const result = grade(payload, {
      kind: "matches",
      matches: { a: "Paris", b: "Tokyo" },
    });
    expect(result.correct).toBe(true);
  });

  it("gives half marks for one right pair", () => {
    const result = grade(payload, {
      kind: "matches",
      matches: { a: "Paris", b: "Paris" },
    });
    expect(result.ratio).toBe(0.5);
  });
});

describe("grade — unscored types", () => {
  it("treats a poll response as participation", () => {
    const payload: QuestionPayload = { type: "POLL", options: opts("A", "B") };
    const result = grade(payload, { kind: "choice", optionId: "a" });
    expect(result.unscored).toBe(true);
  });
});

describe("validatePayloadIntegrity", () => {
  it("rejects a correctId that matches no option", () => {
    const result = validatePayloadIntegrity({
      type: "MULTIPLE_CHOICE",
      options: opts("A", "B"),
      correctId: "zzz",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a multi-select where every option is correct", () => {
    const result = validatePayloadIntegrity({
      type: "MULTIPLE_SELECT",
      options: opts("A", "B"),
      correctIds: ["a", "b"],
      partialCredit: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects matching pairs with a duplicate right-hand value", () => {
    // Two pairs sharing an answer means more than one valid solution.
    const result = validatePayloadIntegrity({
      type: "MATCHING",
      pairs: [
        { id: "a", left: "X", right: "Same" },
        { id: "b", left: "Y", right: "same" },
      ],
      partialCredit: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a slider whose answer is out of range", () => {
    const result = validatePayloadIntegrity({
      type: "SLIDER",
      min: 0,
      max: 10,
      step: 1,
      correct: 50,
      tolerance: 0,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed question", () => {
    const result = validatePayloadIntegrity({
      type: "MULTIPLE_CHOICE",
      options: opts("A", "B"),
      correctId: "a",
    });
    expect(result.ok).toBe(true);
  });
});

describe("toPublicPayload — the anti-cheat boundary", () => {
  it("strips the correct answer from multiple choice", () => {
    const payload: QuestionPayload = {
      type: "MULTIPLE_CHOICE",
      options: opts("A", "B"),
      correctId: "a",
    };
    const view = toPublicPayload(payload, { shuffleAnswers: false, seed: "x" });

    expect(JSON.stringify(view)).not.toContain("correctId");
    expect(view).not.toHaveProperty("correctId");
  });

  it("reveals nothing at all for true/false", () => {
    const payload: QuestionPayload = { type: "TRUE_FALSE", correct: true };
    const view = toPublicPayload(payload, { shuffleAnswers: false, seed: "x" });
    expect(view).toEqual({ type: "TRUE_FALSE" });
  });

  it("does not leak accepted answers for type-answer", () => {
    const payload: QuestionPayload = {
      type: "TYPE_ANSWER",
      accepted: ["Paris"],
      caseSensitive: false,
      typoTolerance: 1,
    };
    const view = toPublicPayload(payload, { shuffleAnswers: false, seed: "x" });
    expect(JSON.stringify(view)).not.toContain("Paris");
  });

  it("always shuffles ordering items away from the correct sequence", () => {
    // Presenting them in order would hand the answer to anyone who just
    // submits without touching anything.
    const payload: QuestionPayload = {
      type: "ORDERING",
      items: opts("1", "2", "3", "4", "5", "6"),
      correctOrder: ["a", "b", "c", "d", "e", "f"],
      partialCredit: true,
    };
    const view = toPublicPayload(payload, { shuffleAnswers: false, seed: "seed-1" });

    expect(view.type).toBe("ORDERING");
    if (view.type === "ORDERING") {
      expect(view.items.map((i) => i.id)).not.toEqual(payload.correctOrder);
    }
  });

  it("detaches matching right-hand values from their ids", () => {
    const payload: QuestionPayload = {
      type: "MATCHING",
      pairs: [
        { id: "a", left: "France", right: "Paris" },
        { id: "b", left: "Japan", right: "Tokyo" },
      ],
      partialCredit: true,
    };
    const view = toPublicPayload(payload, { shuffleAnswers: true, seed: "x" });

    expect(view.type).toBe("MATCHING");
    if (view.type === "MATCHING") {
      // Lefts carry ids, rights are a bare list — the pairing isn't derivable.
      expect(view.rights).toHaveLength(2);
      expect(view.lefts.every((l) => !("right" in l))).toBe(true);
    }
  });

  it("is deterministic for the same seed", () => {
    // Host and players must shuffle identically, or the reveal highlights the
    // wrong tile on one of the two screens.
    const payload: QuestionPayload = {
      type: "MULTIPLE_CHOICE",
      options: opts("A", "B", "C", "D"),
      correctId: "a",
    };
    const a = toPublicPayload(payload, { shuffleAnswers: true, seed: "q-42" });
    const b = toPublicPayload(payload, { shuffleAnswers: true, seed: "q-42" });
    expect(a).toEqual(b);
  });
});
