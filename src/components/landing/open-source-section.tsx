import {
  OPEN_SOURCE_LICENSE_NAME,
  OPEN_SOURCE_LICENSE_URL,
  OPEN_SOURCE_README_URL,
  OPEN_SOURCE_REPO_URL,
} from "@/lib/open-source";
import { GitHubMark, LearnMoreChevron } from "@/components/landing/landing-icons";
import { Reveal } from "@/components/landing/reveal";

const stackParts = [
  { path: "src/app", name: "Next.js app", description: "The site, the browser dialer, and Call Record review." },
  { path: "convex/", name: "Convex backend", description: "Workspaces, sign-in, billing, transcripts, and AI notes." },
  { path: "scripts/realtime-media-worker.mjs", name: "Realtime media worker", description: "Carries translated calls and private Guidance while you talk." },
];

export function OpenSourceSection() {
  return (
    <section id="open-source" aria-labelledby="open-source-heading" className="landing-section scroll-mt-24 border-t landing-rule">
      <div className="mx-auto grid max-w-7xl items-start gap-10 px-5 md:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div className="min-w-0">
          <Reveal>
            <p className="landing-eyebrow"><span className="landing-eyebrow-index">04</span>Open source</p>
            <h2 id="open-source-heading" className="mt-4 max-w-xl text-3xl font-semibold leading-[1.02] tracking-[-0.035em] md:text-5xl">Read the code that <span className="font-editorial font-medium italic tracking-[-0.02em]">handles your calls.</span></h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-stone-600">Call transcripts and notes are sensitive. Voxandra’s source is public under the {OPEN_SOURCE_LICENSE_NAME}, so anyone can read exactly how calls are placed, translated, and turned into Call Records.</p>
          </Reveal>
          <p className="mt-4 max-w-lg text-base leading-7 text-stone-600">Use the hosted version at voxandra.com, or self-host the whole stack on your own provider accounts.</p>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4">
            <a href={OPEN_SOURCE_README_URL} target="_blank" rel="noreferrer" className="t-learn inline-flex items-center gap-1.5 rounded-lg border border-[#3b1676]/20 bg-white/70 px-4 py-2.5 text-sm font-semibold text-[#2e1065] transition-colors hover:border-[#3b1676]/35 hover:bg-white">
              Self-host it <LearnMoreChevron />
            </a>
            <a href={OPEN_SOURCE_LICENSE_URL} target="_blank" rel="noreferrer" className="t-learn inline-flex items-center gap-1 text-sm font-semibold text-violet-800">
              Read the license <LearnMoreChevron />
            </a>
          </div>
        </div>
        <figure className="landing-card min-w-0 rounded-2xl">
          <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b landing-rule px-5 py-4 sm:px-7">
            <a href={OPEN_SOURCE_REPO_URL} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-stone-800 hover:text-[#3b1676]">
              <GitHubMark className="h-4 w-4 shrink-0" />
              <span className="truncate">areia-ai/voxandra</span>
            </a>
            <span className="landing-label">{OPEN_SOURCE_LICENSE_NAME}</span>
          </figcaption>
          <ul className="divide-y divide-[var(--landing-line)]">
            {stackParts.map((part) => (
              <li key={part.name} className="px-5 py-5 sm:px-7">
                <p className="break-all font-mono text-xs text-stone-500">{part.path}</p>
                <p className="mt-2 text-base font-semibold text-stone-900">{part.name}</p>
                <p className="mt-1 text-sm leading-6 text-stone-600">{part.description}</p>
              </li>
            ))}
          </ul>
        </figure>
      </div>
    </section>
  );
}
