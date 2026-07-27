"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayerResponse } from "@/lib/question-schema";
import {
  DEFAULT_THEME,
  themeToCssVars,
  type Theme,
} from "@/lib/theme";
import {
  getSocket,
  loadIdentity,
  saveIdentity,
  clearIdentity,
} from "@/lib/socket-client";
import type {
  GamePhase,
  PersonalResult,
  PlayerQuestionView,
  RankedPlayer,
} from "@/types/realtime";
import { AnswerInput } from "./AnswerInput";
import { QuestionFrame } from "./QuestionFrame";
import { Countdown } from "./Countdown";

/**
 * The player's whole game, in one component.
 *
 * The state machine mirrors the server's phases rather than inventing its own.
 * Every transition is driven by a server event, and `game:state` carries enough
 * to rebuild the screen from scratch — which is what makes reconnecting work:
 * a player whose phone slept through two questions gets the current state on
 * reconnect, not a broken screen.
 */

type Screen =
  | { kind: "nickname" }
  | { kind: "lobby" }
  | { kind: "countdown"; seconds: number }
  | { kind: "question"; view: PlayerQuestionView }
  | { kind: "waiting" }
  | { kind: "result"; result: PersonalResult }
  | { kind: "scoreboard"; players: RankedPlayer[] }
  | { kind: "over"; podium: RankedPlayer[] }
  | { kind: "kicked"; reason: string };

