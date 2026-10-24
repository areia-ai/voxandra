import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Languages, Lightbulb, NotebookPen } from "lucide-react";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";
import { getPublicVoiceTranslationLanguages } from "@/lib/live-translation-languages";
import { LandingHero } from "@/components/landing/landing-hero";
import { HomeStructuredData } from "@/components/landing/structured-data";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { McpSection } from "@/components/landing/mcp-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { PricingSection } from "@/components/landing/pricing-section";
import { newsreader } from "@/components/landing/editorial-font";

const benefits = [
  { title: "Be understood", description: "Speak naturally. They hear your words in their language, and you hear their reply in yours.", icon: Languages },
  { title: "Know what to ask", description: "Private live prompts help you check the details before you hang up.", icon: Lightbulb },
  { title: "Keep what matters", description: "Get notes, key details, and follow-ups ready for your review. Leave with a reviewed Call Record.", icon: NotebookPen },
];
const industryLanes = [
  { title: "Moving goods", description: "Freight forwarding & customs · Import, export & sourcing · Supplier & payment follow-up", image: "/landing/business/moving-goods-v1.webp", alt: "Illustrative scene of a supplier coordinator on a laptop call beside a warehouse." },
  { title: "Moving deals", description: "International sales · Customer onboarding · Compliance-heavy support", image: "/landing/business/moving-deals-v1.webp", alt: "Illustrative scene of an exporter speaking with a customer from a materials showroom." },
  { title: "Moving cases", description: "Relocation & immigration · Insurance & claims · Background verification", image: "/landing/business/moving-cases-v1.webp", alt: "Illustrative scene of a case coordinator checking details during a laptop call." },
];

export function FullLandingPage() {
  const languages = getPublicVoiceTranslationLanguages();
  return (
    <main className={`${newsreader.variable} min-h-screen overflow-x-clip bg-[#faf8f4] text-stone-950`}>
      <HomeStructuredData />
      <LandingHero />
      <section aria-label="What Voxandra does" className="border-b landing-rule">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 md:grid-cols-3 md:gap-10 md:px-8 md:py-16">
          {benefits.map(({ title, description, icon: Icon }) => <article key={title}>
            <Icon aria-hidden="true" className="h-5 w-5 text-violet-800" />
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h2>
            <p className="mt-2 max-w-sm text-base leading-7 text-stone-600">{description}</p>
          </article>)}
        </div>
      </section>
      <HowItWorksSection />
      <section id="business-uses" className="scroll-mt-24 border-y landing-rule bg-white/50">
        <div className="mx-auto max-w-7xl px-5 py-12 md:px-8 md:py-16">
          <h2 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight md:text-4xl">Business doesn’t stop at a language barrier.</h2>
          <div className="mt-8 grid gap-6 border-b landing-rule pb-8 sm:grid-cols-3 sm:gap-5 lg:gap-8">
            {industryLanes.map(({ title, description, image, alt }) => <article key={title} className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-4 sm:block">
              <Image src={image} alt={alt} width={1200} height={800} sizes="(max-width: 639px) 96px, (max-width: 1279px) 33vw, 400px" className="aspect-square w-24 rounded-xl object-cover object-[60%_center] sm:aspect-[16/10] sm:w-full" />
              <div className="sm:mt-4">
                <h3 className="text-lg font-semibold text-stone-900">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
              </div>
            </article>)}
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
            <div>
              <h3 className="text-lg font-semibold">Choose your languages</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">{languages.length} languages available for either side of the call.</p>
              <p className="mt-3 text-sm leading-7 text-stone-600">{languages.map(({ label }) => label).join(" · ")}</p>
              <Link href="/live-voice-translation" className="mt-3 inline-flex text-sm font-semibold text-violet-800 underline underline-offset-4">About translated calls</Link>
            </div>
            <div>
              <h3 className="text-lg font-semibold">You stay in control</h3>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-stone-600">
                <li>Both people hear a spoken notice before translation begins.</li>
                <li>You review and correct the AI draft before it updates the team record.</li>
                <li>Transient audio is deleted after processing. No retained audio playback.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <PricingSection />
      <McpSection />
      <section id="start-calling" aria-labelledby="closing-cta-heading" className="scroll-mt-24 border-t landing-rule bg-[#f3effb]">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-5 py-12 md:px-8 md:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
          <div className="min-w-0">
            <h2 id="closing-cta-heading" className="max-w-3xl text-4xl font-semibold leading-[1.12] tracking-tight md:text-5xl">Your next business call,<br className="hidden sm:block" /> <span className="font-editorial font-medium italic">in their language.</span></h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-stone-600">Nothing for them to install. Important details ready for your review.</p>
            <Link href="/login?redirect=/app/dialer" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-[#3b1676] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2e1065]">Start a translated call <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
            <p className="mt-4 max-w-lg text-sm leading-6 text-stone-500">{publicTranslatedTrialEnabled() ? "Sign in, choose both languages, and try one free 90-second translated call. No card required." : "Create a workspace, choose a paid plan, and pick both languages. Try a free standard call first."}</p>
          </div>
          <Image src="/landing/business/final-cta-international-flags-v2.webp" alt="Illustrative scene of a business owner on a laptop call, surrounded by a border of international flags." width={1600} height={1195} sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) 576px, (max-width: 1279px) 45vw, 550px" className="mx-auto h-auto w-full max-w-xl rounded-2xl lg:rounded-3xl" />
        </div>
      </section>
      <LandingFooter />
    </main>
  );
}
