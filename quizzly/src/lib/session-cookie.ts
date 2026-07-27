/**
 * The session cookie name, kept in its own module on purpose.
 *
 * `auth.ts` is marked `server-only`, which makes importing it fail outside the
 * React server bundle — a guard worth keeping, since it stops session helpers
 * ever being pulled into a client bundle.
 *
 * But the Socket.IO server runs as a plain Node process under tsx, not through
 * the Next bundler, and it needs to read this one cookie name to authenticate
 * host connections. Importing `auth.ts` there would trip the guard.
 *
 * So the constant lives here, where both worlds can import it, and `auth.ts`
 * keeps its guard intact.
 */
export const SESSION_COOKIE = "quizzly_session";
