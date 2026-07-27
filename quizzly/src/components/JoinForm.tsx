"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * PIN entry. Deliberately the only thing asked for at this stage — nickname
 * comes next, on the play screen, so the first interaction is a single field.
 */
export function JoinForm({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();

    const clean = pin.replace(/\D/g, "");
    if (clean.length !== 6) {
      setError("A game PIN is six digits.");
      return;
    }
    router.push(`/play/${clean}`);
  }

  return (
    <form onSubmit={submit} className={className}>
      <label className="app-label" htmlFor="pin">
        Game PIN
      </label>
      <input
        id="pin"
        name="pin"
        value={pin}
        onChange={(e) => {
          setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
          setError(null);
        }}
        // `inputMode="numeric"` puts a number pad on phones without the
        // spinner arrows and scroll-to-change behaviour of type="number".
        inputMode="numeric"
        autoComplete="off"
        placeholder="123456"
        className="app-input numeric text-center text-2xl font-bold tracking-[0.3em]"
        aria-describedby={error ? "pin-error" : undefined}
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p id="pin-error" role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary mt-3 w-full py-3 text-base">
        Join game
      </button>
    </form>
  );
}
