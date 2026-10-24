"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import type { TopUpId } from "@/lib/billing/config";
import { callsOnlyPlan, topUpPlans } from "@/lib/pricing";
import { captureProductEvent } from "@/lib/analytics";

const DEFAULT_TOP_UP_ID: TopUpId = "topup_25";

export function CallsOnlyCreditCard() {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTopUpId, setSelectedTopUpId] = useState<TopUpId>(DEFAULT_TOP_UP_ID);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!modalOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModalOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  function openModal() {
    setSelectedTopUpId(DEFAULT_TOP_UP_ID);
    setError("");
    setModalOpen(true);
  }

  function closeModal() {
    if (loading) return;
    setModalOpen(false);
    setError("");
  }

  async function startCheckout() {
    if (loading) return;

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/stripe/public-checkout/top-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topUpId: selectedTopUpId }),
      });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        throw new Error(result.error || "Could not open Stripe checkout.");
      }

      captureProductEvent("checkout_started", { destination: "public_top_up" });
      window.location.href = result.url;
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Could not open Stripe checkout."
      );
      setLoading(false);
    }
  }

  return (
    <>
      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-stone-950">
              {callsOnlyPlan.name} · {callsOnlyPlan.priceLabel}
            </h3>
            <p className="mt-1 text-sm text-stone-600">
              {callsOnlyPlan.description}
            </p>
          </div>
          <button
            type="button"
            onClick={openModal}
            className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50"
          >
            {callsOnlyPlan.ctaText}
          </button>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6 backdrop-blur-sm"
          role="presentation"
          onMouseDown={closeModal}
        >
          <div
            aria-modal="true"
            role="dialog"
            aria-labelledby="calls-only-credits-title"
            aria-describedby="calls-only-credits-description"
            className="w-full max-w-lg rounded-2xl border border-white/70 bg-[#fffaf4] p-5 shadow-2xl shadow-violet-950/25"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-[#6d28d9]">
                  Calls only
                </p>
                <h2
                  id="calls-only-credits-title"
                  className="mt-2 text-2xl font-semibold text-stone-950"
                >
                  Choose calling credits
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md p-2 text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 disabled:cursor-wait disabled:opacity-50"
                aria-label="Close"
                disabled={loading}
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <p
                id="calls-only-credits-description"
                className="text-sm leading-6 text-stone-600"
              >
                Buy credits for browser calls. After payment, create or sign in to a
                Voxandra account to claim them.
              </p>
              <p className="text-xs text-stone-500">
                Top-up credits never expire. Destination rates are shown before calling.
              </p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {topUpPlans.map((topUp) => {
                const selected = topUp.id === selectedTopUpId;

                return (
                  <button
                    key={topUp.id}
                    type="button"
                    onClick={() => setSelectedTopUpId(topUp.id)}
                    className={`flex min-h-20 items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                      selected
                        ? "border-[#6d28d9] bg-white text-stone-950 shadow-sm shadow-violet-950/10"
                        : "border-stone-200 bg-white/70 text-stone-700 hover:border-stone-300 hover:bg-white"
                    }`}
                    aria-pressed={selected}
                  >
                    <span>
                      <span className="block text-lg font-semibold">{topUp.label}</span>
                      <span className="mt-1 block text-xs font-medium text-stone-500">
                        Calling credits
                      </span>
                    </span>
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                        selected
                          ? "border-[#6d28d9] bg-[#6d28d9] text-white"
                          : "border-stone-300 text-transparent"
                      }`}
                    >
                      <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>

            {error ? (
              <p className="mt-4 text-sm font-medium leading-5 text-rose-600">{error}</p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void startCheckout()}
                disabled={loading}
                className="inline-flex items-center justify-center rounded-md bg-[#3b1676] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2e1065] disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? "Opening checkout..." : "Continue to Stripe"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                disabled={loading}
                className="inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:border-stone-400 disabled:cursor-wait disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
