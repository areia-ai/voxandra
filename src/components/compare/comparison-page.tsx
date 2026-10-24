import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Info,
} from "lucide-react";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";
import { ComparisonStructuredData } from "./structured-data";
import type { ComparisonPageData, ComparisonSource } from "./types";

const confidenceClasses: Record<ComparisonSource["confidence"], string> = {
  High: "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-border)]",
  Medium: "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)] border-[var(--status-warning-border)]",
  Low: "bg-[var(--status-info-bg)] text-[var(--status-info-text)] border-[var(--status-info-border)]",
};

// Shared shell for every "Voxandra vs {Competitor}" page. A new comparison
// only needs a new ComparisonPageData object under compare/competitors/ —
// this template stays untouched.
export function ComparisonPage({ data }: { data: ComparisonPageData }) {
  return (
    <main className="min-h-screen overflow-hidden bg-[#faf8f4] text-stone-950">
      <div className="bg-[radial-gradient(circle_at_75%_12%,rgba(124,58,237,0.12),transparent_34%),linear-gradient(180deg,#fffaf4_0%,#faf8f4_62%,#faf8f4_100%)]">
        <LandingHeader />

        <section className="mx-auto max-w-4xl px-5 pb-12 pt-4 md:px-8 md:pb-16 md:pt-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#6d28d9]">
            {data.heroKicker}
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight text-stone-950 md:text-5xl">
            Voxandra vs{" "}
            <span className="font-serif italic text-stone-800">{data.competitorName}</span>
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600">{data.heroSubhead}</p>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-1.5 text-xs font-semibold text-stone-600 shadow-sm">
            <Calendar aria-hidden="true" className="h-3.5 w-3.5 text-[#6d28d9]" />
            Last verified {data.lastVerified} · {data.recheckCadence}
          </div>

          {/* Canonical product definition, reused verbatim across the site so
              AI engines converge on one quotable phrasing. */}
          <p className="mt-6 text-base leading-7 text-stone-600">
            Voxandra translates multilingual business calls and turns them into
            reviewed call records: AI notes, transcripts, extracted details, reminders,
            contacts, and work threads.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/login?redirect=/app/dialer"
              className="inline-flex items-center gap-2 rounded-md bg-[#3b1676] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/15 transition hover:bg-[#2e1065]"
            >
              Try the free call
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href="/#pricing"
              className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-50"
            >
              See Voxandra pricing
            </Link>
          </div>
        </section>
      </div>

      <section className="mx-auto max-w-4xl px-5 md:px-8">
        <div className="rounded-2xl border border-[#6d28d9]/20 bg-white p-6 shadow-sm md:p-7">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f4efff] text-[#6d28d9]">
              <Info aria-hidden="true" className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-stone-950">Quick verdict</h2>
              <p className="mt-2 text-base leading-7 text-stone-600">{data.quickVerdict}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
        <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
          What {data.competitorShortName} offers
        </h2>
        <p className="mt-4 text-base leading-7 text-stone-600">{data.offerIntro}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {data.offerItems.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <p className="font-semibold leading-6 text-stone-950">{item.title}</p>
              <p className="mt-2 text-sm leading-6 text-stone-600">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-[var(--status-warning-text)]">
            Recording and retention posture
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--status-warning-text)]">
            {data.recordingPosture}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
        <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
          Where {data.competitorShortName} is genuinely stronger
        </h2>
        <p className="mt-4 text-base leading-7 text-stone-600">{data.strongerIntro}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {data.strongerPoints.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-stone-200 bg-stone-50/70 p-5"
            >
              <p className="font-semibold leading-6 text-stone-950">{item.title}</p>
              <p className="mt-2 text-sm leading-6 text-stone-600">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
        <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
          Where Voxandra differentiates
        </h2>
        <p className="mt-4 text-base leading-7 text-stone-600">{data.advantageIntro}</p>

        <div className="mt-8 grid gap-4">
          {data.voxandraAdvantages.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-5 shadow-sm shadow-emerald-950/5"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm">
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                </span>
                <div>
                  <p className="font-semibold leading-6 text-emerald-950">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-emerald-800">{item.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-16">
        <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
          Voxandra vs {data.competitorShortName}, side by side
        </h2>

        <div className="mt-8 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50">
                <th className="px-5 py-4 font-bold text-stone-950">Dimension</th>
                <th className="px-5 py-4 font-bold text-stone-950">
                  {data.competitorShortName}
                </th>
                <th className="px-5 py-4 font-bold text-[#3b1676]">Voxandra</th>
              </tr>
            </thead>
            <tbody>
              {data.comparisonRows.map((row, index) => (
                <tr
                  key={row.dimension}
                  className={index % 2 === 1 ? "bg-stone-50/60" : undefined}
                >
                  <td className="border-t border-stone-200 px-5 py-4 align-top font-semibold text-stone-900">
                    {row.dimension}
                  </td>
                  <td className="border-t border-stone-200 px-5 py-4 align-top leading-6 text-stone-600">
                    {row.competitor}
                  </td>
                  <td className="border-t border-stone-200 bg-[#f4efff]/40 px-5 py-4 align-top leading-6 text-stone-800">
                    {row.voxandra}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-16">
        <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
          Pricing and licensing
        </h2>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-6 shadow-sm">
            <h3 className="text-lg font-bold text-stone-950">{data.pricingCompetitor.title}</h3>
            <ul className="mt-4 grid gap-3 text-sm leading-6 text-stone-600">
              {data.pricingCompetitor.points.map((point) => (
                <li key={point} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            {data.pricingCompetitor.caveat && (
              <p className="mt-4 text-xs leading-5 text-stone-500">{data.pricingCompetitor.caveat}</p>
            )}
          </div>

          <div className="rounded-2xl border border-[#6d28d9]/20 bg-white p-6 shadow-lg shadow-violet-950/10 ring-1 ring-[#6d28d9]/10">
            <h3 className="text-lg font-bold text-stone-950">{data.pricingVoxandra.title}</h3>
            <ul className="mt-4 grid gap-3 text-sm leading-6 text-stone-600">
              {data.pricingVoxandra.points.map((point) => (
                <li key={point} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6d28d9]" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <Link
              href={data.pricingVoxandra.href ?? "/#pricing"}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#3b1676] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2e1065]"
            >
              {data.pricingVoxandra.ctaText ?? "See current pricing"}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
        <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
          Missing or unclear from {data.competitorShortName}
        </h2>
        <p className="mt-4 text-base leading-7 text-stone-600">{data.missingIntro}</p>

        <ul className="mt-6 grid gap-3 rounded-2xl border border-stone-200 bg-white p-6 text-sm leading-6 text-stone-600 shadow-sm md:p-7">
          {data.missingItems.map((item) => (
            <li key={item} className="flex gap-3">
              <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6d28d9]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
        <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
          Sources
        </h2>
        <p className="mt-4 text-sm leading-6 text-stone-500">
          Every claim about {data.competitorShortName} above traces to one of these sources,
          checked as of {data.lastVerified}. Official sources are preferred; third-party
          figures are labeled accordingly.
        </p>

        <ul className="mt-6 grid gap-3">
          {data.sources.map((source) => (
            <li
              key={source.url}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-sm"
            >
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[#2e1065] transition hover:text-[#6d28d9]"
              >
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{source.label}</span>
              </a>
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClasses[source.confidence]}`}
              >
                {source.confidence} confidence
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-5 pb-16 md:px-8 lg:pb-20">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-[#3b1676] p-8 text-center text-white shadow-2xl shadow-violet-950/20 md:p-12">
          <h2 className="text-3xl font-semibold leading-tight md:text-4xl">
            Make the call. Review the record.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-violet-100 md:text-lg">
            See how Voxandra turns a live browser call into an AI note, follow-ups,
            contacts, and a work thread your team can use.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/login?redirect=/app/dialer"
              className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-[#2e1065] shadow-lg shadow-violet-950/20 transition hover:bg-[#fff7ed]"
            >
              Try the free call
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
      <ComparisonStructuredData data={data} />
    </main>
  );
}
