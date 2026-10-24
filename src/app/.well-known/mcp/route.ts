import { buildMcpDiscoveryManifest, MANIFEST_HEADERS } from "@/lib/mcp/manifest";

// SEP-1960 MCP discovery manifest. Public, unauthenticated, cacheable.
export const dynamic = "force-static";

export async function GET() {
  return new Response(JSON.stringify(buildMcpDiscoveryManifest(), null, 2), {
    status: 200,
    headers: MANIFEST_HEADERS,
  });
}

// Discovery documents are fetched cross-origin by agent clients.
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
