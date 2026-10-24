import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { VoxandraLogo } from "@/components/brand/voxandra-logo";

export const POLICY_UPDATED_DATE = "August 23, 2026";
export const POLICY_CONTACT_EMAIL = "contact@voxandra.com";

type PolicySection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
};

type PolicyPageProps = {
  title: string;
  description: string;
  sections: PolicySection[];
};

export function PolicyPage({ title, description, sections }: PolicyPageProps) {
  return (
    <main className="min-h-screen bg-[#faf8f4] px-5 py-8 text-stone-950 md:px-8 md:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-col gap-6 border-b border-stone-200 pb-8 sm:flex-row sm:items-center sm:justify-between">
          <VoxandraLogo href="/" showTagline />
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-[#2e1065] shadow-sm transition hover:border-[#3b1676]/25 hover:text-[#6d28d9]"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to home
          </Link>
        </header>

        <section className="py-10 md:py-12">
          <p className="text-sm font-bold tracking-[0.04em] text-[#6d28d9]">
            Last updated: {POLICY_UPDATED_DATE}
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-stone-950 md:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-stone-600 md:text-lg md:leading-8">
            {description}
          </p>
        </section>

        <div className="grid gap-6 pb-12">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm md:p-7"
            >
              <h2 className="text-xl font-bold text-stone-950">{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-4 text-sm leading-7 text-stone-600 md:text-base">
                  {paragraph}
                </p>
              ))}
              {section.items && (
                <ul className="mt-4 grid gap-3 text-sm leading-7 text-stone-600 md:text-base">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6d28d9]"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <footer className="border-t border-stone-200 py-8 text-sm leading-6 text-stone-500">
          Questions about these policies can be sent to{" "}
          <a className="font-semibold text-[#2e1065]" href={`mailto:${POLICY_CONTACT_EMAIL}`}>
            {POLICY_CONTACT_EMAIL}
          </a>
          .
        </footer>
      </div>
    </main>
  );
}
