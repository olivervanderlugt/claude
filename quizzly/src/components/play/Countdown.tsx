"use client";

import { useEffect, useState } from "react";

/** The "get ready" beat between questions. */
export function Countdown({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center">
      <p className="text-sm uppercase tracking-widest opacity-60">Get ready</p>
      <p
        // Re-keying on the value restarts the pop-in animation each second, so
        // the number visibly "lands" instead of silently swapping.
        key={remaining}
        className="quiz-display numeric animate-pop-in mt-3 text-8xl font-extrabold"
        style={{ color: "var(--q-accent)" }}
        aria-live="assertive"
      >
        {remaining > 0 ? remaining : "Go"}
      </p>
    </div>
  );
}
