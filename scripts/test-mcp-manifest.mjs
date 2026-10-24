// Behavioural coverage for the MCP discovery manifests
// (src/lib/mcp/manifest.ts): builds both documents for real and asserts they
// satisfy their proposals' required fields, are JSON-serializable, and agree
// with the tool contract the live server actually registers.
//
// SEP-1649 server card: /.well-known/mcp/server-card.json
// SEP-1960 discovery manifest: /.well-known/mcp

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// The modules under test are TypeScript, so they are bundled in-memory
// rather than adding a build step to the test suite (a variation on
// scripts/test-rate-prefix-lookup.mjs, which only needs a bare transform —
// this one bundles so the SDK import resolves).
async function importBundledTs(relPath) {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [path.resolve(root, relPath)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return import(url);
}

const toolsList = await importBundledTs("src/lib/mcp/tools-list.ts");
const { buildMcpServerCard, buildMcpDiscoveryManifest, MANIFEST_HEADERS } =
  await importBundledTs("src/lib/mcp/manifest.ts");

// The protocol version must come from the SDK, not a hardcoded string, so a
// dependency bump can never leave the manifest advertising a stale version.
const { LATEST_PROTOCOL_VERSION } = await import("@modelcontextprotocol/sdk/types.js");

// --- SEP-1649 server card -------------------------------------------------

const card = buildMcpServerCard();

for (const field of ["$schema", "version", "protocolVersion", "serverInfo", "transport", "capabilities"]) {
  assert.ok(card[field] !== undefined, `server card missing required field: ${field}`);
}
assert.equal(card.protocolVersion, LATEST_PROTOCOL_VERSION, "protocol version tracks the SDK");
assert.ok(card.serverInfo.name, "serverInfo.name required");
assert.ok(card.serverInfo.version, "serverInfo.version required");
assert.equal(card.transport.type, "streamable-http", "Streamable HTTP transport");
assert.equal(
  card.transport.endpoint,
  toolsList.MCP_ENDPOINT_URL,
  "transport endpoint matches the documented endpoint"
);
assert.ok(card.transport.endpoint.startsWith("https://"), "endpoint must be https");
assert.equal(card.authentication.required, true, "auth is required");
assert.deepEqual(card.authentication.schemes, ["bearer"], "bearer auth");
assert.equal(card.instructions, toolsList.SERVER_INSTRUCTIONS, "instructions match the server");

// The advertised tool list must be exactly the documented contract — a
// manifest that lists a tool the server does not register (or omits one it
// does) is worse than no manifest.
assert.deepEqual(
  card.tools.map((tool) => tool.name),
  toolsList.MCP_TOOL_SUMMARIES.map((tool) => tool.name),
  "server card tool names match the public tool contract"
);
assert.ok(
  card.tools.every((tool) => typeof tool.description === "string" && tool.description.length > 0),
  "every advertised tool has a description"
);

// v1 is read-only by explicit product decision: tools only, nothing else.
assert.ok(card.capabilities.tools, "tools capability declared");
assert.equal(card.capabilities.resources, undefined, "no resources capability in read-only v1");
assert.equal(card.capabilities.prompts, undefined, "no prompts capability in read-only v1");

// --- SEP-1960 discovery manifest ------------------------------------------

const manifest = buildMcpDiscoveryManifest();

assert.ok(manifest.mcp_version, "mcp_version required");
assert.ok(manifest.endpoints, "endpoints required");
assert.ok(
  Object.keys(manifest.endpoints).length >= 1,
  "at least one endpoint must be advertised"
);
assert.equal(
  manifest.endpoints.streamable_http,
  toolsList.MCP_ENDPOINT_URL,
  "streamable_http endpoint matches the documented endpoint"
);
assert.equal(manifest.protocol_version, LATEST_PROTOCOL_VERSION, "protocol version tracks the SDK");
assert.equal(manifest.authentication.required, true, "auth is required");
assert.equal(manifest.capabilities.tools, true, "tools capability");
// Read-only posture must be stated honestly in the manifest too.
assert.equal(manifest.capabilities.resources, false, "read-only: no resources");
assert.equal(manifest.capabilities.prompts, false, "read-only: no prompts");
assert.equal(manifest.capabilities.sampling, false, "read-only: no sampling");

// --- Both documents must actually be valid JSON over the wire -------------

for (const [label, doc] of [
  ["server card", card],
  ["discovery manifest", manifest],
]) {
  const serialized = JSON.stringify(doc, null, 2);
  assert.deepEqual(JSON.parse(serialized), doc, `${label} round-trips as JSON`);
  assert.ok(!serialized.includes("undefined"), `${label} has no undefined leaking into JSON`);
}

// --- Required response headers -------------------------------------------

assert.match(
  MANIFEST_HEADERS["Content-Type"],
  /^application\/json/,
  "manifests are served as application/json"
);
assert.equal(
  MANIFEST_HEADERS["Access-Control-Allow-Origin"],
  "*",
  "discovery documents must be CORS-readable by agent clients"
);
assert.equal(MANIFEST_HEADERS["X-Content-Type-Options"], "nosniff", "nosniff required");
assert.match(MANIFEST_HEADERS["Cache-Control"], /max-age=\d+/, "cacheable");

// The manifests are public discovery documents and must never carry secrets.
const combined = JSON.stringify([card, manifest]);
for (const forbidden of ["vx_live", "sk-", "MCP_CONVEX_SECRET", "CONVEX_URL"]) {
  assert.ok(!combined.includes(forbidden), `manifest must not leak ${forbidden}`);
}

console.log("test-mcp-manifest.mjs: all assertions passed");
