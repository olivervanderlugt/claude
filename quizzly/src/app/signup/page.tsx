import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main
      id="main"
      className="flex min-h-dvh items-center justify-center bg-ink-950 px-5 py-12"
    >
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center text-lg font-bold tracking-tight text-white"
        >
          Quiz<span className="text-brand-400">zly</span>
        </Link>

        <div className="app-card p-6">
          <h1 className="text-xl font-bold text-white">Create your account</h1>
          <p className="mt-1 text-sm text-ink-400">
            You only need an account to <em>build</em> quizzes. Players never do.
          </p>
          <AuthForm mode="signup" />
        </div>

        <p className="mt-5 text-center text-sm text-ink-400">
          Already have one?{" "}
          <Link href="/login" className="font-medium text-brand-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
