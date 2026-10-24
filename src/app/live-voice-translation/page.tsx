import { getPublicVoiceTranslationLanguages } from "@/lib/live-translation-languages";
import type { Metadata } from "next";
import Link from "next/link";
import { TranslationLandingAnalytics } from "@/components/landing/translation-analytics";
import { ArrowRight, FileCheck2, Headphones, Languages, PhoneCall, ShieldCheck } from "lucide-react";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";

export const metadata: Metadata = {
  title: "Live Voice Translation for Business Calls",
  description:
    "Two people speak different languages on a normal phone call. Voxandra translates both sides aloud, provides private Guidance, and creates a reviewed bilingual Call Record.",
  alternates: { canonical: "/live-voice-translation" },
};

const steps = [
  { icon: PhoneCall, title: "Call their normal number", text: "The other person answers a regular phone call. They don't install Voxandra or create an account." },
  { icon: Languages, title: "Each side speaks naturally", text: "You choose both languages before dialing. Your speech reaches them translated, and their reply comes back in your language." },
  { icon: Headphones, title: "Get private Guidance", text: "Voxandra can flag a missing date, commitment, identifier, or next step while the translated conversation is still happening." },
  { icon: FileCheck2, title: "Review the Call Record", text: "After the call, review the original and translated transcript, AI note, extracted details, reminders, contacts, and work-thread context." },
];

export default function LiveVoiceTranslationPage() {
  const languages = getPublicVoiceTranslationLanguages();
  return (
    <main className="min-h-screen bg-[#faf8f4] text-stone-950">
      <TranslationLandingAnalytics />
      <LandingHeader />
      <section className="border-b border-stone-200 bg-[radial-gradient(circle_at_78%_16%,rgba(34,197,94,0.12),transparent_32%),radial-gradient(circle_at_25%_10%,rgba(124,58,237,0.12),transparent_30%)]">
        <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-24">
          <p className="text-sm font-semibold uppercase tracking-wide text-violet-700">Live Voice Translation</p>
          <h1 className="mt-4 max-w-4xl text-5xl font-semibold leading-[1.02] md:text-7xl">
            Two languages. One business call.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-stone-600 md:text-xl">
            Voxandra translates both sides of a live phone conversation aloud. You speak your language, the person you called hears theirs, and nobody has to switch apps or join a meeting link.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login?redirect=/app/dialer" className="inline-flex items-center gap-2 rounded-md bg-[#3b1676] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2e1065]">
              Start a translated call <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link href="/#pricing" className="inline-flex items-center rounded-md border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-800 hover:bg-stone-50">See plans</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-20">
        <h2 className="max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">What happens inside a translated call</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {steps.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
              <Icon aria-hidden="true" className="h-6 w-6 text-violet-700" />
              <h3 className="mt-4 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-stone-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:px-8 lg:grid-cols-2 lg:py-20">
          <div>
            <ShieldCheck aria-hidden="true" className="h-7 w-7 text-emerald-400" />
            <h2 className="mt-4 text-3xl font-semibold">The caller stays in control</h2>
            <p className="mt-4 text-base leading-7 text-stone-300">
              The called person hears a spoken disclosure before translated conversation begins. Voxandra keeps raw audio only while it creates the Call Record, then deletes the transient provider recordings. There is no customer audio player or download.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-400">Available languages</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {languages.map(({ code, label }) => <span key={code} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-stone-200">{label}</span>)}
            </div>
            <p className="mt-5 text-sm leading-6 text-stone-400">Choose both languages before the call. Automatic language detection is not used for spoken translation.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-20">
        <h2 className="max-w-3xl text-3xl font-semibold md:text-5xl">Made for international work that still happens by phone</h2>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-stone-600">Freight forwarding and customs, import-export and sourcing, international sales, supplier follow-up, relocation cases, customer support, claims, and verification work all depend on details that can disappear once the call ends. Translation opens the conversation; the reviewed Call Record keeps the work moving.</p>
      </section>
      <LandingFooter />
    </main>
  );
}
