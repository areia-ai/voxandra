// Behavioural coverage for Accept: text/markdown content negotiation
// (src/lib/http/markdown-negotiation.ts), verified against the
// acceptmarkdown.com checklist: serves Markdown for Accept: text/markdown,
// honors q-values, and reports "unsupported" (callers respond 406) when an
// Accept header explicitly excludes both text/html and text/markdown.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// The module is TypeScript, so it is transformed in-memory rather than
// adding a build step to the test suite (same pattern as
// scripts/test-rate-prefix-lookup.mjs).
const { negotiateHtmlOrMarkdown, negotiateRepresentation } = await (async () => {
  const { transformSync } = await import("esbuild");
  const source = readFileSync(
    path.resolve(root, "src/lib/http/markdown-negotiation.ts"),
    "utf8"
  );
  const { code } = transformSync(source, { loader: "ts", format: "esm" });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return await import(url);
})();

// No Accept header at all: default to html.
assert.equal(negotiateHtmlOrMarkdown(null), "html");
assert.equal(negotiateHtmlOrMarkdown(undefined), "html");
assert.equal(negotiateHtmlOrMarkdown(""), "html");
assert.equal(negotiateHtmlOrMarkdown("   "), "html");

// Explicit, unambiguous cases.
assert.equal(negotiateHtmlOrMarkdown("text/markdown"), "markdown");
assert.equal(negotiateHtmlOrMarkdown("TEXT/MARKDOWN"), "markdown", "case-insensitive");
assert.equal(negotiateHtmlOrMarkdown("text/html"), "html");
assert.equal(
  negotiateHtmlOrMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
  "html",
  "typical browser Accept header"
);

// Wildcards without an explicit markdown preference default to html.
assert.equal(negotiateHtmlOrMarkdown("*/*"), "html");
assert.equal(negotiateHtmlOrMarkdown("text/*"), "html");

// q-values must be honored even when markdown/html order in the header
// suggests otherwise.
assert.equal(
  negotiateHtmlOrMarkdown("text/markdown;q=0.5, text/html;q=0.9"),
  "html",
  "higher-q html wins over lower-q markdown"
);
assert.equal(
  negotiateHtmlOrMarkdown("text/markdown;q=0.9, text/html;q=0.5"),
  "markdown",
  "higher-q markdown wins over lower-q html"
);
assert.equal(
  negotiateHtmlOrMarkdown("text/html;q=0.5, text/markdown"),
  "markdown",
  "implicit q=1 markdown beats explicit lower-q html regardless of header order"
);

// A specific markdown preference beats a generic wildcard for html.
assert.equal(
  negotiateHtmlOrMarkdown("*/*;q=0.8, text/markdown;q=0.9"),
  "markdown"
);

// Explicit exclusion (q=0) of the only mentioned type, with nothing else
// acceptable, is a real 406 case — the client asked for something we don't
// serve and declined our defaults.
assert.equal(negotiateHtmlOrMarkdown("text/markdown;q=0"), "unsupported");
assert.equal(negotiateHtmlOrMarkdown("application/json"), "unsupported");
assert.equal(negotiateHtmlOrMarkdown("application/pdf, application/json"), "unsupported");

// A low-q wildcard alongside an unsupported type still yields a match (the
// wildcard covers both html and markdown), so this must NOT be 406.
assert.equal(negotiateHtmlOrMarkdown("application/json, */*;q=0.1"), "html");

// --- negotiateRepresentation, used for GET /mcp (html | markdown | json) ---

const MCP_OFFERS = ["text/html", "text/markdown", "application/json"];

// A browser must still get the human docs page.
assert.equal(
  negotiateRepresentation(
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    MCP_OFFERS
  ),
  "text/html",
  "browser Accept still gets the docs page"
);
assert.equal(negotiateRepresentation(null, MCP_OFFERS), "text/html", "no header -> default");
assert.equal(negotiateRepresentation("*/*", MCP_OFFERS), "text/html", "wildcard -> default");

// Agent tooling probing /mcp for JSON gets the server card.
assert.equal(
  negotiateRepresentation("application/json", MCP_OFFERS),
  "application/json",
  "explicit json wins"
);
assert.equal(
  negotiateRepresentation("application/json, text/html;q=0.5", MCP_OFFERS),
  "application/json",
  "higher-q json beats lower-q html"
);
assert.equal(
  negotiateRepresentation("text/markdown", MCP_OFFERS),
  "text/markdown",
  "markdown still negotiable on the same path"
);
assert.equal(
  negotiateRepresentation("application/pdf", MCP_OFFERS),
  "unsupported",
  "no acceptable offer -> unsupported (406)"
);
// The default offer must win a true tie rather than order-of-header luck.
assert.equal(
  negotiateRepresentation("application/json;q=0.9, text/html;q=0.9", MCP_OFFERS),
  "text/html",
  "equal q -> first offer (the default representation) wins"
);
assert.equal(negotiateRepresentation("text/html", []), "unsupported", "no offers");

console.log("test-markdown-negotiation.mjs: all assertions passed");
