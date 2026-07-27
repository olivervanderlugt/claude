import { z } from "zod";

import type { GradeResult } from "./question-schema";

/**
 * Scoring.
 *
 * Kept as a pure function with no I/O so it can be unit-tested exhaustively
 * (see server/realtime/scoring.test.ts) — scoring bugs are the kind players
 * notice immediately and trust you less for afterwards.
 *
 * The default curve is the familiar one from this genre: a correct answer is
 * worth between 50% and 100% of the question's points, scaled linearly by how
 * much of the clock was left. Answering instantly earns full points; answering
 * as the timer expires still earns half. Being slow is a disadvantage, never a
 * zero — otherwise the last few seconds of every question are worthless and
 * players stop trying.
 */

export const scoringSettingsSchema = z.object({
  /** Off = every correct answer is worth full points regardless of speed. */
  speedBonus: z.boolean().default(true),
  /**
   * The floor, as a fraction of full points, for a correct-but-slow answer.
   * 0.5 reproduces the classic curve. 1.0 disables speed scaling entirely.
   */
  slowestAnswerFraction: z.number().min(0).max(1).default(0.5),
  /** Flat bonus per question in a run of consecutive correct answers. */
  streakBonus: z.number().int().min(0).max(1000).default(100),
  /** Streak bonus stops growing past this many in a row. */
  streakCap: z.number().int().min(0).max(20).default(5),
  /** Halves everything a player earns — for a final "double or nothing" round, invert as needed. */
  multiplier: z.number().min(0.1).max(5).default(1),
});

export type ScoringSettings = z.infer<typeof scoringSettingsSchema>;

export const DEFAULT_SCORING: ScoringSettings = {
  speedBonus: true,
  slowestAnswerFraction: 0.5,
  streakBonus: 100,
  streakCap: 5,
  multiplier: 1,
};

export const quizSettingsSchema = z.object({
  scoring: scoringSettingsSchema.default(DEFAULT_SCORING),
  /** Shuffle question order at game start. */
  shuffleQuestions: z.boolean().default(false),
  /** Shuffle answer options within each question. */
  shuffleAnswers: z.boolean().default(true),
  /** Show the correct answer after each question. */
  showCorrectAnswer: z.boolean().default(true),
  /** Show the leaderboard between questions. */
  showLeaderboard: z.boolean().default(true),
  /** How many players appear on the between-question leaderboard. */
  leaderboardSize: z.number().int().min(3).max(20).default(5),
  /** Let players join after the game has started. */
  allowLateJoin: z.boolean().default(true),
  /** Seconds the host's "get ready" countdown runs before each question. */
  countdownSeconds: z.number().int().min(0).max(10).default(3),
});

export type QuizSettings = z.infer<typeof quizSettingsSchema>;

export const DEFAULT_SETTINGS: QuizSettings = quizSettingsSchema.parse({});

export interface ScoreInput {
  grade: GradeResult;
  /** Full value of the question. */
  points: number;
  /** How long the player had, in milliseconds. */
  timeLimitMs: number;
  /** How long they took, in milliseconds. */
  responseMs: number;
  /** Consecutive correct answers *before* this one. */
  currentStreak: number;
  settings: ScoringSettings;
}

export interface ScoreResult {
  points: number;
  /** The streak value to store after this answer. */
  newStreak: number;
  /** Broken out so the UI can show "+800 · +200 streak". */
  basePoints: number;
  streakPoints: number;
}

export function scoreAnswer(input: ScoreInput): ScoreResult {
  const { grade, points, timeLimitMs, responseMs, currentStreak, settings } = input;

  // Polls and word clouds are participation, not competition.
  if (grade.unscored) {
    return { points: 0, newStreak: currentStreak, basePoints: 0, streakPoints: 0 };
  }

  if (grade.ratio <= 0) {
    return { points: 0, newStreak: 0, basePoints: 0, streakPoints: 0 };
  }

  let speedFactor = 1;
  if (settings.speedBonus && timeLimitMs > 0) {
    // Clamp first: a clock-skewed client could otherwise report a negative or
    // absurdly large elapsed time and mint points out of nothing.
    const elapsed = Math.min(Math.max(responseMs, 0), timeLimitMs);
    const fractionUsed = elapsed / timeLimitMs;
    const floor = settings.slowestAnswerFraction;
    speedFactor = 1 - fractionUsed * (1 - floor);
  }

  const basePoints = Math.round(points * grade.ratio * speedFactor * settings.multiplier);

  // Only a fully correct answer extends a streak — a partially correct
  // ordering answer shouldn't quietly keep a "perfect run" alive.
  const extendsStreak = grade.correct;
  const newStreak = extendsStreak ? currentStreak + 1 : 0;

  let streakPoints = 0;
  if (extendsStreak && settings.streakBonus > 0 && currentStreak > 0) {
    const effectiveStreak = Math.min(currentStreak, settings.streakCap);
    streakPoints = Math.round(effectiveStreak * settings.streakBonus * settings.multiplier);
  }

  return {
    points: basePoints + streakPoints,
    newStreak,
    basePoints,
    streakPoints,
  };
}

/** Standard competition ranking — ties share a place, then the next place skips. */
export function rank<T extends { score: number }>(
  entries: T[],
): Array<T & { place: number }> {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const out: Array<T & { place: number }> = [];

  let place = 0;
  let lastScore: number | null = null;

  sorted.forEach((entry, index) => {
    if (lastScore === null || entry.score !== lastScore) {
      place = index + 1;
      lastScore = entry.score;
    }
    out.push({ ...entry, place });
  });

  return out;
}
