import { NextResponse } from "next/server";
import { MCP_CLIENTS, MCP_ENDPOINT_URL, MCP_TOOL_SUMMARIES } from "@/lib/mcp/tools-list";
import { MARKDOWN_NEGOTIATION_VARY_HEADER } from "@/lib/http/markdown-negotiation";

// Reached only via the middleware rewrite for "/mcp" when Accept:
// text/markdown wins content negotiation (src/proxy.ts). Built from the same
// tool/client data as the human docs page (src/app/mcp/page.tsx) so the two
// can't drift out of sync.
function buildMcpMarkdown(): string {
  const lines: string[] = [
    "# Voxandra MCP Server",
    "",
    "Voxandra is an AI platform for multilingual business calls. It translates both sides of live phone conversations, provides private guidance while people talk, and turns each call into a reviewed Call Record. This is the developer documentation for the read-only Voxandra Model Context Protocol (MCP) server, for connecting AI agents and MCP clients to a Voxandra workspace's call records, transcripts, reminders, contacts, and work threads.",
    "",
    `- Endpoint: \`${MCP_ENDPOINT_URL}\` (Streamable HTTP transport, POST only)`,
    '- Auth: `Authorization: Bearer vx_YOUR_KEY` — personal API key created in the app\'s MCP section (/app/mcp)',
    "- Read-only: no write tools, no call-placing tools, no billing data exposed",
    "- Keys are workspace-scoped, shown once, stored only as a hash, revocable anytime",
    "",
    "## Tools",
    "",
    ...MCP_TOOL_SUMMARIES.map((tool) => `- \`${tool.name}\` — ${tool.description}`),
    "",
    "## Client setup",
    "",
  ];

  for (const client of MCP_CLIENTS) {
    lines.push(`### ${client.name}`, "", client.instruction, "", "```", client.snippet, "```", "");
  }

  return lines.join("\n");
}

export async function GET() {
  return new NextResponse(buildMcpMarkdown(), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: MARKDOWN_NEGOTIATION_VARY_HEADER,
    },
  });
}
