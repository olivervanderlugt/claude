import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  grade,
  toPublicPayload,
  describeCorrectAnswer,
  responseSchema,
  type QuestionPayload,
  type PlayerResponse,
} from "@/lib/question-schema";
import { scoreAnswer, rank, type QuizSettings } from "@/lib/scoring";
import type { Presentation, Theme } from "@/lib/theme";
import type {
  AnswerDistribution,
  GamePhase,
  PublicPlayer,
  RankedPlayer,
} from "@/types/realtime";

/**
 * The live game state machine.
 *
 * Deliberately holds no reference to Socket.IO — it talks to an injected
 * `RoomEmitter`. That keeps the rules (timing, scoring, phase transitions,
 * who may see what) testable without standing up a server, and it means the
 * transport could be swapped for SSE later without touching this file.
 *
 * Everything that matters is server-authoritative:
 *
 *   • The clock. Question start and end are stamped from the server's clock.
 *     A client's self-reported response time is never read — we compute elapsed
 *     time from our own timestamps, so a tampered client can't claim it answered
 *     in 3ms.
 *   • The answers. Correct answers live only here and in Postgres. Players are
 *     sent `PublicPayload`, which has them stripped out.
 *   • The grading. Clients submit a raw response; the server grades it.
 *
 * State lives in memory, backed by writes to Postgres for durability of the
 * results. A single instance is the supported deployment; see
 * docs/DEPLOYMENT.md for what changes when you run several.
 */

export interface SnapshotQuestion {
  id: string;
  type: string;
  prompt: string;
  payload: QuestionPayload;
  presentation: Presentation;
  timeLimitSec: number;
  points: number;
  explanation: string | null;
  authorName: string | null;
}

export interface GameSnapshot {
  quizId: string;
  title: string;
  theme: Theme;
  settings: QuizSettings;
  questions: SnapshotQuestion[];
  /** True for blind group quizzes — drives the reveal-author behaviour. */
  isCollab: boolean;
}

interface PlayerState {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  bestStreak: number;
  connected: boolean;
  /** Bearer token for reconnecting — lets a refreshed tab rejoin as itself. */
  token: string;
  lastPlace: number;
}

interface AnswerRecord {
  response: PlayerResponse;
  correct: boolean;
  points: number;
  responseMs: number;
}

export interface RoomEmitter {
  toHost(event: string, payload?: unknown): void;
  toPlayer(playerId: string, event: string, payload?: unknown): void;
  toAll(event: string, payload?: unknown): void;
}

/** Small helper so a timer is never left dangling on a phase change. */
class Timers {
  private handles = new Set<NodeJS.Timeout>();

  after(ms: number, fn: () => void): NodeJS.Timeout {
    const handle = setTimeout(() => {
      this.handles.delete(handle);
      fn();
    }, ms);
    this.handles.add(handle);
    return handle;
  }

  every(ms: number, fn: () => void): NodeJS.Timeout {
    const handle = setInterval(fn, ms);
    this.handles.add(handle);
    return handle;
  }

  clearAll(): void {
    for (const handle of this.handles) {
      clearTimeout(handle);
      clearInterval(handle);
    }
    this.handles.clear();
  }
}

export class GameRoom {
  phase: GamePhase = "lobby";
  currentIndex = -1;

  private players = new Map<string, PlayerState>();
  private answers = new Map<number, Map<string, AnswerRecord>>();
  private questionStartedAt = 0;
  private questionEndsAt = 0;
  private timers = new Timers();
  private ended = false;

  constructor(
    readonly gameId: string,
    readonly pin: string,
    readonly hostUserId: string,
    readonly snapshot: GameSnapshot,
    private emitter: RoomEmitter,
    /** Called when the room should be dropped from the registry. */
    private onDispose: (gameId: string) => void,
  ) {}

  // ─────────────────────────────── Lobby ────────────────────────────────────

  get playerCount(): number {
    return this.players.size;
  }

