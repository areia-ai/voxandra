import { buildMcpServerCard, MANIFEST_HEADERS } from "@/lib/mcp/manifest";
import { MARKDOWN_NEGOTIATION_VARY_HEADER } from "@/lib/http/markdown-negotiation";

// Reached only via the middleware rewrite for GET /mcp when the client asks
// for application/json (src/proxy.ts). Agent tooling probing "/mcp" expects
// JSON describing the server; browsers still get the docs page at the same
// URL. Serves the same SEP-1649 server card as
// /.well-known/mcp/server-card.json.
export async function GET() {
  return new Response(JSON.stringify(buildMcpServerCard(), null, 2), {
    status: 200,
    headers: {
      ...MANIFEST_HEADERS,
      Vary: MARKDOWN_NEGOTIATION_VARY_HEADER,
    },
  });
}
