"use client";

import { io, type Socket } from "socket.io-client";

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@/types/realtime";

export type QuizzlySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * One socket per tab, shared by whichever screen needs it.
 *
 * React 18+ mounts effects twice in development StrictMode. Creating the socket
 * inside an effect without this guard opens two connections, and the second
 * `player:join` fails with "someone already has that nickname" — a confusing
 * dev-only bug. A module-level singleton sidesteps it entirely.
 */
let socket: QuizzlySocket | null = null;

export function getSocket(): QuizzlySocket {
  if (!socket) {
    socket = io({
      path: "/api/socket",
      // Go straight to WebSocket. The polling fallback exists for networks that
      // block WS, but trying it first adds a round trip to every connection.
      transports: ["websocket", "polling"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 10_000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/**
 * Session storage for a player's identity within one game.
 *
 * sessionStorage rather than localStorage on purpose: it is scoped to the tab
 * and cleared when the tab closes, so a shared classroom laptop doesn't hand
 * the next student the previous one's game identity.
 */

const KEY_PREFIX = "quizzly:player:";

export interface StoredIdentity {
  playerId: string;
  token: string;
  nickname: string;
}

export function saveIdentity(pin: string, identity: StoredIdentity): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + pin, JSON.stringify(identity));
  } catch {
    // Private browsing modes can refuse writes. Losing the ability to resume is
    // a degraded experience, not a broken one, so this is non-fatal.
  }
}

export function loadIdentity(pin: string): StoredIdentity | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + pin);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIdentity;
    return parsed.playerId && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function clearIdentity(pin: string): void {
  try {
    sessionStorage.removeItem(KEY_PREFIX + pin);
  } catch {
    /* ignore */
  }
}
