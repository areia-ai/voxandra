import Link from "next/link";
import { VoxandraLogo } from "@/components/brand/voxandra-logo";
import { comparisonPages } from "@/components/compare/competitors";

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/acceptable-use", label: "Acceptable use" },
];

export function LandingFooter() {
  return (
    <footer className="border-t border-stone-200/80 bg-[#fffaf4] px-5 py-10 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.1fr_0.8fr_0.8fr_0.9fr] md:items-start">
        <div>
          <VoxandraLogo href="/" showTagline tagline="Multilingual business calls" />
          <p className="mt-4 max-w-sm text-sm leading-6 text-stone-600">
            Live Voice Translation, private guidance, and reviewed Call Records.
          </p>
          <p className="mt-4 text-xs font-medium text-stone-500">
            Copyright 2026 Areia Labs. Voxandra is a product of Areia Labs.
          </p>
        </div>

        {comparisonPages.length > 0 && (
          <nav aria-label="Compare" className="grid gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
              Compare
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 md:grid md:gap-2">
              {comparisonPages.map((item) => (
                <Link
                  key={item.slug}
                  href={`/compare/${item.slug}`}
                  className="text-sm font-semibold text-[#2e1065] transition hover:text-[#6d28d9]"
                >
                  vs {item.competitorName}
                </Link>
              ))}
            </div>
          </nav>
        )}

        <nav aria-label="Legal" className="grid gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
            Policies
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 md:grid md:gap-2">
            {legalLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-semibold text-[#2e1065] transition hover:text-[#6d28d9]"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="grid gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
            Company
          </p>
          <Link
            href="/blog"
            className="text-sm font-semibold text-[#2e1065] transition hover:text-[#6d28d9]"
          >
            Blog
          </Link>
          <a
            href="mailto:contact@voxandra.com"
            className="text-sm font-semibold text-[#2e1065] transition hover:text-[#6d28d9]"
          >
            contact@voxandra.com
          </a>
          <a
            href="https://areialabs.org/"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-[#2e1065] transition hover:text-[#6d28d9]"
          >
            Made by Areia Labs
          </a>
        </div>
      </div>
    </footer>
  );
}
