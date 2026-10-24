// Static guard for bounded Convex list queries. getDashboardData and the Call
// Records list queries used to .collect() every call, contact, reminder,
// transcript, and AI memory in the workspace on every run — past Convex's
// 16 MiB / 32k-doc query limit that is a hard failure for active workspaces.
// These checks keep the hot paths on bounded index scans.
//
// Static analysis only: reads source text, never touches a Convex deployment.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// For every `.query("<table>")` in `src`, the statement (up to the next `;`)
// may only use .collect() behind a bounded index constraint — a bare
// withIndex("by_workspace", ...) or an index-less scan would read every row
// the workspace owns. Per-call / per-case / per-status collects are bounded
// and allowed.
function assertNoUnboundedCollect(src, table, context) {
  const marker = `.query("${table}")`;
  let cursor = 0;
  while (true) {
    const start = src.indexOf(marker, cursor);
    if (start === -1) return;
    // Several .query() chains can share one statement (e.g. inside a
    // Promise.all array), so the segment ends at the next chain or `;`,
    // whichever comes first.
    const nextQuery = src.indexOf(".query(", start + marker.length);
    const nextSemicolon = src.indexOf(";", start);
    const stop = [nextQuery, nextSemicolon].filter((i) => i !== -1);
    const end = stop.length ? Math.min(...stop) : src.length;
    const segment = src.slice(start, end);
    const unbounded =
      segment.includes(".collect()") &&
      (!segment.includes("withIndex(") || segment.includes('withIndex("by_workspace",'));
    assert.ok(
      !unbounded,
      `${context}: .query("${table}") runs an unbounded .collect() — use a bounded index scan`
    );
    cursor = start + marker.length;
  }
}

// --- notes.ts --------------------------------------------------------------

const notes = read("convex/notes.ts");
assert.ok(notes.includes("by_workspace_started"), "notes list scans calls via by_workspace_started");
assert.ok(!notes.includes('.query("transcripts")'), "notes.ts must not query the transcripts table");
for (const table of ["calls", "transcripts", "aiMemories", "extractedEntities", "contacts"]) {
  assertNoUnboundedCollect(notes, table, "convex/notes.ts");
}
assert.ok(!notes.includes("listNotes"), "convex/notes.ts: listNotes was removed");

// --- transcripts.ts --------------------------------------------------------

const transcriptsFile = read("convex/transcripts.ts");
const listStart = transcriptsFile.indexOf("export const listTranscriptRecords");
assert.ok(listStart !== -1, "convex/transcripts.ts: listTranscriptRecords export exists");
const listEnd = transcriptsFile.indexOf("\n});", listStart);
const listBody = transcriptsFile.slice(listStart, listEnd === -1 ? undefined : listEnd);
for (const table of ["calls", "transcripts", "aiMemories", "contacts"]) {
  assertNoUnboundedCollect(listBody, table, "convex/transcripts.ts listTranscriptRecords");
}
assert.ok(
  !transcriptsFile.includes("export const listTranscripts ="),
  "convex/transcripts.ts: listTranscripts was removed"
);

// --- dashboard.ts ----------------------------------------------------------

const dashboard = read("convex/dashboard.ts");
assert.ok(
  dashboard.includes("export const getProcessingCount = query("),
  "dashboard exposes getProcessingCount for the top-bar badge"
);
assert.ok(dashboard.includes("by_workspace_processing"), "dashboard uses by_workspace_processing");
assert.ok(dashboard.includes("by_review_pending"), "dashboard uses by_review_pending");
for (const table of ["calls", "contacts", "aiMemories", "actionItems"]) {
  assertNoUnboundedCollect(dashboard, table, "convex/dashboard.ts");
}

// --- schema.ts -------------------------------------------------------------

const schema = read("convex/schema.ts");
for (const index of [
  '.index("by_workspace_started", ["workspaceId", "startedAt"])',
  '.index("by_workspace_processing", ["workspaceId", "processingStatus"])',
]) {
  assert.ok(schema.includes(index), `convex/schema.ts missing ${index}`);
}

// --- calls.ts / top-bar.tsx ------------------------------------------------

const calls = read("convex/calls.ts");
assert.ok(!calls.includes("export const getCalls ="), "convex/calls.ts: getCalls was removed");

const topBar = read("src/components/layout/top-bar.tsx");
assert.ok(
  topBar.includes("api.dashboard.getProcessingCount"),
  "top-bar badge reads getProcessingCount"
);
assert.ok(!topBar.includes("getDashboardData"), "top-bar no longer subscribes to getDashboardData");

console.log("Bounded list query checks passed.");
