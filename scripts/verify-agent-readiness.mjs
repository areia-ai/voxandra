// Static guards for the is-agentic.com readiness fixes: agent-friendly 404s,
// the /mcp POST-to-/api/mcp alias, Markdown content negotiation wiring, and
// developer-resource discoverability in llms.txt. Behavioural coverage for
// the negotiation logic itself lives in scripts/test-markdown-negotiation.mjs.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

function assertPathExists(path, label) {
  if (!existsSync(join(root, path))) {
    throw new Error(`${label}: ${path} should exist`);
  }
}

// --- 1. Agent-friendly 404s ---------------------------------------------

assertPathExists("src/app/[...catchAll]/route.ts", "catch-all 404 route");
const catchAll = read("src/app/[...catchAll]/route.ts");
assertIncludes(catchAll, "status: 404", "catch-all returns 404");
assertIncludes(catchAll, "text/markdown; charset=utf-8", "catch-all markdown variant");
assertIncludes(catchAll, "sitemap.xml", "catch-all links to sitemap");
assertIncludes(catchAll, "llms.txt", "catch-all links to llms.txt");
assertIncludes(catchAll, "negotiateHtmlOrMarkdown", "catch-all uses shared negotiation");

assertPathExists("src/app/not-found.tsx", "in-app not-found boundary");
const notFound = read("src/app/not-found.tsx");
assertIncludes(notFound, 'href: "/sitemap.xml"', "not-found links to sitemap");

// --- 2. Markdown content negotiation (acceptmarkdown.com) ----------------

assertPathExists("src/lib/http/markdown-negotiation.ts", "negotiation module");
const negotiation = read("src/lib/http/markdown-negotiation.ts");
assertIncludes(negotiation, "text/markdown", "negotiation targets text/markdown");
assertIncludes(negotiation, "unsupported", "negotiation reports unsupported for 406");

const proxy = read("src/proxy.ts");
assertIncludes(proxy, "negotiateHtmlOrMarkdown", "proxy wires up negotiation");
assertIncludes(proxy, 'status: 406', "proxy returns 406 for unsupported Accept");
assertIncludes(proxy, 'response.headers.set("Vary"', "proxy sets Vary on html responses");
assertIncludes(
  proxy,
  'rewritten.headers.set("Vary"',
  "proxy sets Vary on markdown-rewritten responses"
);

for (const target of [
  "src/app/markdown/home/route.ts",
  "src/app/markdown/mcp/route.ts",
  "src/app/markdown/blog/route.ts",
  "src/app/markdown/blog/[slug]/route.ts",
]) {
  assertPathExists(target, `markdown route ${target}`);
  const source = read(target);
  assertIncludes(source, "text/markdown; charset=utf-8", `${target} content type`);
  assertIncludes(source, "MARKDOWN_NEGOTIATION_VARY_HEADER", `${target} sets Vary`);
}

const robots = read("src/app/robots.ts");
assertIncludes(robots, '"/markdown/"', "robots.ts excludes internal markdown rewrite targets");

// --- 3. Developer resource discoverability --------------------------------

const llmsTxt = read("public/llms.txt");
assertIncludes(llmsTxt, "https://voxandra.com/mcp", "llms.txt lists the MCP docs page");
assertIncludes(llmsTxt, "Developer resources", "llms.txt has a developer resources section");
assertIncludes(llmsTxt, "Model Context Protocol", "llms.txt names the MCP protocol");
assertIncludes(llmsTxt, "## Open source", "llms.txt has an open-source section");
assertIncludes(llmsTxt, "https://github.com/areia-ai/voxandra", "llms.txt links the public repo");
assertIncludes(llmsTxt, "AGPL-3.0", "llms.txt names the license");

const sitemap = read("src/app/sitemap.ts");
assertIncludes(sitemap, "/mcp`", "sitemap lists /mcp");

const llmsDevSection = llmsTxt.slice(llmsTxt.indexOf("## Developer resources"));
assertIncludes(llmsDevSection, "/.well-known/mcp", "llms.txt lists the discovery manifests");
for (const tool of [
  "search_call_records",
  "get_call_record",
  "list_call_records",
  "list_reminders",
  "list_contacts",
  "list_threads",
  "get_thread",
  "pre_call_brief",
]) {
  assertIncludes(llmsDevSection, tool, `llms.txt names the ${tool} tool`);
}

