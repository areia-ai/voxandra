import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, KeyRound, Lock, Search, Terminal } from "lucide-react";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";
import { MCP_CLIENTS, MCP_ENDPOINT_URL, MCP_TOOL_SUMMARIES } from "@/lib/mcp/tools-list";

export const metadata: Metadata = {
  title: "Voxandra MCP Server — Connect AI Agents to Your Call Records",
  description:
    "Connect Claude Code, Codex, Cursor, OpenClaw, Hermes, or any MCP client to your Voxandra workspace. Search call records, transcripts, reminders, contacts, and work threads from your AI tools with a read-only API key.",
  alternates: {
    canonical: "/mcp",
  },
  openGraph: {
    title: "Voxandra MCP Server — Connect AI Agents to Your Call Records",
    description:
      "Search your Voxandra call records, transcripts, reminders, contacts, and work threads from Claude, Cursor, or any MCP client.",
  },
  twitter: {
    title: "Voxandra MCP Server — Connect AI Agents to Your Call Records",
    description:
      "Search your Voxandra call records, transcripts, reminders, contacts, and work threads from Claude, Cursor, or any MCP client.",
  },
};

const MCP_ENDPOINT = MCP_ENDPOINT_URL;

const CLAUDE_DESKTOP_SNIPPET = `{
  "mcpServers": {
    "voxandra": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${MCP_ENDPOINT}",
        "--header", "Authorization: Bearer vx_YOUR_KEY"
      ]
    }
  }
}`;

const TOOLS = MCP_TOOL_SUMMARIES;

const SECURITY_POINTS: Array<{ title: string; description: string }> = [
  {
    title: "Read-only by design",
    description:
      "The MCP server cannot place calls, edit records, spend credits, or change anything in your workspace. Every tool only reads.",
  },
  {
    title: "Workspace-scoped keys",
    description:
      "Each API key is tied to one workspace and sees exactly what you see in the app — never another customer's data.",
  },
  {
    title: "Revocable anytime",
    description:
      "Keys are shown once, stored only as a hash, and can be revoked in the app's MCP section the moment you no longer need them.",
  },
  {
    title: "No audio, no billing data",
    description:
      "Voxandra does not retain raw call audio, and the MCP server never exposes billing, pricing, or payment details.",
  },
];

function clientLogo(key: string) {
  return MCP_CLIENTS.find((client) => client.key === key)?.logo;
}

function ClientHeading({ logoKey, children }: { logoKey?: string; children: React.ReactNode }) {
  const logo = logoKey ? clientLogo(logoKey) : undefined;
  return (
    <h3 className="mt-8 flex items-center gap-2.5 text-lg font-semibold text-stone-950">
      {logo ? (
        <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <Image src={logo} alt="" width={28} height={28} className="h-5 w-5 object-contain" />
        </span>
      ) : null}
      {children}
    </h3>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-stone-950 p-4 text-[13px] leading-6 text-stone-100">
      <code>{code}</code>
    </pre>
  );
}

