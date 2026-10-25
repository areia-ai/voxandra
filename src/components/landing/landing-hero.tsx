import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";
import { OPEN_SOURCE_LICENSE_NAME, OPEN_SOURCE_REPO_URL } from "@/lib/open-source";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingDialer } from "@/components/landing/landing-dialer";
import { GitHubMark, LearnMoreChevron } from "@/components/landing/landing-icons";

const openSourceBadgeText = `Open source · ${OPEN_SOURCE_LICENSE_NAME}`;

export function LandingHero() {
  return (
    <section className="border-b landing-rule bg-[linear-gradient(135deg,#fffaf4,#f6f1fa)]">
      <LandingHeader />
      <div className="mx-auto grid max-w-7xl items-start gap-9 px-5 pb-14 pt-8 md:px-8 md:py-16 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:pb-20 lg:pt-12">
        {/* CSS keyframe entrance (globals.css) so it plays before hydration. */}
        <div className="landing-hero-enter min-w-0">
          <a
            href={OPEN_SOURCE_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="t-learn inline-flex max-w-full items-center gap-2 rounded-full border border-[#3b1676]/15 bg-white/60 py-1.5 pl-2.5 pr-2 text-[#3b1676] transition-colors hover:border-[#3b1676]/30 hover:bg-white/90"
          >
            <GitHubMark className="h-3.5 w-3.5 shrink-0" />
            <span className="t-shimmer landing-eyebrow" data-text={openSourceBadgeText}>{openSourceBadgeText}</span>
            <LearnMoreChevron className="h-3.5 w-3.5" />
          </a>
          <p className="landing-eyebrow mt-7">AI translation for business calls</p>
          <h1 className="mt-4 max-w-xl text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-stone-950 sm:text-[4rem] lg:text-[clamp(4.75rem,7vw,6rem)]">
            Speak your language.{" "}
            <span className="mt-4 block font-editorial font-medium italic leading-[0.98] tracking-[-0.03em] lg:mt-5">Do business <br className="hidden lg:block" />in theirs.</span>
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
        <div className="landing-hero-enter-late min-w-0">
          <LandingDialer />
        </div>
      </div>
    </section>
  );
}