  get totalQuestions(): number {
    return this.snapshot.questions.length;
  }

  publicPlayers(): PublicPlayer[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      streak: p.streak,
      connected: p.connected,
    }));
  }

  stateMessage() {
    return {
      phase: this.phase,
      pin: this.pin,
      quizTitle: this.snapshot.title,
      theme: this.snapshot.theme,
      currentIndex: this.currentIndex,
      totalQuestions: this.totalQuestions,
      playerCount: this.playerCount,
    };
  }

  async addPlayer(
    nickname: string,
  ): Promise<{ ok: true; playerId: string; token: string } | { ok: false; error: string }> {
    if (this.ended) return { ok: false, error: "This game has finished." };

    if (this.phase !== "lobby" && !this.snapshot.settings.allowLateJoin) {
      return { ok: false, error: "This game has already started." };
    }
    if (this.players.size >= env.MAX_PLAYERS_PER_GAME) {
      return { ok: false, error: "This game is full." };
    }

    const clean = nickname.trim().slice(0, 20);
    if (clean.length < 1) return { ok: false, error: "Pick a nickname." };

    // Nicknames must be unique within a game, so the leaderboard is readable
    // and the host can tell players apart when kicking someone.
    const taken = [...this.players.values()].some(
      (p) => p.nickname.toLowerCase() === clean.toLowerCase(),
    );
    if (taken) return { ok: false, error: "Someone already has that nickname." };

    let player;
    try {
      player = await db.player.create({
        data: { gameId: this.gameId, nickname: clean },
        select: { id: true },
      });
    } catch {
      return { ok: false, error: "Someone already has that nickname." };
    }

    const token = randomBytes(24).toString("base64url");
    this.players.set(player.id, {
      id: player.id,
      nickname: clean,
      score: 0,
      streak: 0,
      bestStreak: 0,
      connected: true,
      token,
      lastPlace: 0,
    });

    this.broadcastLobby();
    return { ok: true, playerId: player.id, token };
  }

  /** Validate a reconnecting player's token. */
  resumePlayer(playerId: string, token: string): boolean {
    const player = this.players.get(playerId);
    if (!player || player.token !== token) return false;

    player.connected = true;
    this.broadcastLobby();
    return true;
  }

  markDisconnected(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // Don't remove them — a player who drops mid-question keeps their score and
    // can rejoin. Dropping them would lose the round for someone whose train
    // went through a tunnel.
    player.connected = false;
    this.broadcastLobby();
  }

  async kickPlayer(playerId: string): Promise<boolean> {
    const player = this.players.get(playerId);
    if (!player) return false;

    this.players.delete(playerId);
    await db.player
      .update({ where: { id: playerId }, data: { kicked: true } })
      .catch(() => {});

    this.emitter.toPlayer(playerId, "player:kicked", {
      reason: "The host removed you from this game.",
    });
    this.broadcastLobby();
    return true;
  }

  private broadcastLobby(): void {
    this.emitter.toHost("lobby:players", this.publicPlayers());
    this.emitter.toAll("game:state", this.stateMessage());
  }

  // ────────────────────────────── Question flow ─────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.phase !== "lobby") return { ok: false, error: "The game already started." };
    if (this.players.size === 0)
      return { ok: false, error: "Wait for at least one player to join." };
    if (this.totalQuestions === 0)
      return { ok: false, error: "This quiz has no questions." };

    await db.game.update({
      where: { id: this.gameId },
      data: { status: "QUESTION", startedAt: new Date() },
    });

    await this.advance();
    return { ok: true };
  }

  /** Move to the next question, or end the game if that was the last one. */
  async advance(): Promise<{ ok: boolean; error?: string }> {
    this.timers.clearAll();

    const nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.totalQuestions) {
      await this.end();
      return { ok: true };
    }

    this.currentIndex = nextIndex;
    this.phase = "countdown";
    this.emitter.toAll("game:state", this.stateMessage());

    const countdown = this.snapshot.settings.countdownSeconds;
    if (countdown > 0) {
      this.emitter.toAll("game:countdown", { seconds: countdown, index: nextIndex });
      this.timers.after(countdown * 1000, () => void this.showQuestion());
    } else {
      await this.showQuestion();
    }

    return { ok: true };
  }

  private async showQuestion(): Promise<void> {
    const question = this.snapshot.questions[this.currentIndex];
    if (!question) return;

    this.phase = "question";
    this.questionStartedAt = Date.now();
    this.questionEndsAt = this.questionStartedAt + question.timeLimitSec * 1000;
    this.answers.set(this.currentIndex, new Map());

    // For a blind group quiz this is the moment the question stops being
    // private. Stamping it here — as the question actually goes on screen — is
    // what makes the guarantee true rather than aspirational.
    if (this.snapshot.isCollab) {
      await db.question
        .updateMany({
          where: { id: question.id, revealedAt: null },
          data: { revealedAt: new Date() },
        })
        .catch(() => {});
    }

    await db.game
      .update({
        where: { id: this.gameId },
        data: { status: "QUESTION", currentIndex: this.currentIndex },
      })
      .catch(() => {});

    const base = {
      index: this.currentIndex,
      total: this.totalQuestions,
      type: question.type,
      prompt: question.prompt,
      payload: toPublicPayload(question.payload, {
        shuffleAnswers: this.snapshot.settings.shuffleAnswers,
        seed: question.id,
      }),
      presentation: question.presentation,
      timeLimitSec: question.timeLimitSec,
      points: question.points,
      endsAt: this.questionEndsAt,
      serverNow: Date.now(),
    };

    // Players get the answer-stripped view; only the host screen gets the
    // correct answer, because it needs to display it on reveal.
    this.emitter.toAll("question:show", base);
    this.emitter.toHost("question:showHost", {
      ...base,
      correctAnswerText: describeCorrectAnswer(question.payload),
      authorName: question.authorName,
    });
    this.emitter.toAll("game:state", this.stateMessage());

    this.timers.after(question.timeLimitSec * 1000, () => void this.lock());
  }

  /** Stop accepting answers and show the result. */
  async lock(): Promise<{ ok: boolean; error?: string }> {
    if (this.phase !== "question") return { ok: false, error: "No question is running." };

    this.timers.clearAll();
    this.phase = "locked";
    this.emitter.toAll("question:locked");

    await this.reveal();
    return { ok: true };
  }

  private async reveal(): Promise<void> {
    const question = this.snapshot.questions[this.currentIndex];
    if (!question) return;

    this.phase = "reveal";

    const submitted = this.answers.get(this.currentIndex) ?? new Map();

    // Anyone who didn't answer is recorded as a timeout, so the results export
    // distinguishes "got it wrong" from "never answered".
    for (const player of this.players.values()) {
      if (!submitted.has(player.id)) {
        await this.recordAnswer(player, { kind: "timeout" }, question.timeLimitSec * 1000);
      }
    }

    const distribution = this.buildDistribution(question);

    this.emitter.toAll("question:reveal", {
      index: this.currentIndex,
      correctAnswerText: describeCorrectAnswer(question.payload),
      explanation: question.explanation,
      // Credit the author on the reveal — the payoff moment of a group quiz.
      authorName: question.authorName,
      distribution,
      correctIds: correctIdsOf(question.payload),
    });

    // Each player gets their own outcome privately.
    const ranked = rank(
      [...this.players.values()].map((p) => ({ ...p, score: p.score })),
    );
    const placeById = new Map(ranked.map((r) => [r.id, r.place]));

    for (const player of this.players.values()) {
      const record = this.answers.get(this.currentIndex)?.get(player.id);
      this.emitter.toPlayer(player.id, "question:result", {
        correct: record?.correct ?? false,
        unscored: !isScored(question.payload),
        pointsAwarded: record?.points ?? 0,
        basePoints: record?.points ?? 0,
        streakPoints: 0,
        totalScore: player.score,
        streak: player.streak,
        place: placeById.get(player.id) ?? this.players.size,
        totalPlayers: this.players.size,
        correctAnswerText: describeCorrectAnswer(question.payload),
      });
    }

    await db.game
      .update({ where: { id: this.gameId }, data: { status: "REVEAL" } })
      .catch(() => {});

    if (this.snapshot.settings.showLeaderboard) {
      this.timers.after(3000, () => this.showScoreboard());
    }

    this.emitter.toAll("game:state", this.stateMessage());
  }

  private showScoreboard(): void {
    this.phase = "scoreboard";

    const ranked = rank(
      [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        streak: p.streak,
        connected: p.connected,
      })),
    );

    const withDelta: RankedPlayer[] = ranked.map((r) => {
      const previous = this.players.get(r.id)?.lastPlace ?? r.place;
      return { ...r, delta: previous === 0 ? 0 : previous - r.place };
    });

    // Record places so the next scoreboard can show movement.
    for (const r of ranked) {
      const player = this.players.get(r.id);
      if (player) player.lastPlace = r.place;
    }

    this.emitter.toAll("game:scoreboard", {
      players: withDelta.slice(0, this.snapshot.settings.leaderboardSize),
      index: this.currentIndex,
    });
    // The host sees everyone, not just the top N.
    this.emitter.toHost("game:scoreboard", {
      players: withDelta,
      index: this.currentIndex,
    });
    this.emitter.toAll("game:state", this.stateMessage());
  }

  // ─────────────────────────────── Answering ────────────────────────────────

  async submitAnswer(
    playerId: string,
    index: number,
    rawResponse: unknown,
  ): Promise<{ ok: boolean; error?: string }> {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: "You're not in this game." };

    if (this.phase !== "question")
      return { ok: false, error: "Answers are closed." };

    // Guards against a late packet for a previous question landing after the
    // next one has started and being scored against the wrong question.
    if (index !== this.currentIndex)
      return { ok: false, error: "That question has moved on." };

    const now = Date.now();
    if (now > this.questionEndsAt + 500)
      return { ok: false, error: "Time's up." };

    const bucket = this.answers.get(this.currentIndex);
    if (!bucket) return { ok: false, error: "No question is running." };
    if (bucket.has(playerId))
      return { ok: false, error: "You've already answered." };

    const parsed = responseSchema.safeParse(rawResponse);
    if (!parsed.success) return { ok: false, error: "That answer isn't valid." };

    const question = this.snapshot.questions[this.currentIndex]!;

    // The server's own elapsed time — the client is never asked how long it took.
    const responseMs = Math.max(0, now - this.questionStartedAt);

    await this.recordAnswer(player, parsed.data, responseMs);

    this.emitter.toHost("question:progress", {
      answered: bucket.size,
      total: this.players.size,
    });

    // Everyone's in — no reason to make the room watch an empty timer.
    if (bucket.size >= this.players.size) {
      this.timers.after(400, () => void this.lock());
    }

    return { ok: true };
  }

  private async recordAnswer(
    player: PlayerState,
    response: PlayerResponse,
    responseMs: number,
  ): Promise<void> {
    const question = this.snapshot.questions[this.currentIndex];
    if (!question) return;

    const bucket = this.answers.get(this.currentIndex);
    if (!bucket || bucket.has(player.id)) return;

    const result = grade(question.payload, response);
    const scored = scoreAnswer({
      grade: result,
      points: question.points,
      timeLimitMs: question.timeLimitSec * 1000,
      responseMs,
      currentStreak: player.streak,
      settings: this.snapshot.settings.scoring,
    });

    player.score += scored.points;
    player.streak = scored.newStreak;
    player.bestStreak = Math.max(player.bestStreak, scored.newStreak);

    bucket.set(player.id, {
      response,
      correct: result.correct,
      points: scored.points,
      responseMs,
    });

    // Persisted best-effort. The unique constraint on
    // (gameId, playerId, questionIndex) is the real backstop against a
    // double-submit slipping through a race in the in-memory check.
    await Promise.all([
      db.answer
        .create({
          data: {
            gameId: this.gameId,
            playerId: player.id,
            questionIndex: this.currentIndex,
            response: response as unknown as object,
            correct: result.correct,
            pointsAwarded: scored.points,
            responseMs,
          },
        })
        .catch(() => {}),
      db.player
        .update({
          where: { id: player.id },
          data: {
            score: player.score,
            streak: player.streak,
            bestStreak: player.bestStreak,
          },
        })
        .catch(() => {}),
    ]);
  }

  private buildDistribution(question: SnapshotQuestion): AnswerDistribution {
    const bucket = this.answers.get(this.currentIndex) ?? new Map();
    const counts: Record<string, number> = {};
    const wordTally = new Map<string, number>();

    for (const record of bucket.values()) {
      const r = record.response;
      switch (r.kind) {
        case "choice":
          counts[r.optionId] = (counts[r.optionId] ?? 0) + 1;
          break;
        case "multi":
          for (const id of r.optionIds) counts[id] = (counts[id] ?? 0) + 1;
          break;
        case "boolean": {
          const key = r.value ? "true" : "false";
          counts[key] = (counts[key] ?? 0) + 1;
          break;
        }
        case "words":
          for (const word of r.words) {
            const key = word.trim().toLowerCase();
            if (key) wordTally.set(key, (wordTally.get(key) ?? 0) + 1);
          }
          break;
        case "text": {
          const key = r.text.trim().toLowerCase();
          if (key) wordTally.set(key, (wordTally.get(key) ?? 0) + 1);
          break;
        }
        default:
          break;
      }
    }

    const words =
      wordTally.size > 0
        ? [...wordTally.entries()]
            .map(([word, count]) => ({ word, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 40)
        : undefined;

    return {
      counts,
      words,
      totalAnswers: bucket.size,
      totalPlayers: this.players.size,
    };
  }

  // ──────────────────────────────── Ending ──────────────────────────────────

  async end(): Promise<{ ok: boolean; error?: string }> {
    if (this.ended) return { ok: true };

    this.ended = true;
    this.timers.clearAll();
    this.phase = "ended";

    const ranked = rank(
      [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        streak: p.bestStreak,
        connected: p.connected,
      })),
    ).map((r) => ({ ...r, delta: 0 }));

    this.emitter.toAll("game:over", {
      podium: ranked.slice(0, 5),
      totalQuestions: this.totalQuestions,
      totalPlayers: this.players.size,
    });
    this.emitter.toHost("game:over", {
      podium: ranked,
      totalQuestions: this.totalQuestions,
      totalPlayers: this.players.size,
    });

    await db.game
      .update({
        where: { id: this.gameId },
        data: { status: "ENDED", endedAt: new Date() },
      })
      .catch(() => {});

    this.emitter.toAll("game:state", this.stateMessage());

    // Keep the room alive briefly so a slow client still receives the podium,
    // then let it be garbage collected.
    this.timers.after(60_000, () => {
      this.timers.clearAll();
      this.onDispose(this.gameId);
    });

    return { ok: true };
  }

  dispose(): void {
    this.timers.clearAll();
  }
}

function isScored(payload: QuestionPayload): boolean {
  return payload.type !== "POLL" && payload.type !== "WORD_CLOUD";
}

function correctIdsOf(payload: QuestionPayload): string[] {
  switch (payload.type) {
    case "MULTIPLE_CHOICE":
      return [payload.correctId];
    case "MULTIPLE_SELECT":
      return payload.correctIds;
    case "TRUE_FALSE":
      return [payload.correct ? "true" : "false"];
    default:
      return [];
  }
}
