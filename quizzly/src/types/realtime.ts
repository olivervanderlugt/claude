import type { PublicPayload, PlayerResponse } from "@/lib/question-schema";
import type { Presentation, Theme } from "@/lib/theme";

/**
 * The wire contract between browser and server.
 *
 * Both the Socket.IO server and every client import these, so a change to an
 * event shape is a compile error on both sides rather than a runtime surprise
 * in front of a room full of players.
 */

export type GamePhase =
  | "lobby"
  | "countdown"
  | "question"
  | "locked"
  | "reveal"
  | "scoreboard"
  | "ended";

export interface PublicPlayer {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  connected: boolean;
}

export interface RankedPlayer extends PublicPlayer {
  place: number;
  /** Change in place since the previous question — drives the ▲▼ indicator. */
  delta: number;
}

/** A question as a *player* sees it while answering: no answers included. */
export interface PlayerQuestionView {
  index: number;
  total: number;
  type: string;
  prompt: string;
  payload: PublicPayload;
  presentation: Presentation;
  timeLimitSec: number;
  points: number;
  /** Server clock at which answers stop being accepted. */
  endsAt: number;
  /** Server clock now, so clients can correct for their own drift. */
  serverNow: number;
}

/** The host screen additionally gets the correct answer, to show on reveal. */
export interface HostQuestionView extends PlayerQuestionView {
  correctAnswerText: string;
  authorName: string | null;
}

export interface AnswerDistribution {
  /** Option id (or bucket label) → how many players chose it. */
  counts: Record<string, number>;
  /** Free-text answers for word clouds, already lowercased and tallied. */
  words?: Array<{ word: string; count: number }>;
  totalAnswers: number;
  totalPlayers: number;
}

export interface RevealPayload {
  index: number;
  correctAnswerText: string;
  explanation: string | null;
  authorName: string | null;
  distribution: AnswerDistribution;
  /** Which option ids were correct, so the UI can highlight them. */
  correctIds: string[];
}

export interface PersonalResult {
  correct: boolean;
  unscored: boolean;
  pointsAwarded: number;
  basePoints: number;
  streakPoints: number;
  totalScore: number;
  streak: number;
  place: number;
  totalPlayers: number;
  correctAnswerText: string;
}

export interface GameOverPayload {
  podium: RankedPlayer[];
  totalQuestions: number;
  totalPlayers: number;
}

// ────────────────────────── Server → client events ──────────────────────────

export interface ServerToClientEvents {
  /** Sent on connect and after any state change, so a reconnecting client
   *  can restore itself from one message. */
  "game:state": (state: {
    phase: GamePhase;
    pin: string;
    quizTitle: string;
    theme: Theme;
    currentIndex: number;
    totalQuestions: number;
    playerCount: number;
  }) => void;

  "lobby:players": (players: PublicPlayer[]) => void;

  "game:countdown": (payload: { seconds: number; index: number }) => void;

  "question:show": (view: PlayerQuestionView) => void;
  "question:showHost": (view: HostQuestionView) => void;

  /** Live tally while the question runs — count only, never which answers. */
  "question:progress": (payload: { answered: number; total: number }) => void;

  "question:locked": () => void;

  "question:reveal": (payload: RevealPayload) => void;
  "question:result": (payload: PersonalResult) => void;

  "game:scoreboard": (payload: { players: RankedPlayer[]; index: number }) => void;

  "game:over": (payload: GameOverPayload) => void;

  /** This player was removed by the host. */
  "player:kicked": (payload: { reason: string }) => void;

  "error": (payload: { code: string; message: string }) => void;
}

// ────────────────────────── Client → server events ──────────────────────────

export interface ClientToServerEvents {
  "host:attach": (
    payload: { gameId: string },
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  "host:start": (ack: (result: { ok: boolean; error?: string }) => void) => void;
  "host:next": (ack: (result: { ok: boolean; error?: string }) => void) => void;
  "host:lock": (ack: (result: { ok: boolean; error?: string }) => void) => void;
  "host:kick": (
    payload: { playerId: string },
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  "host:end": (ack: (result: { ok: boolean; error?: string }) => void) => void;

  "player:join": (
    payload: { pin: string; nickname: string },
    ack: (
      result:
        | { ok: true; playerId: string; token: string }
        | { ok: false; error: string },
    ) => void,
  ) => void;

  /** Reconnect after a dropped connection or a page refresh. */
  "player:resume": (
    payload: { pin: string; playerId: string; token: string },
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;

  "player:answer": (
    payload: { index: number; response: PlayerResponse },
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;
}
