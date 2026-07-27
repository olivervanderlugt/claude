import type { Server as HttpServer } from "node:http";

import { Server, type Socket } from "socket.io";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashSessionToken } from "@/lib/crypto";
// Imported from its own module rather than `@/lib/auth`, which is `server-only`
// and would throw in this plain-Node process. See src/lib/session-cookie.ts.
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { consume, RULES } from "@/lib/rate-limit";
import { questionPayloadSchema } from "@/lib/question-schema";
import { presentationSchema, themeSchema } from "@/lib/theme";
import { quizSettingsSchema } from "@/lib/scoring";
import { GameRoom, type GameSnapshot, type RoomEmitter } from "./engine";

/**
 * Socket.IO wiring.
 *
 * Security properties enforced here, in the order the OWASP WebSocket guidance
 * puts them:
 *
 *   • Origin validation on the handshake. Without it any page on the internet
 *     can open a socket to this server carrying the user's cookies —
 *     cross-site WebSocket hijacking. Socket.IO's CORS option covers the
 *     polling transport; the explicit `allowRequest` check covers the upgrade.
 *   • Authentication before privilege. Host actions require a valid session
 *     cookie *and* ownership of the specific game. Players are anonymous by
 *     design but hold a per-game bearer token so a socket can't impersonate
 *     another player by guessing an id.
 *   • Message size and rate limits. A quiz answer is small; anything large is
 *     hostile. Both a byte cap and a per-socket event budget are applied.
 *   • No trust in client-supplied identity. `socket.data` is written by the
 *     server only, never from the payload.
 */

type PlayerSocketData = {
  role: "player";
  gameId: string;
  playerId: string;
};

type HostSocketData = {
  role: "host";
  gameId: string;
  userId: string;
};

type SocketData = PlayerSocketData | HostSocketData | { role: "anonymous" };

const rooms = new Map<string, GameRoom>();
/** pin → gameId, so players can join by PIN without exposing game ids. */
const pinIndex = new Map<string, string>();

function hostRoom(gameId: string) {
  return `host:${gameId}`;
}
function gameRoomName(gameId: string) {
  return `game:${gameId}`;
}
function playerRoom(playerId: string) {
  return `player:${playerId}`;
}

// ─────────────────────────────── Room loading ───────────────────────────────

/**
 * Build a room from the immutable snapshot taken when the game was created.
 *
 * Reading the snapshot rather than the live quiz is what stops a host editing
 * a quiz mid-game and changing the questions under the players.
 */
async function loadRoom(gameId: string, io: QuizzlyServer): Promise<GameRoom | null> {
  const existing = rooms.get(gameId);
  if (existing) return existing;

  const game = await db.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      pin: true,
      hostId: true,
      status: true,
      quizSnapshot: true,
    },
  });

  if (!game || game.status === "ENDED") return null;

  const parsed = parseSnapshot(game.quizSnapshot);
  if (!parsed) {
    console.error(`[realtime] game ${gameId} has an unreadable snapshot`);
    return null;
  }

  const emitter: RoomEmitter = {
    toHost: (event, payload) => {
      io.to(hostRoom(gameId)).emit(event as never, payload as never);
    },
    toPlayer: (playerId, event, payload) => {
      io.to(playerRoom(playerId)).emit(event as never, payload as never);
    },
    toAll: (event, payload) => {
      io.to(gameRoomName(gameId)).emit(event as never, payload as never);
    },
  };

  const room = new GameRoom(
    game.id,
    game.pin,
    game.hostId,
    parsed,
    emitter,
    (id) => {
      const disposed = rooms.get(id);
      disposed?.dispose();
      rooms.delete(id);
      pinIndex.delete(disposed?.pin ?? "");
    },
  );

  rooms.set(game.id, room);
  pinIndex.set(game.pin, game.id);
  return room;
}

function parseSnapshot(raw: unknown): GameSnapshot | null {
  try {
    const data = raw as {
      quizId: string;
      title: string;
      theme: unknown;
      settings: unknown;
      isCollab: boolean;
      questions: Array<Record<string, unknown>>;
    };

    return {
      quizId: data.quizId,
      title: data.title,
      theme: themeSchema.parse(data.theme),
      settings: quizSettingsSchema.parse(data.settings),
      isCollab: Boolean(data.isCollab),
      questions: data.questions.map((q) => ({
        id: String(q.id),
        type: String(q.type),
        prompt: String(q.prompt),
        payload: questionPayloadSchema.parse(q.payload),
        presentation: presentationSchema.parse(q.presentation),
        timeLimitSec: Number(q.timeLimitSec),
        points: Number(q.points),
        explanation: (q.explanation as string | null) ?? null,
        authorName: (q.authorName as string | null) ?? null,
      })),
    };
  } catch (err) {
    console.error("[realtime] snapshot parse failed", err);
    return null;
  }
}

