"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";

import {
  authenticate,
  createSession,
  destroySession,
  registerUser,
} from "@/lib/auth";
import { consume, reset, RULES } from "@/lib/rate-limit";

/**
 * Auth server actions.
 *
 * Next.js gives Server Actions built-in CSRF protection: it compares the Origin
 * and Host headers and rejects mismatches, so a form on another site cannot
 * invoke these. What it does *not* give us is brute-force protection, so that
 * is handled explicitly below.
 */

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const passwordSchema = z
  .string()
  // NIST guidance: length is what matters. Composition rules ("one symbol!")
  // mostly push people toward `Password1!`, so we ask for length instead.
  .min(10, "Use at least 10 characters — length matters more than symbols.")
  .max(200, "That password is too long.");

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: passwordSchema,
  displayName: z
    .string()
    .trim()
    .min(1, "Tell us what to call you.")
    .max(40, "That name is too long."),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/**
 * A coarse client identifier for rate limiting.
 *
 * Behind a reverse proxy `x-forwarded-for` is the client address; direct, it's
 * absent and everyone shares one bucket. That is acceptable for login limiting
 * (the failure mode is stricter limiting, not weaker), but never use this for
 * anything security-critical — a client can set the header freely unless your
 * proxy overwrites it. See docs/DEPLOYMENT.md.
 */
async function clientKey(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { fieldErrors };
  }

  const key = await clientKey();
  if (!consume(`signup:${key}`, RULES.signup).allowed) {
    return { error: "Too many accounts created from here. Try again later." };
  }

  const result = await registerUser(parsed.data);
  if (!result.ok) return { error: result.error };

  await createSession(result.userId);
  redirect("/dashboard");
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter your email and password." };
  }

  const key = await clientKey();

  // Limited by IP *and* by the email being targeted, so one attacker cannot
  // spread attempts across many addresses to stay under an IP-only limit.
  const ipLimit = consume(`login:ip:${key}`, RULES.login);
  const emailLimit = consume(`login:email:${parsed.data.email}`, RULES.login);

  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retryMs = Math.max(ipLimit.retryAfterMs, emailLimit.retryAfterMs);
    const minutes = Math.ceil(retryMs / 60_000);
    return {
      error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  const result = await authenticate(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.error };

  // A successful login clears the counters — otherwise a user who mistyped
  // twice stays near the threshold for the rest of the window.
  reset(`login:ip:${key}`);
  reset(`login:email:${parsed.data.email}`);

  await createSession(result.userId);

  const next = formData.get("next");
  // Only ever redirect to a path on this site. Accepting an absolute URL here
  // would turn the login form into an open redirect.
  const target =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/dashboard";

  redirect(target);
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
