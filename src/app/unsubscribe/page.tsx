"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { VoxandraLogo } from "@/components/brand/voxandra-logo";

type Status = "working" | "unsubscribed" | "resubscribed" | "error";

// The opt-out runs from client-side JS, deliberately, rather than during render.
// Link scanners and corporate security proxies fetch URLs found in email but do
// not execute JS, so doing this server-side would unsubscribe people who never
// clicked. It also means no confirmation button: a confirm step is the most common
// way senders fail Gmail's one-click rules and turns hesitant readers into spam
// complaints. Undo-after-the-fact is strictly better, so there is an undo instead.
function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("working");
  const attempted = useRef(false);

  const call = useCallback(
    async (resubscribe: boolean) => {
      if (!token) {
        setStatus("error");
        return;
      }
      setStatus("working");
      try {
        const query = new URLSearchParams({ token });
        if (resubscribe) query.set("resubscribe", "1");
        const response = await fetch(`/api/unsubscribe?${query.toString()}`, {
          method: "POST",
        });
        if (!response.ok) throw new Error("request failed");
        // `matched: false` means the token did not resolve to anyone — usually a
        // link truncated by a mail client. Show the error state rather than
        // claiming success, or they keep receiving mail and hit spam instead.
        const body = (await response.json().catch(() => null)) as { matched?: boolean } | null;
        if (body?.matched === false) {
          setStatus("error");
          return;
        }
        setStatus(resubscribe ? "resubscribed" : "unsubscribed");
      } catch {
        setStatus("error");
      }
    },
    [token]
  );

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void call(false);
  }, [call]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <VoxandraLogo />
        </div>

        {status === "working" ? (
          <>
            <Loader2 className="mx-auto mt-6 h-8 w-8 animate-spin text-stone-400" />
            <p className="mt-4 text-sm text-stone-600">Updating your email preferences...</p>
          </>
        ) : null}

        {status === "unsubscribed" ? (
          <>
            <CheckCircle2 className="mx-auto mt-6 h-8 w-8 text-teal-600" />
            <h1 className="mt-4 text-lg font-semibold text-stone-950">You&apos;re unsubscribed</h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              We won&apos;t send you any more product follow-up emails. You&apos;ll still get
              messages about your own account, like a call record being ready.
            </p>
            <button
              type="button"
              onClick={() => void call(true)}
              className="mt-5 text-sm font-semibold text-[#3b1676] underline-offset-4 hover:underline"
            >
              Undo — resubscribe me
            </button>
          </>
        ) : null}

        {status === "resubscribed" ? (
          <>
            <CheckCircle2 className="mx-auto mt-6 h-8 w-8 text-teal-600" />
            <h1 className="mt-4 text-lg font-semibold text-stone-950">You&apos;re resubscribed</h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              You&apos;ll keep receiving occasional product follow-up emails.
            </p>
            <button
              type="button"
              onClick={() => void call(false)}
              className="mt-5 text-sm font-semibold text-[#3b1676] underline-offset-4 hover:underline"
            >
              Unsubscribe again
            </button>
          </>
        ) : null}

        {status === "error" ? (
          <>
            <ShieldAlert className="mx-auto mt-6 h-8 w-8 text-amber-600" />
            <h1 className="mt-4 text-lg font-semibold text-stone-950">
              We couldn&apos;t update that
            </h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              This link may be incomplete or out of date. Reply to any Voxandra email and we
              will take you off the list.
            </p>
          </>
        ) : null}

        <p className="mt-8 text-xs text-stone-400">
          <Link href="/" className="underline-offset-4 hover:underline">
            voxandra.com
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-stone-50">
          <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
        </div>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  );
}
