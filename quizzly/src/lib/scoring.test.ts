import { describe, expect, it } from "vitest";

import { DEFAULT_SCORING, rank, scoreAnswer } from "./scoring";
import type { GradeResult } from "./question-schema";

const CORRECT: GradeResult = { correct: true, ratio: 1, unscored: false };
const WRONG: GradeResult = { correct: false, ratio: 0, unscored: false };
const PARTIAL: GradeResult = { correct: false, ratio: 0.5, unscored: false };
const UNSCORED: GradeResult = { correct: true, ratio: 0, unscored: true };

const base = {
  points: 1000,
  timeLimitMs: 20_000,
  currentStreak: 0,
  settings: DEFAULT_SCORING,
};

describe("scoreAnswer", () => {
  it("awards full points for an instant correct answer", () => {
    const result = scoreAnswer({ ...base, grade: CORRECT, responseMs: 0 });
    expect(result.points).toBe(1000);
  });

  it("awards the floor fraction for a correct answer at the buzzer", () => {
    const result = scoreAnswer({ ...base, grade: CORRECT, responseMs: 20_000 });
    // Slow but correct still earns half — being slow must never mean zero, or
    // players give up as soon as they hesitate.
    expect(result.points).toBe(500);
  });

  it("scales linearly between the two", () => {
    const result = scoreAnswer({ ...base, grade: CORRECT, responseMs: 10_000 });
    expect(result.points).toBe(750);
  });

  it("gives zero for a wrong answer however fast", () => {
    const result = scoreAnswer({ ...base, grade: WRONG, responseMs: 0 });
    expect(result.points).toBe(0);
  });

  it("resets the streak on a wrong answer", () => {
    const result = scoreAnswer({
      ...base,
      grade: WRONG,
      responseMs: 1000,
      currentStreak: 7,
    });
    expect(result.newStreak).toBe(0);
  });

  it("awards partial credit proportionally", () => {
    const result = scoreAnswer({ ...base, grade: PARTIAL, responseMs: 0 });
    expect(result.points).toBe(500);
  });

  it("does not extend a streak on a partially correct answer", () => {
    // A half-right ordering answer shouldn't keep a "perfect run" alive.
    const result = scoreAnswer({
      ...base,
      grade: PARTIAL,
      responseMs: 0,
      currentStreak: 3,
    });
    expect(result.newStreak).toBe(0);
  });

  it("adds a streak bonus that grows with the run", () => {
    const second = scoreAnswer({ ...base, grade: CORRECT, responseMs: 0, currentStreak: 1 });
    const third = scoreAnswer({ ...base, grade: CORRECT, responseMs: 0, currentStreak: 2 });

    expect(second.streakPoints).toBe(100);
    expect(third.streakPoints).toBe(200);
  });

  it("caps the streak bonus", () => {
    const result = scoreAnswer({
      ...base,
      grade: CORRECT,
      responseMs: 0,
      currentStreak: 50,
    });
    // Capped at 5 × 100 — an early leader shouldn't become uncatchable.
    expect(result.streakPoints).toBe(500);
  });

  it("gives no points for polls and word clouds", () => {
    const result = scoreAnswer({ ...base, grade: UNSCORED, responseMs: 0 });
    expect(result.points).toBe(0);
  });

  it("preserves the streak through an unscored question", () => {
    // A poll in the middle of a round shouldn't break someone's run.
    const result = scoreAnswer({
      ...base,
      grade: UNSCORED,
      responseMs: 0,
      currentStreak: 4,
    });
    expect(result.newStreak).toBe(4);
  });

  it("clamps a negative response time", () => {
    // A client with a skewed clock must not be able to mint extra points.
    const result = scoreAnswer({ ...base, grade: CORRECT, responseMs: -50_000 });
    expect(result.points).toBe(1000);
  });

  it("clamps a response time beyond the limit", () => {
    const result = scoreAnswer({ ...base, grade: CORRECT, responseMs: 999_999 });
    expect(result.points).toBe(500);
  });

  it("honours speedBonus: false", () => {
    const result = scoreAnswer({
      ...base,
      grade: CORRECT,
      responseMs: 20_000,
      settings: { ...DEFAULT_SCORING, speedBonus: false },
    });
    expect(result.points).toBe(1000);
  });
});

describe("rank", () => {
  it("orders by score descending", () => {
    const result = rank([
      { id: "a", score: 100 },
      { id: "b", score: 300 },
      { id: "c", score: 200 },
    ]);
    expect(result.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("gives tied players the same place and skips the next", () => {
    // Standard competition ranking: 1, 2, 2, 4 — not 1, 2, 2, 3.
    const result = rank([
      { id: "a", score: 300 },
      { id: "b", score: 200 },
      { id: "c", score: 200 },
      { id: "d", score: 100 },
    ]);
    expect(result.map((r) => r.place)).toEqual([1, 2, 2, 4]);
  });

  it("handles an empty list", () => {
    expect(rank([])).toEqual([]);
  });
});
