import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiConfigured } from "@/lib/env";
import { deleteAccountAction } from "@/app/actions/settings";
import { AiKeyForm } from "@/components/settings/AiKeyForm";

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");

  const params = await searchParams;

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { encryptedAiKey: true, createdAt: true },
  });

  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="border-b border-ink-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Link href="/dashboard" className="text-sm text-ink-400 hover:text-ink-200">
            ← Dashboard
          </Link>
          <span className="text-sm text-ink-400">Settings</span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl space-y-6 px-5 py-8">
        <section className="app-card p-5">
          <h1 className="font-semibold text-white">Account</h1>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">Name</dt>
              <dd className="text-ink-200">{user.displayName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Email</dt>
              <dd className="text-ink-200">{user.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Joined</dt>
              <dd className="text-ink-200">
                {record?.createdAt.toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </section>

        <section className="app-card p-5">
          <h2 className="font-semibold text-white">AI generation key</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-400">
            Save your own Anthropic API key to generate questions on your own
            budget, with no hourly cap.
            {aiConfigured
              ? " Without one you'll use the server's key, which is rate limited."
              : " This server has no key of its own, so AI drafting only works if you add one here."}
          </p>
          <AiKeyForm hasKey={Boolean(record?.encryptedAiKey)} />
          <p className="mt-3 text-xs text-ink-500">
            Stored encrypted (AES-256-GCM) and never shown again — not even to
            you. Replace it any time by saving a new one.
          </p>
        </section>

        <section className="app-card border-red-900/60 p-5">
          <h2 className="font-semibold text-white">Delete account</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-400">
            Permanently deletes your account, every quiz you own, and all their
            game history. This cannot be undone.
          </p>

          {params.error === "confirm" ? (
            <p role="alert" className="mt-3 text-sm text-red-400">
              The email didn&apos;t match. Nothing was deleted.
            </p>
          ) : null}

          <form action={deleteAccountAction} className="mt-4">
            <label className="app-label" htmlFor="confirmEmail">
              Type <span className="font-mono text-ink-200">{user.email}</span> to
              confirm
            </label>
            <input
              id="confirmEmail"
              name="confirmEmail"
              required
              autoComplete="off"
              className="app-input"
            />
            <button type="submit" className="btn btn-danger mt-3">
              Delete my account
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
