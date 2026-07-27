"use client";

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_THEME, themeToCssVars, type Theme } from "@/lib/theme";
import { getSocket } from "@/lib/socket-client";
import type {
  GamePhase,
  HostQuestionView,
  PublicPlayer,
  RankedPlayer,
  RevealPayload,
} from "@/types/realtime";

/**
 * The host / shared-screen view.
 *
 * Designed for a projector at the back of a room: large type, high contrast,
 * and no information the players' own devices already show them. It's also the
 * control surface — advancing questions, locking early, removing someone.
 */

type Stage =
  | { kind: "lobby" }
  | { kind: "countdown"; seconds: number }
  | { kind: "question"; view: HostQuestionView; answered: number }
  | { kind: "reveal"; view: HostQuestionView; reveal: RevealPayload }
  | { kind: "scoreboard"; players: RankedPlayer[] }
  | { kind: "over"; podium: RankedPlayer[] };

export function HostClient({
  gameId,
  pin,
  joinOrigin,
  alreadyEnded,
}: {
  gameId: string;
  pin: string;
  joinOrigin: string;
  alreadyEnded: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "lobby" });
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [phase, setPhase] = useState<GamePhase>("lobby");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attached, setAttached] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    // `host:attach` re-verifies the session cookie and game ownership on the
    // server. The page-level check above is not trusted by the socket layer.
    const attach = () => {
      socket.emit("host:attach", { gameId }, (result) => {
        if (!result.ok) setError(result.error ?? "Could not attach to this game.");
        else setAttached(true);
      });
    };

    const onState = (state: {
      phase: GamePhase;
      theme: Theme;
      quizTitle: string;
    }) => {
      setPhase(state.phase);
      setTheme(state.theme);
      setTitle(state.quizTitle);
      if (state.phase === "lobby") setStage({ kind: "lobby" });
    };

    const onPlayers = (list: PublicPlayer[]) => setPlayers(list);

    const onCountdown = ({ seconds }: { seconds: number }) =>
      setStage({ kind: "countdown", seconds });

    const onQuestion = (view: HostQuestionView) =>
      setStage({ kind: "question", view, answered: 0 });

    const onProgress = ({ answered }: { answered: number }) =>
      setStage((prev) =>
        prev.kind === "question" ? { ...prev, answered } : prev,
      );

    const onReveal = (reveal: RevealPayload) =>
      setStage((prev) =>
        prev.kind === "question"
          ? { kind: "reveal", view: prev.view, reveal }
          : prev,
      );

    const onScoreboard = ({ players: ranked }: { players: RankedPlayer[] }) =>
      setStage({ kind: "scoreboard", players: ranked });

    const onOver = ({ podium }: { podium: RankedPlayer[] }) =>
      setStage({ kind: "over", podium });

    socket.on("connect", attach);
    socket.on("game:state", onState);
    socket.on("lobby:players", onPlayers);
    socket.on("game:countdown", onCountdown);
    socket.on("question:showHost", onQuestion);
    socket.on("question:progress", onProgress);
    socket.on("question:reveal", onReveal);
    socket.on("game:scoreboard", onScoreboard);
    socket.on("game:over", onOver);

    if (socket.connected) attach();

    return () => {
      socket.off("connect", attach);
      socket.off("game:state", onState);
      socket.off("lobby:players", onPlayers);
      socket.off("game:countdown", onCountdown);
      socket.off("question:showHost", onQuestion);
      socket.off("question:progress", onProgress);
      socket.off("question:reveal", onReveal);
      socket.off("game:scoreboard", onScoreboard);
      socket.off("game:over", onOver);
    };
  }, [gameId]);

  const send = useCallback(
    (event: "host:start" | "host:next" | "host:lock" | "host:end") => {
      getSocket().emit(event, (result) => {
        if (!result.ok) setError(result.error ?? "That didn't work.");
        else setError(null);
      });
    },
    [],
  );

  const kick = useCallback((playerId: string) => {
    getSocket().emit("host:kick", { playerId }, () => {});
  }, []);

  if (alreadyEnded) {
    return (
      <main id="main" className="flex min-h-dvh items-center justify-center bg-ink-950 p-6">
        <p className="text-ink-300">This game has already finished.</p>
      </main>
    );
  }

  return (
    <div className="quiz-surface flex min-h-dvh flex-col" style={themeToCssVars(theme)}>
      {/* ── Control bar ── */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-3">
        <span className="text-sm font-semibold opacity-70">{title}</span>

        <span className="ml-auto flex items-center gap-3">
          {phase === "lobby" ? (
            <button
              type="button"
              onClick={() => send("host:start")}
              disabled={players.length === 0 || !attached}
              className="btn btn-primary"
            >
              Start game
            </button>
          ) : null}

          {phase === "question" ? (
            <button type="button" onClick={() => send("host:lock")} className="btn btn-ghost">
              Skip to results
            </button>
          ) : null}

          {phase === "reveal" || phase === "scoreboard" ? (
            <button type="button" onClick={() => send("host:next")} className="btn btn-primary">
              Next question
            </button>
          ) : null}

          {phase !== "ended" ? (
            <button
              type="button"
              onClick={() => {
                if (confirm("End the game for everyone?")) send("host:end");
              }}
              className="btn btn-ghost text-sm opacity-70"
            >
              End
            </button>
          ) : null}
        </span>
      </header>

      {error ? (
        <p role="alert" className="bg-red-900 px-5 py-2 text-sm text-red-100">
          {error}
        </p>
      ) : null}

      <main id="main" className="flex flex-1 flex-col px-5 py-6">
        {stage.kind === "lobby" ? (
          <Lobby
            pin={pin}
            joinOrigin={joinOrigin}
            players={players}
            onKick={kick}
          />
        ) : null}

        {stage.kind === "countdown" ? (
          <div className="flex flex-1 flex-col items-center justify-center">
            <p className="text-lg uppercase tracking-widest opacity-60">
              Get ready
            </p>
            <p
              key={stage.seconds}
              className="quiz-display numeric animate-pop-in mt-4 text-[10rem] font-extrabold leading-none"
              style={{ color: "var(--q-accent)" }}
            >
              {stage.seconds}
            </p>
          </div>
        ) : null}

        {stage.kind === "question" ? (
          <QuestionStage view={stage.view} answered={stage.answered} total={players.length} />
        ) : null}

        {stage.kind === "reveal" ? (
          <RevealStage view={stage.view} reveal={stage.reveal} />
        ) : null}

        {stage.kind === "scoreboard" ? (
          <Scoreboard players={stage.players} title="Leaderboard" />
        ) : null}

        {stage.kind === "over" ? (
          <Scoreboard players={stage.podium} title="Final scores" />
        ) : null}
      </main>
    </div>
  );
}

