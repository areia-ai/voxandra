"use client";

import Link from "next/link";
import { useEffect } from "react";
import { X } from "lucide-react";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";

type SignupCallModalProps = {
  open: boolean;
  phoneNumber: string;
  onClose: () => void;
};

export function SignupCallModal({ open, phoneNumber, onClose }: SignupCallModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const normalizedNumber = phoneNumber.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        aria-modal="true"
        role="dialog"
        aria-labelledby="signup-call-title"
        aria-describedby="signup-call-description"
        className="w-full max-w-md rounded-2xl border border-white/70 bg-[#fffaf4] p-5 shadow-2xl shadow-violet-950/25"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[#6d28d9]">
              {publicTranslatedTrialEnabled() ? "Free 90-second translated call" : "Free 90-second standard call"}
            </p>
            <h2 id="signup-call-title" className="mt-2 text-2xl font-semibold text-stone-950">
              Sign in to start your call
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
            aria-label="Close"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        {normalizedNumber ? (
          <p className="mt-4 rounded-xl border border-[#22c55e]/40 bg-[#f0fdf4] px-4 py-3 text-sm font-semibold text-[#15803d]">
            Ready to call {normalizedNumber}?
          </p>
        ) : null}

        <div className="mt-4 space-y-2">
          <p id="signup-call-description" className="text-sm leading-6 text-stone-600">
            Choose both languages after sign-in. The other person answers a
            normal phone call and needs no app.
          </p>
          <p className="text-xs text-stone-500">
            {publicTranslatedTrialEnabled() ? "Sign in with your email and choose both languages. The free trial includes two-way spoken translation and a Call Record, with no card or subscription. Live Guidance stays off; the 90-second limit includes setup and the introduction." : "Live Guidance and Live Translation are paid features; the free call still creates the post-call record for review. Translated calls are included on every paid plan once your workspace exists."}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/login?redirect=/app/dialer&number=${encodeURIComponent(normalizedNumber)}`}
            className="inline-flex items-center justify-center rounded-md bg-[#3b1676] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2e1065]"
          >
            Create free account
          </Link>
          <Link
            href={`/login?redirect=/app/dialer&number=${encodeURIComponent(normalizedNumber)}`}
            className="inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:border-stone-400"
          >
            Sign in
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold text-stone-500 transition hover:bg-stone-100 hover:text-stone-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