export function PlayClient({ pin }: { pin: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: "nickname" });
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [joining, setJoining] = useState(false);

  const submittedRef = useRef<PlayerResponse | null>(null);
  const [submitted, setSubmitted] = useState<PlayerResponse | null>(null);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);

      // Resume silently if this tab already has an identity for this game —
      // a refresh or a dropped connection shouldn't cost you your score.
      const stored = loadIdentity(pin);
      if (stored) {
        socket.emit(
          "player:resume",
          { pin, playerId: stored.playerId, token: stored.token },
          (result) => {
            if (result.ok) {
              setNickname(stored.nickname);
              setScreen((prev) => (prev.kind === "nickname" ? { kind: "lobby" } : prev));
            } else {
              // The game moved on or the token is stale — start over cleanly.
              clearIdentity(pin);
            }
          },
        );
      }
    };

    const onDisconnect = () => setConnected(false);

    const onState = (state: {
      phase: GamePhase;
      theme: Theme;
    }) => {
      setTheme(state.theme);

      // Only follow phases that make sense for a player who has already joined.
      setScreen((prev) => {
        if (prev.kind === "nickname" || prev.kind === "kicked") return prev;
        if (state.phase === "lobby") return { kind: "lobby" };
        return prev;
      });
    };

    const onCountdown = ({ seconds }: { seconds: number }) => {
      submittedRef.current = null;
      setSubmitted(null);
      setScreen((prev) =>
        prev.kind === "nickname" ? prev : { kind: "countdown", seconds },
      );
    };

    const onQuestion = (view: PlayerQuestionView) => {
      submittedRef.current = null;
      setSubmitted(null);
      setScreen((prev) => (prev.kind === "nickname" ? prev : { kind: "question", view }));
    };

    const onLocked = () =>
      setScreen((prev) =>
        prev.kind === "question" || prev.kind === "waiting" ? { kind: "waiting" } : prev,
      );

    const onResult = (result: PersonalResult) =>
      setScreen((prev) => (prev.kind === "nickname" ? prev : { kind: "result", result }));

    const onScoreboard = ({ players }: { players: RankedPlayer[] }) =>
      setScreen((prev) =>
        prev.kind === "nickname" ? prev : { kind: "scoreboard", players },
      );

    const onOver = ({ podium }: { podium: RankedPlayer[] }) => {
      clearIdentity(pin);
      setScreen({ kind: "over", podium });
    };

    const onKicked = ({ reason }: { reason: string }) => {
      clearIdentity(pin);
      setScreen({ kind: "kicked", reason });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("game:state", onState);
    socket.on("game:countdown", onCountdown);
    socket.on("question:show", onQuestion);
    socket.on("question:locked", onLocked);
    socket.on("question:result", onResult);
    socket.on("game:scoreboard", onScoreboard);
    socket.on("game:over", onOver);
    socket.on("player:kicked", onKicked);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("game:state", onState);
      socket.off("game:countdown", onCountdown);
      socket.off("question:show", onQuestion);
      socket.off("question:locked", onLocked);
      socket.off("question:result", onResult);
      socket.off("game:scoreboard", onScoreboard);
      socket.off("game:over", onOver);
      socket.off("player:kicked", onKicked);
    };
  }, [pin]);

  const join = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const clean = nickname.trim();
      if (!clean) return;

      setJoining(true);
      setError(null);

      getSocket().emit("player:join", { pin, nickname: clean }, (result) => {
        setJoining(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        saveIdentity(pin, {
          playerId: result.playerId,
          token: result.token,
          nickname: clean,
        });
        setScreen({ kind: "lobby" });
      });
    },
    [nickname, pin],
  );

  const answer = useCallback(
    (response: PlayerResponse) => {
      if (submittedRef.current) return;
      if (screen.kind !== "question") return;

      // Optimistically lock the UI. The server is the authority on whether it
      // counted, but making the player wait for a round trip before the buttons
      // respond feels broken on a slow connection.
      submittedRef.current = response;
      setSubmitted(response);

      getSocket().emit(
        "player:answer",
        { index: screen.view.index, response },
        (result) => {
          if (!result.ok) {
            submittedRef.current = null;
            setSubmitted(null);
            setError(result.error ?? "That didn't go through.");
          }
        },
      );
    },
    [screen],
  );

  const style = themeToCssVars(theme);

  return (
    <div className="quiz-surface flex flex-col" style={style}>
      <ConnectionBanner connected={connected} />

      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {screen.kind === "nickname" ? (
          <NicknameScreen
            pin={pin}
            nickname={nickname}
            setNickname={setNickname}
            onSubmit={join}
            busy={joining}
            error={error}
          />
        ) : null}

        {screen.kind === "lobby" ? (
          <div className="quiz-card animate-pop-in p-8 text-center">
            <p className="text-sm uppercase tracking-widest opacity-60">
              You&apos;re in
            </p>
            <p className="quiz-display mt-2 text-4xl font-extrabold">{nickname}</p>
            <p className="mt-6 opacity-70">
              Look up at the shared screen — the game starts soon.
            </p>
            <div className="mt-6 flex justify-center gap-1.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-2.5 w-2.5 rounded-full animate-pulse-soft"
                  style={{
                    background: "var(--q-accent)",
                    animationDelay: `${i * 200}ms`,
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {screen.kind === "countdown" ? <Countdown seconds={screen.seconds} /> : null}

        {screen.kind === "question" ? (
          <QuestionFrame view={screen.view}>
            <AnswerInput
              payload={screen.view.payload}
              disabled={submitted !== null}
              submitted={submitted}
              onAnswer={answer}
            />
            {submitted ? (
              <p className="mt-5 text-center text-sm opacity-70">
                Answer locked in. Sit tight.
              </p>
            ) : null}
          </QuestionFrame>
        ) : null}

        {screen.kind === "waiting" ? (
          <div className="quiz-card animate-pop-in p-10 text-center">
            <p className="quiz-display text-2xl font-bold">Time&apos;s up</p>
            <p className="mt-2 opacity-70">Counting the answers…</p>
          </div>
        ) : null}

        {screen.kind === "result" ? <ResultScreen result={screen.result} /> : null}

        {screen.kind === "scoreboard" ? (
          <Leaderboard players={screen.players} title="Standings" you={nickname} />
        ) : null}

        {screen.kind === "over" ? (
          <div>
            <h1 className="quiz-display mb-5 text-center text-3xl font-extrabold">
              Final results
            </h1>
            <Leaderboard players={screen.podium} title="" you={nickname} />
            <p className="mt-6 text-center text-sm opacity-60">
              Thanks for playing.
            </p>
          </div>
        ) : null}

        {screen.kind === "kicked" ? (
          <div className="quiz-card p-8 text-center">
            <p className="quiz-display text-2xl font-bold">Removed from the game</p>
            <p className="mt-2 opacity-70">{screen.reason}</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}

// ─────────────────────────────── Sub-screens ────────────────────────────────

function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null;

  return (
    <div
      role="status"
      className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      Reconnecting… your score is safe.
    </div>
  );
}

function NicknameScreen({
  pin,
  nickname,
  setNickname,
  onSubmit,
  busy,
  error,
}: {
  pin: string;
  nickname: string;
  setNickname: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="quiz-card animate-pop-in p-7">
      <p className="text-center text-sm uppercase tracking-widest opacity-60">
        Game PIN
      </p>
      <p className="numeric quiz-display mt-1 text-center text-3xl font-extrabold">
        {pin}
      </p>

      <form onSubmit={onSubmit} className="mt-7">
        <label className="app-label" htmlFor="nickname">
          Pick a nickname
        </label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 20))}
          maxLength={20}
          required
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Anything you like"
          className="app-input py-4 text-center text-xl"
          aria-describedby="nickname-privacy"
        />
        <p id="nickname-privacy" className="mt-2 text-xs opacity-60">
          This is the only thing we store about you, and it&apos;s deleted with
          the game.
        </p>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !nickname.trim()}
          className="btn btn-primary mt-4 w-full py-3.5 text-base"
        >
          {busy ? "Joining…" : "Join game"}
        </button>
      </form>
    </div>
  );
}

function ResultScreen({ result }: { result: PersonalResult }) {
  const background = result.unscored
    ? "var(--q-accent)"
    : result.correct
      ? "var(--q-correct)"
      : "var(--q-wrong)";

  return (
    <div
      className="animate-pop-in rounded-2xl p-8 text-center text-white"
      style={{ background }}
    >
      <p className="quiz-display text-3xl font-extrabold">
        {result.unscored
          ? "Answer received"
          : result.correct
            ? "Correct!"
            : "Not this time"}
      </p>

      {!result.correct && !result.unscored ? (
        <p className="mt-2 text-lg opacity-90">
          The answer was <strong>{result.correctAnswerText}</strong>
        </p>
      ) : null}

      {result.pointsAwarded > 0 ? (
        <p className="numeric mt-4 text-4xl font-extrabold">
          +{result.pointsAwarded}
        </p>
      ) : null}

      {result.streak > 1 ? (
        <p className="mt-2 text-sm font-medium opacity-90">
          🔥 {result.streak} in a row
        </p>
      ) : null}

      <div className="mt-6 flex justify-center gap-8 text-sm">
        <div>
          <p className="opacity-75">Score</p>
          <p className="numeric text-xl font-bold">{result.totalScore}</p>
        </div>
        <div>
          <p className="opacity-75">Place</p>
          <p className="numeric text-xl font-bold">
            {result.place}
            <span className="text-sm opacity-75">/{result.totalPlayers}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Leaderboard({
  players,
  title,
  you,
}: {
  players: RankedPlayer[];
  title: string;
  you: string;
}) {
  return (
    <div className="animate-pop-in">
      {title ? (
        <h2 className="quiz-display mb-4 text-center text-2xl font-bold">{title}</h2>
      ) : null}

      <ol className="space-y-2">
        {players.map((player) => {
          const isYou = player.nickname === you;
          return (
            <li
              key={player.id}
              className="quiz-card flex items-center gap-3 px-4 py-3"
              style={
                isYou
                  ? { outline: "2px solid var(--q-accent)", outlineOffset: "-2px" }
                  : undefined
              }
            >
              <span className="numeric w-8 text-center text-lg font-bold opacity-70">
                {player.place}
              </span>
              <span className="flex-1 truncate font-semibold">
                {player.nickname}
                {isYou ? <span className="ml-2 text-xs opacity-60">you</span> : null}
              </span>
              {player.delta !== 0 ? (
                <span
                  className="text-sm font-medium"
                  style={{
                    color: player.delta > 0 ? "var(--q-correct)" : "var(--q-wrong)",
                  }}
                  aria-label={
                    player.delta > 0
                      ? `Up ${player.delta} places`
                      : `Down ${-player.delta} places`
                  }
                >
                  {player.delta > 0 ? `▲${player.delta}` : `▼${-player.delta}`}
                </span>
              ) : null}
              <span className="numeric font-bold">{player.score}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
