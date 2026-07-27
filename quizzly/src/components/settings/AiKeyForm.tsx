"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { saveAiKeyAction } from "@/app/actions/settings";
import type { ActionState } from "@/app/actions/quiz";

function Submit({ hasKey }: { hasKey: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary mt-3" disabled={pending}>
      {pending ? "Saving…" : hasKey ? "Replace key" : "Save key"}
    </button>
  );
}

export function AiKeyForm({ hasKey }: { hasKey: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    saveAiKeyAction,
    {},
  );

  return (
    <form action={formAction} className="mt-4">
      {hasKey ? (
        <p className="mb-3 rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          A key is saved on your account.
        </p>
      ) : null}

      <label className="app-label" htmlFor="apiKey">
        Anthropic API key
      </label>
      <input
        id="apiKey"
        name="apiKey"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={hasKey ? "Enter a new key, or leave blank to remove" : "sk-ant-…"}
        className="app-input font-mono text-sm"
      />

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="mt-2 text-sm text-emerald-400">
          {state.message}
        </p>
      ) : null}

      <Submit hasKey={hasKey} />
    </form>
  );
}
