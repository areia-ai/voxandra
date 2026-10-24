"use client";

import { useState } from "react";
import Link from "next/link";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";
import { ArrowRight, ChevronDown } from "lucide-react";
import { faqItems } from "./faq-data";

export function PricingFAQ() {
  const [openItemId, setOpenItemId] = useState<string | null>(
    "what-is-voxandra",
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#6d28d9]">
          FAQ
        </p>
        <h3 className="mt-3 text-3xl font-semibold leading-tight text-stone-950 md:text-4xl">
          Frequently asked questions
        </h3>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-stone-600">
          What to know before your first call.
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-stone-200/80 bg-white shadow-sm">
        {faqItems.map((item) => {
          const isOpen = openItemId === item.id;
          const answerId = `pricing-faq-answer-${item.id}`;

          return (
            <div
              key={item.id}
              className="border-b border-stone-200/80 last:border-b-0"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={answerId}
                onClick={() => setOpenItemId(isOpen ? null : item.id)}
                className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left md:px-6 md:py-4"
              >
                <span className="text-sm font-semibold leading-6 text-stone-950 md:text-base">
                  {item.question}
                </span>
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-200 ease-out ${
                    isOpen
                      ? "rotate-180 bg-[#f4efff] text-[#6d28d9]"
                      : "text-stone-400"
                  }`}
                >
                  <ChevronDown className="h-5 w-5" />
                </span>
              </button>
              {/* Answers stay in the DOM when closed (CSS grid collapse, not
                  unmount) so AI crawlers — which don't run JS — see the full
                  Q&A text in the server-rendered HTML. */}
              <div
                id={answerId}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-sm leading-6 text-stone-600 md:px-6 md:pb-6">
                    {item.answer}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mx-auto mt-6 flex max-w-2xl flex-col items-center justify-between gap-3 rounded-xl border border-[#6d28d9]/15 bg-white px-5 py-4 text-center shadow-sm sm:flex-row sm:text-left">
        <p className="text-sm leading-6 text-stone-600">
          Still deciding?
        </p>
        <div className="flex shrink-0 flex-col items-center gap-2 sm:items-end">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/login?redirect=/app/dialer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#3b1676] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2e1065]"
            >
              Start a translated call
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <a
              href="mailto:contact@voxandra.com?subject=Voxandra%20question"
              className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-50"
            >
              Ask a question
            </a>
          </div>
          <p className="text-xs text-stone-400">
            {publicTranslatedTrialEnabled() ? "Sign in to try one free 90-second translated call. No card required." : "Create a workspace, pick a plan, dial."}
          </p>
        </div>
      </div>
    </div>
  );
}
