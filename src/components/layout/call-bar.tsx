"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ACTIVE_CALL_PHASES, useGlobalCall } from "@/components/providers/call-provider";
import { NetworkQualityDot } from "@/components/dialer/network-quality-dot";
import { BridgeInactivityNotice } from "@/components/dialer/bridge-inactivity-notice";
import { formatDuration } from "@/lib/format";
import { describeLiveBridgePhase } from "@/lib/live-bridge-state";

const phaseLabel: Record<string, string> = {
  connecting: "Connecting…",
  ringing: "Ringing…",
  in_call: "In call",
  processing: "Ending call…",
};

export function CallBar() {
  const pathname = usePathname();
  const { call, toggleMute, endCall } = useGlobalCall();

  const isActive = ACTIVE_CALL_PHASES.includes(call.phase);
  // The dashboard already renders the full in-call panel inline, so the mini bar only
  // needs to appear once the user has navigated away from it mid-call.
  const shouldRender = isActive && pathname !== "/app";
  // Voice Translation: the browser leg is "in call" while the other person is
  // still ringing or hearing the disclosure — say what is really happening.
  const liveBridgeState = useQuery(
    api.translationBridge.getLiveBridgeState,
    shouldRender && call.currentCallId ? { callId: call.currentCallId } : "skip"
  );

  if (!shouldRender) return null;

  const bridgeDescription =
    call.phase === "in_call" && liveBridgeState
      ? describeLiveBridgePhase(liveBridgeState.calleePhase, call.displayName || "the other person")
      : null;
  const statusLabel = bridgeDescription?.label ?? phaseLabel[call.phase] ?? "In call";
  const showQuality = call.phase === "in_call" && (!bridgeDescription || bridgeDescription.tone === "live");

  const remaining = call.remainingSeconds;
  const lowTime = remaining !== null && remaining <= 15;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 bg-stone-950 px-4 py-2.5 text-white sm:px-6"
    >
      <Link href="/app" className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-300">
          <Phone aria-hidden="true" className="h-4 w-4 animate-pulse" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">
            {call.displayName || call.phoneNumber || "Active call"}
          </span>
          <span className="flex items-center gap-1.5 truncate text-xs text-stone-400">
            {statusLabel}
            {showQuality ? <NetworkQualityDot quality={call.networkQuality} /> : null}
          </span>
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden rounded-md bg-white/10 px-2.5 py-1.5 font-mono text-xs font-semibold sm:inline-flex">
          {formatDuration(call.elapsedSeconds)}
        </span>
        {remaining !== null ? (
          <span
            className={`hidden rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold sm:inline-flex ${
              lowTime ? "bg-amber-300/15 text-amber-100" : "bg-white/10 text-stone-200"
            }`}
          >
            −{formatDuration(remaining)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggleMute}
          disabled={call.phase !== "in_call"}
          aria-label={call.muted ? "Unmute" : "Mute"}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white transition hover:bg-white/10 disabled:opacity-40"
        >
          {call.muted ? (
            <MicOff aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Mic aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={endCall}
          disabled={call.phase === "processing" || call.phase === "connecting"}
          aria-label="End call"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-500 disabled:opacity-40"
        >
          <PhoneOff aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {call.phase === "in_call" && call.currentCallId && liveBridgeState?.inactivityDeadlineAt ? (
        <div className="w-full">
          <BridgeInactivityNotice callId={call.currentCallId} deadlineAt={liveBridgeState.inactivityDeadlineAt} />
        </div>
      ) : null}
    </div>
  );
}
