import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";
import { CallsOnlyCreditCard } from "./calls-only-credit-card";
import { PricingCard } from "./pricing-card";
import { PricingFAQ } from "./pricing-faq";
import { enterprisePlan, publicMemoryPlans } from "@/lib/pricing";

export function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-24 bg-[#faf8f4] py-12 md:py-16">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="text-center">
          <p className="landing-eyebrow">Pricing</p>
          <h2 className="mx-auto mt-4 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-[-0.025em] text-stone-950 md:text-5xl">
            Every feature. <span className="font-editorial italic">Choose your volume.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-stone-600">
            Every paid plan includes Live Voice Translation, Guidance, and Call Records.
          </p>
          <p className="mt-2 text-sm text-stone-500">
            {publicTranslatedTrialEnabled() ? "Sign in for one free 90-second translated call. No card required." : "Try one free 90-second standard call. No card required."}
          </p>
        </div>

        <div className="mt-8 flex snap-x gap-4 overflow-x-auto overscroll-x-contain pb-3 [scrollbar-width:none] md:grid md:grid-cols-2 md:overflow-visible md:pb-0 xl:grid-cols-4">
          {publicMemoryPlans.map((tier) => (
            <div key={tier.name} className="h-full w-[82vw] max-w-[22rem] shrink-0 snap-start md:w-auto md:max-w-none md:min-w-0">
              <PricingCard {...tier} />
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-3 border-b landing-rule pb-6 text-sm leading-6 text-stone-600 md:grid-cols-[10rem_1fr] md:gap-6">
          <p className="font-semibold text-stone-900">All paid plans</p>
          <div>
            <p>Reviewed notes and transcripts · Extracted details · Pre-call briefs and templates · Contacts, reminders, and work threads.</p>
            <p className="mt-1 text-xs text-stone-500">Review before accepting. Direct email support on Starter and above.</p>
          </div>
        </div>

        <p className="mt-5 text-sm leading-6 text-stone-600">
          <span className="font-semibold text-stone-900">Need more minutes? Buy credits.</span>{" "}
          One balance covers calls and Translation or Guidance beyond your included minutes.
        </p>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          Calling rates appear before you dial. Included credits and minutes reset each billing cycle;
          purchased top-up credits never expire. Fair-use applies to live AI feature usage.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-y landing-rule py-4">
          <div>
            <h3 className="text-sm font-semibold text-stone-950">{enterprisePlan.name} · {enterprisePlan.seats}</h3>
            <p className="mt-1 text-sm text-stone-600">Custom volume, rollout, and compliance support.</p>
          </div>
          <a href={enterprisePlan.ctaHref ?? "mailto:contact@voxandra.com?subject=Voxandra%20Enterprise"} className="text-sm font-semibold text-violet-800 underline underline-offset-4">
            {enterprisePlan.ctaText}
          </a>
        </div>

        <CallsOnlyCreditCard />
        <div id="faq" className="mt-12 scroll-mt-24 border-t landing-rule pt-12 md:mt-16 md:pt-16">
          <PricingFAQ />
        </div>
      </div>
    </section>
  );
}
