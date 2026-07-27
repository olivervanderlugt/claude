"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { joinCollabAction } from "@/app/actions/collab";
import type { ActionState } from "@/app/actions/quiz";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary mt-3 w-full py-3" disabled={pending}>
      {pending ? "Joining…" : "Join"}
    </button>
  );
}

export function CollabJoinForm({ initialCode }: { initialCode: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    joinCollabAction,
    {},
  );
  const [code, setCode] = useState(initialCode.toUpperCase());

  return (
    <form action={formAction} className="mt-5">
      <label className="app-label" htmlFor="code">
        Invite code
      </label>
      <input
        id="code"
        name="code"
        value={code}
        // Codes use an alphabet with no 0/O/1/I, so uppercasing is safe and
        // saves people fighting their phone keyboard.
        onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
        required
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="ABC123"
        className="app-input numeric text-center text-xl font-bold"
      />

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {state.error}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}
