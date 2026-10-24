// Static guard for Convex function visibility. The email pipeline was once
// registered as public `query`/`action` with no auth, meaning any deployment
// client could enumerate the email queue or send mail through Resend. These
// checks make "public only when deliberately authenticated" a property the
// test suite enforces rather than a review-time hope.
//
// Static analysis only: reads source text, never touches a Convex deployment.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const convexDir = path.resolve(here, "..", "convex");

function readConvex(file) {
  return fs.readFileSync(path.join(convexDir, file), "utf8");
}

// --- Email pipeline is internal -------------------------------------------

const emails = readConvex("emails.ts");
assert.ok(
  emails.includes("export const getPendingEmails = internalQuery("),
  "emails.getPendingEmails must be an internalQuery"
);
assert.ok(
  emails.includes("export const sendEmailAction: ReturnType<typeof internalAction> = internalAction("),
  "emails.sendEmailAction must be an internalAction"
);

const emailCron = readConvex("emailCron.ts");
assert.ok(
  emailCron.includes("export const processPendingEmails = internalAction("),
  "emailCron.processPendingEmails must be an internalAction"
);
assert.ok(
  !emailCron.includes("api.emails."),
  "emailCron must reach the email pipeline via internal., not public api."
);

// Every cron target must be internal. `\bapi\.` is a token match so the
// `import { internal }` line and `internal.` references cannot trip it.
const crons = readConvex("crons.ts");
assert.ok(!/\bapi\./.test(crons), "crons.ts must not reference the public api object");

// --- Removed dead public surface ------------------------------------------

const aiExtraction = readConvex("aiExtraction.ts");
assert.ok(
  !aiExtraction.includes("analyzeInternalAudioTranscript"),
  "aiExtraction.analyzeInternalAudioTranscript was removed with the audio-import feature"
);

// --- Sweep: files exporting public functions must carry an auth token ------
//
// Coarse file-level check: any file that registers a public query, mutation,
// or action should also contain one of the tokens the repo uses to guard such
// functions. Files whose public functions delegate auth to an internal helper
// in another file are allowlisted explicitly; adding a file here requires
// confirming where its workspace derivation actually happens.

const DELEGATED_AUTH_FILES = new Map([
  // performExtraction + the imported-transcript internal mutations derive the
  // workspace via requireWorkspace / checkAIFeaturesEnabled / getCallById.
  ["aiExtraction.ts", ["analyzeImportedTranscript", "retryImportedTranscriptExtraction", "regeneratePendingCallRecordLanguage"]],
  // Both actions resolve the workspace through
  // callMemorySearch.getCurrentWorkspaceForSearchAction (requireWorkspace).
  ["callMemorySearchActions.ts", ["backfillCurrentWorkspaceCallMemorySearch", "askCallRecords"]],
]);

const PUBLIC_EXPORT_RE = /export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(query|mutation|action)\s*\(/g;
const GUARD_TOKENS = [
  "requireWorkspace",
  "requireWorkspaceMembership",
  "requireWorkspaceOwner",
  "requireWorkspaceAdmin",
  "getCurrentProfile",
  "resolveCurrentProfileIdentity",
  "ctx.auth.getUserIdentity",
  "assertMaintenanceSecret",
  "requireMcpWorkspace",
  "_SECRET",
  "secret",
];

const sweepFailures = [];
for (const file of fs.readdirSync(convexDir).filter((f) => f.endsWith(".ts"))) {
  const src = readConvex(file);
  const publicNames = [...src.matchAll(PUBLIC_EXPORT_RE)].map((m) => m[1]);
  if (publicNames.length === 0) continue;
  if (GUARD_TOKENS.some((token) => src.includes(token))) continue;
  const allowed = DELEGATED_AUTH_FILES.get(file) ?? [];
  const unexpected = publicNames.filter((name) => !allowed.includes(name));
  if (unexpected.length > 0) sweepFailures.push(`${file}: ${unexpected.join(", ")}`);
}

assert.deepEqual(
  sweepFailures,
  [],
  "convex files with public functions and no auth-guard token (either guard " +
    "them or add them to DELEGATED_AUTH_FILES with a reason):\n  " +
    sweepFailures.join("\n  ")
);

console.log("Convex function visibility checks passed.");