// ──────────────────────────────── Stages ───────────────────────────────────

function Lobby({
  pin,
  joinOrigin,
  players,
  onKick,
}: {
  pin: string;
  joinOrigin: string;
  players: PublicPlayer[];
  onKick: (playerId: string) => void;
}) {
  return (
    <div className="my-auto flex flex-col">
      <div className="quiz-card mx-auto w-full max-w-3xl px-6 py-8 text-center">
        <p className="text-sm uppercase tracking-[0.2em] opacity-60">
          Join at
        </p>
        <p className="quiz-display mt-1 text-2xl font-bold sm:text-3xl">
          {joinOrigin.replace(/^https?:\/\//, "")}
        </p>

        <p className="mt-6 text-sm uppercase tracking-[0.2em] opacity-60">
          Game PIN
        </p>
        <p className="quiz-display numeric mt-1 text-7xl font-extrabold sm:text-8xl">
          {pin}
        </p>
      </div>

      <div className="mx-auto mt-8 w-full max-w-4xl">
        <p className="mb-3 text-center text-lg font-semibold">
          {players.length === 0
            ? "Waiting for players…"
            : `${players.length} player${players.length === 1 ? "" : "s"} in`}
        </p>

        <ul className="flex flex-wrap justify-center gap-2">
          {players.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove ${player.nickname} from the game?`)) {
                    onKick(player.id);
                  }
                }}
                title="Click to remove"
                className="quiz-card animate-pop-in px-4 py-2 text-lg font-semibold"
                style={{ opacity: player.connected ? 1 : 0.5 }}
              >
                {player.nickname}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The four answer colours and shapes, matching the player screen exactly.
 *
 * They have to match: the whole point of the shared screen is that a player
 * reads "the red triangle" on the projector and taps the red triangle on their
 * phone. Because the server sends the same shuffled payload to host and
 * players, index `i` is the same option on both.
 */
const TILE_COLORS = [
  "var(--q-answer-1)",
  "var(--q-answer-2)",
  "var(--q-answer-3)",
  "var(--q-answer-4)",
];
const TILE_SHAPES = ["▲", "◆", "●", "■", "★", "⬟"];

/**
 * The options as the room should see them.
 *
 * Returns an empty list for types with nothing to display on a shared screen —
 * a text or slider answer would give the game away or simply has no options —
 * and the caller falls back to a "answer on your device" prompt.
 */
function displayOptions(
  payload: HostQuestionView["payload"],
): Array<{ id: string; text: string }> {
  switch (payload.type) {
    case "MULTIPLE_CHOICE":
    case "MULTIPLE_SELECT":
    case "POLL":
      return payload.options.map((o) => ({ id: o.id, text: o.text }));
    case "TRUE_FALSE":
      // Ids match the distribution keys the server sends back on reveal.
      return [
        { id: "true", text: "True" },
        { id: "false", text: "False" },
      ];
    default:
      return [];
  }
}

function QuestionStage({
  view,
  answered,
  total,
}: {
  view: HostQuestionView;
  answered: number;
  total: number;
}) {
  const options = displayOptions(view.payload);

  return (
    <div className="mx-auto my-auto flex w-full max-w-6xl flex-col">
      <p className="text-center text-sm opacity-60">
        Question {view.index + 1} of {view.total}
      </p>

      <h1 className="quiz-display mt-3 text-balance text-center text-4xl font-extrabold leading-tight sm:text-5xl">
        {view.prompt}
      </h1>

      {view.presentation.media ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={view.presentation.media}
          alt={view.presentation.mediaAlt ?? ""}
          className="mx-auto mt-6 max-h-56 rounded-xl object-contain"
        />
      ) : null}

      {options.length > 0 ? (
        <ul
          className={`mt-8 grid gap-3 ${
            options.length > 4 ? "sm:grid-cols-3" : "sm:grid-cols-2"
          }`}
        >
          {options.map((option, i) => (
            <li
              key={option.id}
              className="answer-tile flex min-h-20 items-center gap-4 px-5 py-5 text-2xl font-bold text-white"
              style={{ background: TILE_COLORS[i % TILE_COLORS.length] }}
            >
              <span aria-hidden className="text-3xl opacity-90">
                {TILE_SHAPES[i % TILE_SHAPES.length]}
              </span>
              <span className="flex-1">{option.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-10 text-center text-xl opacity-70">
          Answer on your device
        </p>
      )}

      <p className="numeric mt-10 text-center text-3xl font-bold">
        {answered}
        <span className="text-xl opacity-60"> / {total} answered</span>
      </p>
    </div>
  );
}

function RevealStage({
  view,
  reveal,
}: {
  view: HostQuestionView;
  reveal: RevealPayload;
}) {
  const { distribution } = reveal;
  const options = displayOptions(view.payload);
  const max = Math.max(1, ...Object.values(distribution.counts));

  return (
    <div className="mx-auto my-auto flex w-full max-w-5xl flex-col">
      <h1 className="quiz-display text-balance text-center text-2xl font-bold sm:text-3xl">
        {view.prompt}
      </h1>

      <p
        className="mt-4 text-center text-3xl font-extrabold sm:text-4xl"
        style={{ color: "var(--q-correct)" }}
      >
        {reveal.correctAnswerText}
      </p>

      {reveal.explanation ? (
        <p className="mx-auto mt-3 max-w-2xl text-center opacity-80">
          {reveal.explanation}
        </p>
      ) : null}

      {reveal.authorName ? (
        <p className="mt-4 text-center text-sm opacity-70">
          Question written by{" "}
          <span className="font-semibold">{reveal.authorName}</span>
        </p>
      ) : null}

      {/*
        Answer distribution.

        Iterates the options rather than the counts, so an option nobody picked
        still gets a row — "nobody chose C" is exactly the kind of thing a
        teacher wants to see, and it vanishes if you only render what was
        submitted. Labels use the answer text; the raw option ids mean nothing
        to the room.
      */}
      {options.length > 0 ? (
        <ul className="mt-8 space-y-2.5">
          {options.map((option, i) => {
            const count = distribution.counts[option.id] ?? 0;
            const isCorrect = reveal.correctIds.includes(option.id);
            return (
              <li key={option.id} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="w-7 shrink-0 text-center text-xl"
                  style={{ color: TILE_COLORS[i % TILE_COLORS.length] }}
                >
                  {TILE_SHAPES[i % TILE_SHAPES.length]}
                </span>
                <span
                  className="w-44 shrink-0 truncate text-lg font-semibold"
                  style={{ opacity: isCorrect ? 1 : 0.55 }}
                >
                  {option.text}
                </span>
                <span className="h-9 flex-1 overflow-hidden rounded-lg bg-white/10">
                  <span
                    className="block h-full rounded-lg transition-all duration-500"
                    style={{
                      width: `${Math.max((count / max) * 100, count > 0 ? 4 : 0)}%`,
                      background: isCorrect
                        ? "var(--q-correct)"
                        : TILE_COLORS[i % TILE_COLORS.length],
                      opacity: isCorrect ? 1 : 0.45,
                    }}
                  />
                </span>
                <span className="numeric w-12 text-right text-lg font-bold">
                  {count}
                </span>
                {isCorrect ? (
                  <span
                    aria-label="correct answer"
                    className="w-6 text-xl"
                    style={{ color: "var(--q-correct)" }}
                  >
                    ✓
                  </span>
                ) : (
                  <span className="w-6" />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Word cloud — size scales with how many people said the same thing. */}
      {distribution.words && distribution.words.length > 0 ? (
        <div className="mt-8 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-2">
          {distribution.words.map((entry) => {
            const maxCount = distribution.words![0]!.count;
            const scale = 1 + (entry.count / maxCount) * 1.8;
            return (
              <span
                key={entry.word}
                className="font-bold"
                style={{ fontSize: `${scale}rem`, opacity: 0.5 + (entry.count / maxCount) * 0.5 }}
              >
                {entry.word}
              </span>
            );
          })}
        </div>
      ) : null}

      <p className="mt-auto pt-6 text-center text-sm opacity-60">
        {distribution.totalAnswers} of {distribution.totalPlayers} answered
      </p>
    </div>
  );
}

function Scoreboard({
  players,
  title,
}: {
  players: RankedPlayer[];
  title: string;
}) {
  return (
    // Centred vertically: this is a projector screen, and content pinned to the
    // top of a 16:9 display reads as broken from the back of a room.
    <div className="mx-auto my-auto flex w-full max-w-2xl flex-col">
      <h1 className="quiz-display mb-6 text-center text-3xl font-extrabold">
        {title}
      </h1>

      <ol className="space-y-2">
        {players.map((player) => (
          <li
            key={player.id}
            className="quiz-card animate-pop-in flex items-center gap-4 px-5 py-4"
          >
            <span className="numeric w-10 text-center text-2xl font-extrabold opacity-70">
              {player.place}
            </span>
            <span className="flex-1 truncate text-xl font-semibold">
              {player.nickname}
            </span>
            {player.delta !== 0 ? (
              <span
                className="text-sm font-medium"
                style={{
                  color: player.delta > 0 ? "var(--q-correct)" : "var(--q-wrong)",
                }}
              >
                {player.delta > 0 ? `▲${player.delta}` : `▼${-player.delta}`}
              </span>
            ) : null}
            <span className="numeric text-2xl font-extrabold">{player.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
