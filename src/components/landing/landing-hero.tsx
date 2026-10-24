import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingDialer } from "@/components/landing/landing-dialer";

export function LandingHero() {
  return (
    <section className="border-b landing-rule bg-[linear-gradient(135deg,#fffaf4,#f6f1fa)]">
      <LandingHeader />
      <div className="mx-auto grid max-w-7xl items-start gap-9 px-5 pb-12 pt-8 md:px-8 md:py-14 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:py-12">
        <div className="min-w-0">
          <p className="landing-eyebrow">AI translation for business calls</p>
          <h1 className="mt-5 max-w-xl text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.04em] text-stone-950 sm:text-6xl lg:text-[clamp(4.5rem,6.5vw,5.5rem)] lg:leading-[1.02]">
            Speak your language.{" "}
            <span className="mt-4 block font-editorial font-medium italic leading-[1.06] tracking-[-0.025em] lg:mt-5">Do business <br className="hidden lg:block" />in theirs.</span>
          </h1>
          <p className="mt-7 max-w-lg text-base leading-7 text-stone-700 md:mt-8 md:text-lg md:leading-8">
            Voxandra translates both sides of your phone call, privately suggests
            what to ask, and captures the important details for you to review.
          </p>
          <Link href="/login?redirect=/app/dialer" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[#3b1676] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2e1065] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-700">
            Start a translated call <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-6 text-stone-500">
            {publicTranslatedTrialEnabled()
              ? "Sign in, choose both languages, and try one free 90-second translated call. No card required."
              : "Create a workspace, choose a paid plan, and pick both languages. Try a free standard call first."}
          </p>
          <p className="mt-7 text-sm font-medium text-stone-700">The person you call needs no app.</p>
        </div>
        <LandingDialer />
      </div>
    </section>
  );
}