/** Called by the HTTP layer when a host creates a game, to warm the room. */
export async function preloadRoom(gameId: string): Promise<void> {
  if (!ioRef) return;
  await loadRoom(gameId, ioRef);
}

// ──────────────────────────────── Handshake ─────────────────────────────────

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

async function userIdFromCookies(
  cookieHeader: string | undefined,
): Promise<string | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { id: hashSessionToken(token) },
    select: { userId: true, expiresAt: true },
  });

  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return session.userId;
}

/**
 * Reject handshakes from origins we don't serve.
 *
 * A browser always sends `Origin` on a WebSocket upgrade, so a missing origin
 * means a non-browser client — allowed, since it carries no ambient cookies and
 * therefore can't be a CSWSH vector, but it still has to authenticate normally.
 */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return origin === env.APP_ORIGIN;
}

type QuizzlyServer = Server;

let ioRef: QuizzlyServer | null = null;

export function attachRealtime(httpServer: HttpServer): QuizzlyServer {
  const io = new Server(httpServer, {
    path: "/api/socket",
    // Cap a single message. Answers are tiny; a megabyte-scale frame is either
    // a bug or an attempt to exhaust memory.
    maxHttpBufferSize: 32_000,
    // Drop a socket that stops responding, rather than holding its slot open.
    pingTimeout: 20_000,
    pingInterval: 25_000,
    cors: {
      origin: env.APP_ORIGIN,
      credentials: true,
    },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!originAllowed(origin)) {
        console.warn(`[realtime] rejected handshake from origin ${origin}`);
        return callback("origin_not_allowed", false);
      }
      callback(null, true);
    },
  });

  ioRef = io;

  io.on("connection", (socket) => {
    socket.data = { role: "anonymous" } satisfies SocketData;

    /** Shared guard: every inbound event costs budget. */
    const withinBudget = (rule = RULES.socketEvent) =>
      consume(`socket:${socket.id}`, rule).allowed;

    // ───────────────────────────── Host events ────────────────────────────

    socket.on("host:attach", async ({ gameId }: { gameId: string }, ack) => {
      if (!withinBudget()) return ack?.({ ok: false, error: "Slow down." });

      const userId = await userIdFromCookies(socket.handshake.headers.cookie);
      if (!userId) return ack?.({ ok: false, error: "Sign in to host a game." });

      const room = await loadRoom(gameId, io);
      if (!room) return ack?.({ ok: false, error: "Game not found." });

      // Ownership, not just authentication — being signed in doesn't make you
      // the host of *this* game.
      if (room.hostUserId !== userId) {
        return ack?.({ ok: false, error: "You're not hosting this game." });
      }

      socket.data = { role: "host", gameId, userId } satisfies HostSocketData;
      await socket.join([hostRoom(gameId), gameRoomName(gameId)]);

      socket.emit("game:state", room.stateMessage());
      socket.emit("lobby:players", room.publicPlayers());
      ack?.({ ok: true });
    });

    const requireHost = (): GameRoom | null => {
      const data = socket.data as SocketData;
      if (data.role !== "host") return null;
      return rooms.get(data.gameId) ?? null;
    };

    socket.on("host:start", async (ack) => {
      if (!withinBudget()) return ack?.({ ok: false, error: "Slow down." });
      const room = requireHost();
      if (!room) return ack?.({ ok: false, error: "Not hosting." });
      ack?.(await room.start());
    });

    socket.on("host:next", async (ack) => {
      if (!withinBudget()) return ack?.({ ok: false, error: "Slow down." });
      const room = requireHost();
      if (!room) return ack?.({ ok: false, error: "Not hosting." });
      ack?.(await room.advance());
    });

    socket.on("host:lock", async (ack) => {
      if (!withinBudget()) return ack?.({ ok: false, error: "Slow down." });
      const room = requireHost();
      if (!room) return ack?.({ ok: false, error: "Not hosting." });
      ack?.(await room.lock());
    });

    socket.on("host:kick", async ({ playerId }: { playerId: string }, ack) => {
      if (!withinBudget()) return ack?.({ ok: false, error: "Slow down." });
      const room = requireHost();
      if (!room) return ack?.({ ok: false, error: "Not hosting." });

      const removed = await room.kickPlayer(String(playerId));
      ack?.(removed ? { ok: true } : { ok: false, error: "Player not found." });
    });

    socket.on("host:end", async (ack) => {
      if (!withinBudget()) return ack?.({ ok: false, error: "Slow down." });
      const room = requireHost();
      if (!room) return ack?.({ ok: false, error: "Not hosting." });
      ack?.(await room.end());
    });

    // ──────────────────────────── Player events ───────────────────────────

    socket.on(
      "player:join",
      async ({ pin, nickname }: { pin: string; nickname: string }, ack) => {
        // Joining is rate-limited per socket rather than per IP: a whole
        // classroom shares one NAT'd address, and limiting by IP would lock
        // out the back half of the room.
        if (!consume(`join:${socket.id}`, RULES.gameJoin).allowed) {
          return ack?.({ ok: false, error: "Too many attempts. Wait a moment." });
        }

        const cleanPin = String(pin ?? "").trim();
        const gameId = pinIndex.get(cleanPin) ?? (await findGameIdByPin(cleanPin));
        if (!gameId) return ack?.({ ok: false, error: "No game with that PIN." });

        const room = await loadRoom(gameId, io);
        if (!room) return ack?.({ ok: false, error: "That game has finished." });

        const result = await room.addPlayer(String(nickname ?? ""));
        if (!result.ok) return ack?.(result);

        socket.data = {
          role: "player",
          gameId,
          playerId: result.playerId,
        } satisfies PlayerSocketData;

        await socket.join([gameRoomName(gameId), playerRoom(result.playerId)]);
        socket.emit("game:state", room.stateMessage());

        ack?.({ ok: true, playerId: result.playerId, token: result.token });
      },
    );

    socket.on(
      "player:resume",
      async (
        { pin, playerId, token }: { pin: string; playerId: string; token: string },
        ack,
      ) => {
        if (!withinBudget()) return ack?.({ ok: false, error: "Slow down." });

        const gameId =
          pinIndex.get(String(pin ?? "").trim()) ??
          (await findGameIdByPin(String(pin ?? "").trim()));
        if (!gameId) return ack?.({ ok: false, error: "That game has finished." });

        const room = await loadRoom(gameId, io);
        if (!room) return ack?.({ ok: false, error: "That game has finished." });

        // The token is what makes this safe — without it, knowing a player id
        // would be enough to hijack someone's score.
        if (!room.resumePlayer(String(playerId), String(token))) {
          return ack?.({ ok: false, error: "Couldn't rejoin. Join again with the PIN." });
        }

        socket.data = { role: "player", gameId, playerId } satisfies PlayerSocketData;
        await socket.join([gameRoomName(gameId), playerRoom(playerId)]);
        socket.emit("game:state", room.stateMessage());

        ack?.({ ok: true });
      },
    );

    socket.on(
      "player:answer",
      async ({ index, response }: { index: number; response: unknown }, ack) => {
        if (!consume(`answer:${socket.id}`, RULES.socketAnswer).allowed) {
          return ack?.({ ok: false, error: "Slow down." });
        }

        const data = socket.data as SocketData;
        if (data.role !== "player")
          return ack?.({ ok: false, error: "Join the game first." });

        const room = rooms.get(data.gameId);
        if (!room) return ack?.({ ok: false, error: "That game has finished." });

        // playerId comes from server-side socket state, never from the payload.
        ack?.(await room.submitAnswer(data.playerId, Number(index), response));
      },
    );

    socket.on("disconnect", () => {
      const data = socket.data as SocketData;
      if (data.role === "player") {
        rooms.get(data.gameId)?.markDisconnected(data.playerId);
      }
    });
  });

  return io;
}

async function findGameIdByPin(pin: string): Promise<string | null> {
  if (!/^\d{6}$/.test(pin)) return null;

  const game = await db.game.findUnique({
    where: { pin },
    select: { id: true, status: true },
  });

  if (!game || game.status === "ENDED") return null;
  return game.id;
}
