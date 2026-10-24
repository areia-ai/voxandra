"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicPricingPlan } from "@/lib/pricing";
import { captureProductEvent } from "@/lib/analytics";

type PricingCheckoutButtonProps = {
  checkout?: PublicPricingPlan["publicCheckout"];
  href?: string;
  className: string;
  children: React.ReactNode;
};

export function PricingCheckoutButton({
  checkout,
  href,
  className,
  children,
}: PricingCheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!checkout) {
    return (
      <Link href={href ?? "/login"} className={className}>
        {children}
      </Link>
    );
  }

  async function startCheckout() {
    if (!checkout || loading) return;

    setLoading(true);
    setError("");
    try {
      const endpoint =
        checkout.type === "subscription"
          ? "/api/stripe/public-checkout/subscription"
          : "/api/stripe/public-checkout/top-up";
      const body =
        checkout.type === "subscription"
          ? { planId: checkout.planId }
          : { topUpId: checkout.topUpId };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        throw new Error(result.error || "Could not open Stripe checkout.");
      }

      captureProductEvent("checkout_started", {
        destination: checkout.type === "subscription" ? "public_subscription" : "public_top_up",
      });
      window.location.href = result.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Stripe checkout.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void startCheckout()}
        disabled={loading}
        className={`${className} disabled:cursor-wait disabled:opacity-70`}
      >
        {loading ? "Opening checkout..." : children}
      </button>
      {error ? (
        <p className="mt-2 text-xs font-medium leading-5 text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
