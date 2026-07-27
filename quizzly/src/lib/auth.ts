import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import type { User } from "@prisma/client";

import { db } from "./db";
import { isProduction } from "./env";
import {
  generateSessionToken,
  hashSessionToken,
  hashPassword,
  verifyPassword,
} from "./crypto";

export { SESSION_COOKIE } from "./session-cookie";

import { SESSION_COOKIE } from "./session-cookie";

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 15; // refresh at halfway

export type SessionUser = Pick<User, "id" | "email" | "displayName">;

/**
 * Create a session and set the cookie.
 *
 * The cookie is httpOnly (JavaScript can never read it, so an XSS bug cannot
 * exfiltrate the session), Secure in production, and SameSite=Lax — which stops
 * the cookie riding along on cross-site POSTs, our primary CSRF defence.
 */
export async function createSession(userId: string): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.session.create({
    data: { id: hashSessionToken(token), userId, expiresAt },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Resolve the current user, or null.
 *
 * Wrapped in React's `cache` so that a page rendering ten components that each
 * ask "who is logged in?" makes one database query, not ten.
 *
 * This is the *data boundary* check. Middleware also redirects unauthenticated
 * users, but middleware is a UX optimisation and can be bypassed by a
 * misconfigured proxy — so every protected read calls this, and never trusts a
 * header set upstream.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { id: hashSessionToken(token) },
    select: {
      expiresAt: true,
      user: { select: { id: true, email: true, displayName: true } },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    // Expired sessions are deleted on sight rather than left to accumulate.
    await db.session
      .delete({ where: { id: hashSessionToken(token) } })
      .catch(() => {});
    return null;
  }

  // Sliding expiry: an active user is not logged out mid-session, but an
  // abandoned session still dies on schedule.
  if (session.expiresAt.getTime() - Date.now() < SESSION_REFRESH_THRESHOLD_MS) {
    await db.session
      .update({
        where: { id: hashSessionToken(token) },
        data: { expiresAt: new Date(Date.now() + SESSION_DURATION_MS) },
      })
      .catch(() => {});
  }

  return session.user;
});

/** Throwing variant for routes that have no meaningful unauthenticated state. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Not signed in");
  return user;
}

export class AuthError extends Error {}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.session
      .delete({ where: { id: hashSessionToken(token) } })
      .catch(() => {});
  }
  store.delete(SESSION_COOKIE);
}

/** Log out everywhere — used after a password change. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

// ───────────────────────────── Registration ─────────────────────────────────

export async function registerUser(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    // Deliberately the same message the login form gives for a wrong password.
    // Saying "that email is taken" turns the signup form into an oracle for
    // checking whether a given person has an account here.
    return { ok: false, error: "Could not create that account." };
  }

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName.trim(),
    },
    select: { id: true },
  });

  return { ok: true, userId: user.id };
}

export async function authenticate(
  email: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    // Run a hash anyway so a missing account and a wrong password take the same
    // amount of time — otherwise response latency reveals which emails exist.
    await hashPassword(password);
    return { ok: false, error: "Incorrect email or password." };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, error: "Incorrect email or password." };
  }

  return { ok: true, userId: user.id };
}
