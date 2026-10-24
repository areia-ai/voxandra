"use client";

import Link from "next/link";
import { PhoneCall, Sparkles } from "lucide-react";

export function DashboardCallLauncher() {
  return (
    <section className="rounded-2xl border border-violet-200/70 bg-[linear-gradient(135deg,#fffaf4_0%,#f4efff_58%,#fff7ed_100%)] p-5 shadow-sm">
      <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr] lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase text-[#6d28d9]">Start here</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-950">
            Start a call. Voxandra will capture the details.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-700">
            After the call, Voxandra extracts summaries, reference numbers, action items,
            participant roles, and follow-ups into reviewable operational records.
          </p>
        </div>

        <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-lg shadow-violet-950/8">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-stone-700">Phone number</span>
            <input
              readOnly
              value="+351 "
              className="h-12 rounded-lg border border-stone-300 bg-white px-4 font-mono text-base text-stone-950 outline-none"
              aria-label="Phone number preview"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/app/dialer"
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              <PhoneCall aria-hidden="true" className="h-4 w-4" />
              Start call
            </Link>
          </div>
          <p className="mt-4 flex items-start gap-2 text-sm leading-5 text-brand">
            <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#22c55e]" />
            Browser calling is active for 90 enabled low-risk destinations.
          </p>
        </div>
      </div>
    </section>
  );
}
