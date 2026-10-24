import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import {
  MCP_ENDPOINT_URL,
  MCP_SERVER_VERSION,
  MCP_TOOL_SUMMARIES,
  SERVER_INSTRUCTIONS,
} from "./tools-list";

// Machine-readable discovery documents for the Voxandra MCP server, built
// from the same constants the live server uses (protocol version straight
// from the SDK, tool list from tools-list.ts, instructions from server.ts) so
// a manifest can never advertise something the server does not actually do.
//
// Two formats are published because the ecosystem has two active proposals
// and clients are converging on both:
//   - SEP-1649 "server card" at /.well-known/mcp/server-card.json
//   - SEP-1960 "discovery manifest" at /.well-known/mcp
// Neither is merged into the core MCP spec yet, so both are additive: the
// real endpoint (/api/mcp, aliased at POST /mcp) works without them.

const BASE_URL = "https://voxandra.com";

// Per both proposals: JSON, publicly cacheable, CORS-open (these are public
// discovery documents, not authenticated data), and nosniff.
export const MANIFEST_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
} as const;

const DESCRIPTION =
  "Read-only MCP server for Voxandra, an AI platform for multilingual business calls. It exposes reviewed Call Records, notes, transcripts, details, reminders, contacts, and work threads.";

/** SEP-1649 server card: richer metadata (description, docs, tool listing). */
export function buildMcpServerCard() {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
    version: "1.0",
    protocolVersion: LATEST_PROTOCOL_VERSION,
    serverInfo: {
      name: "voxandra",
      title: "Voxandra Call Records",
      version: MCP_SERVER_VERSION,
    },
    description: DESCRIPTION,
    iconUrl: `${BASE_URL}/icon.png`,
    documentationUrl: `${BASE_URL}/mcp`,
    transport: {
      type: "streamable-http",
      endpoint: MCP_ENDPOINT_URL,
    },
    capabilities: {
      // Read-only by explicit product decision: tools only, and the tool
      // list is fixed rather than dynamic.
      tools: { listChanged: false },
    },
    authentication: {
      required: true,
      schemes: ["bearer"],
      description:
        "Workspace-scoped personal API key (vx_ prefix) created in the Voxandra app under /app/mcp, sent as: Authorization: Bearer vx_YOUR_KEY",
    },
    instructions: SERVER_INSTRUCTIONS,
    tools: MCP_TOOL_SUMMARIES.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  };
}

/** SEP-1960 discovery manifest: endpoint enumeration + auth discovery. */
export function buildMcpDiscoveryManifest() {
  return {
    mcp_version: "1.0",
    protocol_version: LATEST_PROTOCOL_VERSION,
    server_name: "Voxandra Call Records",
    server_version: MCP_SERVER_VERSION,
    description: DESCRIPTION,
    endpoints: {
      streamable_http: MCP_ENDPOINT_URL,
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
      sampling: false,
      roots: false,
    },
    authentication: {
      required: true,
      methods: ["api_key"],
    },
    security: {
      tls_required: true,
    },
    rate_limits: {
      // Matches touchApiKeyUsage's rolling window in convex/mcp.ts.
      requests_per_minute: 120,
    },
    documentation: `${BASE_URL}/mcp`,
  };
}
