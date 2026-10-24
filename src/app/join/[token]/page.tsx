"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { VoxandraLogo } from "@/components/brand/voxandra-logo";

export default function JoinWorkspacePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const acceptInvitation = useMutation(api.team.acceptInvitation);
  const attemptedRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "accepting" | "accepted" | "error">("idle");
  const [message, setMessage] = useState("Checking invite...");

  const token = useMemo(() => {
    const value = params?.token;
    return Array.isArray(value) ? value[0] : value;
  }, [params]);

  useEffect(() => {
    if (isLoading || isAuthenticated || !token) return;
    router.replace(`/login?redirect=${encodeURIComponent(`/join/${token}`)}`);
  }, [isAuthenticated, isLoading, router, token]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || !token || attemptedRef.current) return;

    attemptedRef.current = true;
    setStatus("accepting");
    setMessage("Joining workspace...");

    acceptInvitation({ token })
      .then((result) => {
        setStatus("accepted");
        setMessage(`You joined ${result.workspaceName} as ${result.roleLabel.toLowerCase()}.`);
        window.setTimeout(() => router.replace("/app"), 900);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "This invite could not be accepted.");
      });
  }, [acceptInvitation, isAuthenticated, isLoading, router, token]);

  const icon =
    status === "accepted" ? (
      <CheckCircle2 aria-hidden="true" className="h-8 w-8 text-emerald-600" />
    ) : status === "error" ? (
      <ShieldAlert aria-hidden="true" className="h-8 w-8 text-rose-600" />
    ) : (
      <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-violet-700" />
    );

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_50%_0%,rgba(124,58,237,0.12),transparent_32%),#faf8f4] px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex justify-center">
          <VoxandraLogo />
        </div>
        <div className="mt-8 flex justify-center">{icon}</div>
        <h1 className="mt-4 text-2xl font-semibold text-stone-950">Workspace invite</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">{message}</p>

        {status === "error" ? (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/login?mode=signIn"
              className="inline-flex rounded-md bg-[#3b1676] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2e1065]"
            >
              Sign in again
            </Link>
            <Link
              href="/"
              className="inline-flex rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              Go home
            </Link>
          </div>
        ) : status === "accepted" ? (
          <Link
            href="/app"
            className="mt-6 inline-flex rounded-md bg-[#3b1676] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2e1065]"
          >
            Open workspace
          </Link>
        ) : null}
      </section>
    </main>
  );
}
