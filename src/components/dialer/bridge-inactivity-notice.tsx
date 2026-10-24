"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export function BridgeInactivityNotice({ callId, deadlineAt }: {
  callId: Id<"calls">;
  deadlineAt: number;
}) {
  const keepConnected = useMutation(api.translationBridge.keepBridgeConnected);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((deadlineAt - now) / 1000));

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <p role="status" className="text-sm font-semibold">No speech detected. This call will end unless you respond.</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs">{seconds > 0 ? `${seconds} seconds remaining. Speak or choose Keep connected.` : "Ending the inactive call…"}</p>
        <button
          type="button"
          disabled={pending || seconds === 0}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              await keepConnected({ callId });
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Could not keep the call connected. Please speak to continue.");
            } finally {
              setPending(false);
            }
          }}
          className="min-h-11 rounded-md bg-amber-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-amber-200 dark:text-amber-950"
        >
          {pending ? "Keeping connected…" : "Keep connected"}
        </button>
      </div>
      <p className="mt-2 text-xs">Adds a three-minute inactivity window, not extra call time or credits.</p>
      {error ? <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}
