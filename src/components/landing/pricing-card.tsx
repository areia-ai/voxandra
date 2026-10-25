import { PricingCheckoutButton } from "./pricing-checkout-button";
import type { PublicPricingPlan } from "@/lib/pricing";

export function PricingCard({
  name, price, priceLabel, period, seats, credits, liveFeatureCallouts,
  badge, featured = false, ctaText, ctaHref, publicCheckout,
}: PublicPricingPlan) {
  return (
    <div className={`relative flex h-full flex-col rounded-2xl border p-5 md:p-6 ${
      featured ? "border-violet-700 bg-white ring-1 ring-violet-700/20" : "border-[var(--landing-line)] bg-[var(--landing-surface)]"
    }`}>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-stone-950">{name}</h3>
        {badge && <span className="text-xs font-semibold text-violet-700">{badge}</span>}
      </div>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight text-stone-950">{price ?? priceLabel}</span>
        {period && <span className="text-sm text-stone-500">{period}</span>}
      </div>
      {seats && <p className="mt-3 text-sm font-semibold text-stone-900">{seats}</p>}
      {credits && <p className="mt-1 text-sm leading-5 text-stone-600">{credits}</p>}
      <dl className="my-5 grid gap-3 border-t border-[var(--landing-line)] pt-4">
        {liveFeatureCallouts?.map((callout) => (
          <div key={callout.title}>
            <dt className="text-sm font-medium text-stone-900">{callout.title}</dt>
            <dd className="mt-0.5 text-xs leading-5 text-stone-500">{callout.usage}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto pt-1">
        <PricingCheckoutButton
          checkout={publicCheckout}
          href={ctaHref}
          className={`flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
            featured ? "bg-[#3b1676] text-white hover:bg-[#2e1065]" : "border border-stone-300 text-stone-900 hover:bg-stone-50"
          }`}
        >
          {ctaText}
        </PricingCheckoutButton>
      </div>
    </div>
  );
}
