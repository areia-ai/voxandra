// Shared summaries of the MCP server's public tool contract. Rendered on the
// public /mcp docs page and the authenticated /app/mcp section — keep in sync
// with the registrations in src/lib/mcp/server.ts.
//
// This module is the dependency-free leaf of the MCP surface: server.ts,
// manifest.ts, and both React pages import from here. Keep it free of
// node:/Convex/SDK imports so the discovery manifests stay unit-testable
// without loading the whole server.
export const MCP_ENDPOINT_URL = "https://voxandra.com/api/mcp";

export const MCP_SERVER_VERSION = "1.0.0";

// Sent by the live server on connect (src/lib/mcp/server.ts) and published
// verbatim as the `instructions` field of the discovery manifests
// (src/lib/mcp/manifest.ts), so what an agent reads before connecting
// matches what it gets on connect.
export const SERVER_INSTRUCTIONS =
  "Read-only access to this Voxandra workspace's reviewed call records: AI notes, transcripts, extracted details, reminders, contacts, and work threads. " +
  "All data is scoped to the workspace that owns the API key. " +
  "Start with search_call_records or list_call_records, then use get_call_record with a callId for full detail.";

// "Works with" clients shown on both surfaces, each with its setup snippet.
// Logos are self-hosted under public/logos/mcp/ (third-party marks,
// nominative works-with use only — render small and unmodified on a light
// chip). Snippet syntax verified against each client's docs on 2026-07-26.
export type McpClient = {
  key: string;
  name: string;
  logo: string;
  instruction: string;
  snippet: string;
};

export const MCP_CLIENTS: McpClient[] = [
  {
    key: "claude-code",
    name: "Claude Code",
    logo: "/logos/mcp/claude.svg",
    instruction: "One command in your terminal:",
    snippet: `claude mcp add --transport http voxandra ${MCP_ENDPOINT_URL} --header "Authorization: Bearer vx_YOUR_KEY"`,
  },
  {
    key: "codex",
    name: "Codex",
    logo: "/logos/mcp/codex.png",
    instruction: "Codex reads the key from an environment variable:",
    snippet: `export VOXANDRA_API_KEY="vx_YOUR_KEY"
codex mcp add voxandra --url ${MCP_ENDPOINT_URL} --bearer-token-env-var VOXANDRA_API_KEY`,
  },
  {
    key: "cursor",
    name: "Cursor",
    logo: "/logos/mcp/cursor.svg",
    instruction:
      "Add this to .cursor/mcp.json in your project (or the global Cursor MCP settings):",
    snippet: `{
  "mcpServers": {
    "voxandra": {
      "url": "${MCP_ENDPOINT_URL}",
      "headers": { "Authorization": "Bearer vx_YOUR_KEY" }
    }
  }
}`,
  },
  {
    key: "openclaw",
    name: "OpenClaw",
    logo: "/logos/mcp/openclaw.svg",
    instruction:
      "One command — then verify the connection with `openclaw mcp doctor --probe`:",
    snippet: `openclaw mcp add voxandra --url ${MCP_ENDPOINT_URL} --transport streamable-http --header "Authorization: Bearer vx_YOUR_KEY"`,
  },
  {
    key: "hermes",
    name: "Hermes",
    logo: "/logos/mcp/hermes.png",
    instruction:
      "Add the server to ~/.hermes/config.yaml (or run `hermes mcp add voxandra`):",
    snippet: `# ~/.hermes/config.yaml
mcp_servers:
  voxandra:
    url: "${MCP_ENDPOINT_URL}"
    headers:
      Authorization: "Bearer vx_YOUR_KEY"`,
  },
];

export const MCP_TOOL_SUMMARIES: Array<{ name: string; description: string }> = [
  {
    name: "search_call_records",
    description:
      "Full-text search across call record notes, transcripts, extracted details, follow-ups, and user notes.",
  },
  {
    name: "get_call_record",
    description:
      "One complete call record: AI note, full transcript, extracted details, action items, reminders, contact, and work thread.",
  },
  {
    name: "list_call_records",
    description: "Recent call records newest-first with summary snippets and filters.",
  },
  {
    name: "list_reminders",
    description: "Workspace reminders, filterable by status, sorted by remind-at time.",
  },
  {
    name: "list_contacts",
    description: "List or search workspace contacts by name or phone number.",
  },
  {
    name: "list_threads",
    description:
      "Active work threads (ongoing multi-call workstreams) with open follow-up counts.",
  },
  {
    name: "get_thread",
    description:
      "Full intelligence for one work thread: open and overdue commitments, key facts, repeated blockers, suggested next objective.",
  },
  {
    name: "pre_call_brief",
    description:
      "Prepare for a call: recent related calls, open follow-ups, key facts, and lessons from similar reviewed calls.",
  },
];