export default function McpPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#faf8f4] text-stone-950">
      <div className="bg-[radial-gradient(circle_at_75%_12%,rgba(124,58,237,0.12),transparent_34%),linear-gradient(180deg,#fffaf4_0%,#faf8f4_62%,#faf8f4_100%)]">
        <LandingHeader />

        <section className="mx-auto max-w-4xl px-5 pb-12 pt-4 md:px-8 md:pb-16 md:pt-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#6d28d9]">
            Voxandra MCP Server
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight text-stone-950 md:text-5xl">
            Your Voxandra call records,{" "}
            <span className="font-serif italic text-stone-800">
              inside your AI tools
            </span>
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600">
            Connect Claude Code, Codex, Cursor, OpenClaw, Hermes, or any MCP client to
            your Voxandra workspace and ask questions across everything your calls have
            captured — records, notes, transcripts, reminders, contacts, and work
            threads.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Works with
            </span>
            {MCP_CLIENTS.map((client) => (
              <span
                key={client.key}
                className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white py-1.5 pl-2 pr-3.5 text-sm font-semibold text-stone-800 shadow-sm"
              >
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-white">
                  <Image
                    src={client.logo}
                    alt={`${client.name} logo`}
                    width={24}
                    height={24}
                    className="h-5 w-5 object-contain"
                  />
                </span>
                {client.name}
              </span>
            ))}
          </div>

          {/* Canonical product definition, reused verbatim across the site so
              AI engines converge on one quotable phrasing. */}
          <p className="mt-6 text-base leading-7 text-stone-600">
            Voxandra turns multilingual business calls into
            reviewed call records: AI notes, transcripts, extracted details, reminders,
            contacts, and work threads.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/app/mcp"
              className="inline-flex items-center gap-2 rounded-md bg-[#3b1676] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/15 transition hover:bg-[#2e1065]"
            >
              Create an API key
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
              <KeyRound aria-hidden="true" className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-stone-950">Step 1 — get your API key</h2>
              <p className="mt-2 text-base leading-7 text-stone-600">
                In the Voxandra app, open the{" "}
                <span className="font-semibold text-stone-900">MCP</span> section in
                the sidebar, create a key, and copy it — it is shown once. Keys are
                read-only, scoped to your workspace, and revocable anytime.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-14 md:px-8 md:py-16">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f4efff] text-[#6d28d9]">
            <Terminal aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
              Step 2 — connect your client
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600">
              The Voxandra MCP server runs at{" "}
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-sm text-stone-800">
                {MCP_ENDPOINT}
              </code>{" "}
              using the Streamable HTTP transport. Replace{" "}
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-sm text-stone-800">
                vx_YOUR_KEY
              </code>{" "}
              with your key.
            </p>

            {MCP_CLIENTS.map((client) => (
              <div key={client.key}>
                <ClientHeading logoKey={client.key}>{client.name}</ClientHeading>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  {client.instruction.replace(/`/g, "")}
                </p>
                <CodeBlock code={client.snippet} />
              </div>
            ))}

            <ClientHeading logoKey="claude-code">Claude Desktop</ClientHeading>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Add this to{" "}
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[13px] text-stone-800">
                claude_desktop_config.json
              </code>{" "}
              (Settings → Developer → Edit Config). It uses the{" "}
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[13px] text-stone-800">
                mcp-remote
              </code>{" "}
              bridge, which requires Node.js:
            </p>
            <CodeBlock code={CLAUDE_DESKTOP_SNIPPET} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-14 md:px-8 md:pb-16">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f4efff] text-[#6d28d9]">
            <Search aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
              What your AI can do
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600">
              Eight read-only tools. Ask things like &ldquo;what did the supplier promise
              on our last call?&rdquo;, &ldquo;which reminders are overdue?&rdquo;, or
              &ldquo;brief me before I call the insurance broker back.&rdquo;
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {TOOLS.map((tool) => (
                <div
                  key={tool.name}
                  className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"
                >
                  <p className="font-mono text-sm font-semibold leading-6 text-stone-950">
                    {tool.name}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    {tool.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-14 md:px-8 md:pb-16">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f4efff] text-[#6d28d9]">
            <Lock aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold leading-tight text-stone-950 md:text-3xl">
              Built for cautious teams
            </h2>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {SECURITY_POINTS.map((point) => (
                <div
                  key={point.title}
                  className="rounded-xl border border-stone-200 bg-stone-50/70 p-5"
                >
                  <p className="font-semibold leading-6 text-stone-950">{point.title}</p>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    {point.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-16 md:px-8 md:pb-20">
        <div className="rounded-2xl border border-[#6d28d9]/20 bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-2xl font-semibold leading-tight text-stone-950">
            New to Voxandra?
          </h2>
          <p className="mt-3 text-base leading-7 text-stone-600">
            The MCP server searches what Voxandra has already captured — so the first
            step is making multilingual calls with Voxandra. Every reviewed call becomes
            searchable operational memory for you and your AI tools.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login?redirect=/app/dialer"
              className="inline-flex items-center gap-2 rounded-md bg-[#3b1676] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/15 transition hover:bg-[#2e1065]"
            >
              Try the free call
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <LandingFooter />
    </main>
  );
}
