"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Plug, Wrench } from "lucide-react";
import { ApiAccessSection, CopyButton } from "@/components/mcp/api-access-section";
import { MCP_CLIENTS, MCP_ENDPOINT_URL, MCP_TOOL_SUMMARIES } from "@/lib/mcp/tools-list";

function ConnectClientSection() {
  const [selectedKey, setSelectedKey] = useState(MCP_CLIENTS[0].key);
  const selected =
    MCP_CLIENTS.find((client) => client.key === selectedKey) ?? MCP_CLIENTS[0];

  return (
    <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
          <Plug aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">
            Connect a client
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
            The Voxandra MCP server runs at{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-800 dark:bg-stone-800 dark:text-stone-200">
              {MCP_ENDPOINT_URL}
            </code>{" "}
            and works with any MCP client. Pick yours:
          </p>
          <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="MCP client">
            {MCP_CLIENTS.map((client) => {
              const active = client.key === selected.key;
              return (
                <button
                  key={client.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedKey(client.key)}
                  className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-xs font-semibold transition ${
                    active
                      ? "border-violet-400 bg-violet-50 text-violet-900 ring-2 ring-violet-100 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-950/60"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-white">
                    <Image
                      src={client.logo}
                      alt=""
                      width={20}
                      height={20}
                      className="h-4 w-4 object-contain"
                    />
                  </span>
                  {client.name}
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-sm leading-6 text-stone-600 dark:text-stone-400">
            Create a key above, then for {selected.name}: {selected.instruction.replace(/`/g, "")}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs leading-5 text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
              <code>{selected.snippet}</code>
            </pre>
            <CopyButton key={selected.key} value={selected.snippet} />
          </div>
          <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-400">
            Using Claude Desktop or another client?{" "}
            <Link
              href="/mcp"
              className="inline-flex items-center gap-0.5 font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-400"
            >
              Full setup guide
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function ToolsSection() {
  return (
    <section className="rounded-xl border border-stone-200/80 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <span className="rounded-md bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400">
          <Wrench aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">
            Available tools
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
            Eight read-only tools over this workspace&apos;s calls. Ask your AI things
            like &ldquo;what did the supplier promise on our last call?&rdquo; or
            &ldquo;brief me before I call the broker back.&rdquo;
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {MCP_TOOL_SUMMARIES.map((tool) => (
              <li
                key={tool.name}
                className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-700 dark:bg-stone-800/50"
              >
                <p className="font-mono text-xs font-semibold text-stone-900 dark:text-stone-100">
                  {tool.name}
                </p>
                <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-400">
                  {tool.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function McpSectionPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section>
        <p className="text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">
          MCP
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">
          Your AI tools, connected
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-400">
          Give Claude, Cursor, or any MCP client read-only access to this
          workspace&apos;s Call Records — notes, transcripts, extracted details,
          reminders, contacts, and work threads. This section will grow as Voxandra
          becomes more agent-native.
        </p>
      </section>

      <ApiAccessSection />

      <ConnectClientSection />

      <ToolsSection />
    </div>
  );
}
