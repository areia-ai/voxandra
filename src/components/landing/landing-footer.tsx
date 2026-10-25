import Link from "next/link";
import { VoxandraLogo } from "@/components/brand/voxandra-logo";
import { comparisonPages } from "@/components/compare/competitors";
import {
  OPEN_SOURCE_CONTRIBUTING_URL,
  OPEN_SOURCE_LICENSE_NAME,
  OPEN_SOURCE_LICENSE_URL,
  OPEN_SOURCE_REPO_URL,
} from "@/lib/open-source";

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/acceptable-use", label: "Acceptable use" },
];

const openSourceLinks = [
  { href: OPEN_SOURCE_REPO_URL, label: "Source on GitHub" },
  { href: OPEN_SOURCE_LICENSE_URL, label: `License (${OPEN_SOURCE_LICENSE_NAME})` },
  { href: OPEN_SOURCE_CONTRIBUTING_URL, label: "Contributing" },
];

export function LandingFooter() {
  return (
    <footer className="border-t landing-rule bg-[#fffaf4] px-5 py-12 md:px-8 md:py-14">
      <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-2 md:grid-cols-4 md:items-start lg:grid-cols-[1.3fr_repeat(4,minmax(0,0.8fr))]">
        <div className="sm:col-span-2 md:col-span-4 lg:col-span-1">
          <VoxandraLogo href="/" showTagline tagline="Multilingual business calls" />
          <p className="mt-4 max-w-sm text-sm leading-6 text-stone-600">
            Live Voice Translation, private guidance, and reviewed Call Records.
          </p>
          <p className="mt-4 text-xs font-medium text-stone-500">
            Copyright 2026 Areia Labs. Voxandra is a product of Areia Labs, open source under {OPEN_SOURCE_LICENSE_NAME}.
          </p>
        </div>

        {comparisonPages.length > 0 && (
          <nav aria-label="Compare" className="grid gap-3">
            <p className="landing-label">
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
          <p className="landing-label">
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

        <nav aria-label="Open source" className="grid gap-3">
          <p className="landing-label">
            Open source
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 md:grid md:gap-2">
            {openSourceLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-[#2e1065] transition hover:text-[#6d28d9]"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="grid gap-3">
          <p className="landing-label">
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