// The product name must appear in the developer page's title AND heading, so
// name-based searches can surface it.
const mcpPage = read("src/app/mcp/page.tsx");
assertIncludes(mcpPage, "Voxandra MCP Server —", "mcp page title names the product");
assertIncludes(mcpPage, "Your Voxandra call records", "mcp page h1 names the product");

// Conventional developer-resource URLs must resolve rather than 404.
const nextConfig = read("next.config.ts");
for (const guess of ["/docs", "/developers", "/api-docs"]) {
  assertIncludes(nextConfig, `"${guess}"`, `next.config redirects ${guess}`);
}

// --- 4. Metadata completeness --------------------------------------------

const layout = read("src/app/layout.tsx");
assertIncludes(layout, 'type: "website"', "root layout declares og:type");

// --- 5. Organization schema completeness ---------------------------------

const structuredData = read("src/components/landing/structured-data.tsx");
assertIncludes(structuredData, "contactPoint", "Organization schema has contactPoint");
assertIncludes(structuredData, '"@type": "ContactPoint"', "contactPoint is typed");
assertIncludes(structuredData, "contactType", "contactPoint declares contactType");
assertIncludes(structuredData, '"@type": "PostalAddress"', "Organization schema has address");
assertIncludes(structuredData, "addressCountry", "address declares a country");
assertIncludes(structuredData, "sameAs", "Organization schema has sameAs");
assertIncludes(structuredData, '"@type": "SoftwareSourceCode"', "schema declares the source repository");
assertIncludes(structuredData, "codeRepository: OPEN_SOURCE_REPO_URL", "source schema links the repo");
// Every sameAs profile must be a live, absolute https URL — an unresolvable
// entry is a broken entity signal. Verify a profile in a browser (not curl:
// X, Instagram, and LinkedIn all reject non-browser clients) before adding
// it here.
for (const profile of [
  "https://www.linkedin.com/company/voxandra/",
  "https://x.com/getvoxandra",
  "https://www.instagram.com/getvoxandra/",
  "https://www.tiktok.com/@getvoxandra",
]) {
  assertIncludes(structuredData, profile, `sameAs includes ${profile}`);
}
const sameAsBlock = structuredData.slice(
  structuredData.indexOf("sameAs: ["),
  structuredData.indexOf("]", structuredData.indexOf("sameAs: ["))
);
const sameAsEntries = [...sameAsBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
if (sameAsEntries.length === 0) {
  throw new Error("sameAs: expected at least one profile URL");
}
for (const entry of sameAsEntries) {
  if (!entry.startsWith("https://")) {
    throw new Error(`sameAs: ${entry} must be an absolute https URL`);
  }
}

// --- 6. MCP server manifest / conventional endpoint -----------------------

assertIncludes(proxy, 'pathname === "/mcp" && request.method === "POST"', "proxy /mcp POST alias");
assertIncludes(proxy, '"/api/mcp"', "proxy rewrites /mcp POST to /api/mcp");
assertIncludes(proxy, '"application/json"', "proxy negotiates JSON on GET /mcp");
assertIncludes(proxy, "/markdown/mcp-json", "proxy rewrites JSON /mcp to the server card");

for (const manifestRoute of [
  "src/app/.well-known/mcp/route.ts",
  "src/app/.well-known/mcp/server-card.json/route.ts",
  "src/app/markdown/mcp-json/route.ts",
]) {
  assertPathExists(manifestRoute, `manifest route ${manifestRoute}`);
  assertIncludes(read(manifestRoute), "MANIFEST_HEADERS", `${manifestRoute} uses shared headers`);
}

// The manifests must be built from the live server's own constants, never
// hardcoded, or they will silently drift from what the server actually does.
const manifest = read("src/lib/mcp/manifest.ts");
assertIncludes(manifest, "LATEST_PROTOCOL_VERSION", "manifest takes protocol version from the SDK");
assertIncludes(manifest, "MCP_TOOL_SUMMARIES", "manifest builds its tool list from the contract");
assertIncludes(manifest, "SERVER_INSTRUCTIONS", "manifest reuses the server's instructions");
assertIncludes(manifest, '"streamable-http"', "manifest advertises Streamable HTTP");

console.log("verify-agent-readiness.mjs: all assertions passed");
