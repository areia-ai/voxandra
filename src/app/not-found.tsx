import type { Metadata } from "next";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";

// Rendered when a matched route calls notFound() (e.g. /blog/[slug] for an
// unknown slug). Next.js sets the response status to 404 automatically for
// this boundary. A garbage top-level URL that matches no route at all is
// instead handled by src/app/[...catchAll]/route.ts, which can also serve a
// Markdown body for Accept: text/markdown — this page always renders HTML.
export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

const RECOVERY_LINKS = [
  { href: "/", label: "Homepage" },
  { href: "/blog", label: "Blog" },
  { href: "/mcp", label: "MCP server docs" },
  { href: "/sitemap.xml", label: "Sitemap" },
  { href: "/llms.txt", label: "llms.txt" },
];

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#faf8f4] text-stone-950">
      <LandingHeader />
      <div className="mx-auto flex max-w-2xl flex-col items-center px-5 py-24 text-center md:px-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#6d28d9]">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950 md:text-4xl">
          Page not found
        </h1>
        <p className="mt-4 max-w-md text-stone-600">
          That page doesn&apos;t exist. Here are a few places to go instead.
        </p>
        <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {RECOVERY_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="font-semibold text-[#6d28d9] hover:underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <LandingFooter />
    </main>
  );
}
