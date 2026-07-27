"use client";

import { useEffect, useState } from "react";

/**
 * Shows a join code with a copy button.
 *
 * `navigator.clipboard` needs a secure context, so it's unavailable over plain
 * HTTP on a LAN address — a realistic setup for a self-hosted classroom
 * server. When it isn't available the code stays visible and selectable and we
 * just don't offer the button, rather than showing one that silently fails.
 */
export function CopyableCode({
  code,
  joinPath,
}: {
  code: string;
  joinPath: string;
}) {
  const [copied, setCopied] = useState(false);
  const [canCopy, setCanCopy] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");

  useEffect(() => {
    setCanCopy(Boolean(navigator.clipboard) && window.isSecureContext);
    setJoinUrl(`${window.location.origin}${joinPath}?code=${encodeURIComponent(code)}`);
  }, [code, joinPath]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCanCopy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <code className="numeric rounded-lg bg-ink-950 px-4 py-2.5 text-2xl font-bold tracking-[0.2em] text-white">
          {code}
        </code>
        {canCopy ? (
          <>
            <button
              type="button"
              onClick={() => copy(code)}
              className="btn btn-ghost py-2 text-sm"
            >
              {copied ? "Copied" : "Copy code"}
            </button>
            <button
              type="button"
              onClick={() => copy(joinUrl)}
              className="btn btn-ghost py-2 text-sm"
            >
              Copy join link
            </button>
          </>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </p>
    </div>
  );
}
