import Image from "next/image";
import Link from "next/link";
import { FileText, ShieldCheck } from "lucide-react";
import { MCP_CLIENTS } from "@/lib/mcp/tools-list";
import { LearnMoreChevron } from "@/components/landing/landing-icons";
import { Reveal } from "@/components/landing/reveal";

export function McpSection() {
  return (
    <section id="mcp" aria-labelledby="mcp-heading" className="landing-section scroll-mt-24 border-t landing-rule">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 md:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div className="min-w-0">
          <Reveal>
            <p className="landing-eyebrow"><span className="landing-eyebrow-index">03</span>Works with your AI tools</p>
            <h2 id="mcp-heading" className="mt-4 max-w-xl text-3xl font-semibold leading-[1.02] tracking-[-0.035em] md:text-5xl">Bring your Call Records<br className="hidden xl:block" /> to your AI tools.</h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-stone-600">Connect through MCP so your AI can find what was agreed, check open follow-ups, and help you prepare for the next call using your reviewed records.</p>
          </Reveal>
          <ul aria-label="Compatible MCP clients" className="mt-6 flex flex-wrap gap-x-5 gap-y-3">
            {MCP_CLIENTS.map((client) => (
              <li key={client.key} className="inline-flex items-center gap-2 text-sm font-medium text-stone-700">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white">
                  <Image src={client.logo} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
                </span>
                {client.name}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-6 text-stone-500">Or another MCP-compatible client.</p>
          <Link href="/mcp" className="t-learn mt-6 inline-flex items-center gap-1 text-sm font-semibold text-violet-800">See the MCP setup guide <LearnMoreChevron /></Link>
          <div className="mt-7 flex items-start gap-2.5 border-t landing-rule pt-5">
            <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-800" />
            <p className="max-w-lg text-sm leading-6 text-stone-600">Read-only access to your workspace. It cannot place calls or change your data. Revoke your API key whenever you need to.</p>
          </div>
        </div>
        <figure className="landing-card min-w-0 rounded-2xl">
          <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b landing-rule px-5 py-4 sm:px-7">
            <span className="text-sm font-semibold text-stone-800">Your AI + Voxandra</span>
            <span className="text-xs text-stone-500">Illustrative example</span>
          </figcaption>
          <div className="space-y-6 p-5 sm:p-7">
            <div className="ml-5 rounded-2xl rounded-tr-sm bg-[#f3effb] p-4 sm:ml-12 sm:p-5">
              <p className="text-xs font-semibold text-violet-800">You ask</p>
              <p className="mt-2 text-base leading-7 text-stone-900">What’s holding up the Northstar payment?</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-stone-500">Your AI, using Voxandra</p>
              <p className="mt-3 text-base leading-7 text-stone-700">Matthias confirmed that PO-8842 is approved. Payment is waiting on your updated tax certificate.</p>
              <p className="mt-3 text-base leading-7 text-stone-700"><span className="font-semibold text-stone-950">Next step:</span> upload the certificate by 3 PM, then follow up with Northstar about releasing the payment.</p>
            </div>
            <div className="flex items-start gap-3 border-t landing-rule pt-5">
              <FileText aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-violet-800" />
              <div className="min-w-0">
                <p className="text-xs text-stone-500">Based on a reviewed Call Record</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-stone-800">Supplier payment release · Northstar</p>
                <p className="mt-1 text-xs leading-5 text-stone-500">Call notes · Extracted details · Follow-ups</p>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}
