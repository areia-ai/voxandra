// Behavioral tests for the two-leg translated-call bridge lifecycle rules.
//
// These exist because the first fix for the 2026-07-30 orphaned-leg incident
// shipped with only source-string assertions ("does the file contain the word
// terminateSiblingCall"), which would have passed even with the termination
// verbs inverted or the parent/callee classification reversed. Every case below
// is derived from the real production callback stream of that incident, so a
// regression in leg identity, termination verb choice, or callback ordering
// fails here instead of on a live phone call.
import assert from "node:assert/strict";
import {
  BRIDGE_TERMINATION_GRACE_SECONDS,
  STALE_RESERVATION_GRACE_SECONDS,
  bridgeTerminationDelayMs,
  classifyBridgeLeg,
  isReservationAbandoned,
  isTerminalTwilioCallStatus,
  isTerminalVoxandraCallStatus,
  resolveTwilioTerminationStatus,
  shouldApplyProviderStatusPatch,
} from "../src/lib/twilio/bridge-lifecycle.ts";

// --- Terminal status vocabularies -------------------------------------------

for (const status of ["completed", "busy", "failed", "no-answer", "canceled"]) {
  assert.equal(isTerminalTwilioCallStatus(status), true, `${status} is terminal for Twilio`);
  assert.equal(isTerminalVoxandraCallStatus(status), true, `${status} is terminal for Voxandra`);
}
for (const status of ["queued", "ringing", "in-progress", "initiated"]) {
  assert.equal(isTerminalTwilioCallStatus(status), false, `${status} is live`);
}
// Voxandra-only state: a session that timed out before connecting.
assert.equal(isTerminalVoxandraCallStatus("expired"), true);
assert.equal(isTerminalTwilioCallStatus("expired"), false);
// Voxandra's own live statuses must never read as terminal, or a real call
// would be swept as abandoned.
for (const status of ["created", "connecting", "in_progress"]) {
  assert.equal(isTerminalVoxandraCallStatus(status), false, `${status} is live`);
}
assert.equal(isTerminalTwilioCallStatus(undefined), false);
assert.equal(isTerminalVoxandraCallStatus(undefined), false);

// --- Termination verb selection ---------------------------------------------

// Twilio's Call resource accepts only "canceled" or "completed" as an update
// status, and rejects the wrong one for the call's current state with a 400.
// Verified against the installed SDK's CallUpdateStatus union.
const ACCEPTED_UPDATE_STATUSES = new Set(["canceled", "completed"]);

for (const status of ["queued", "ringing", "initiated"]) {
  const plan = resolveTwilioTerminationStatus(status);
  assert.ok(plan, `${status} needs terminating`);
  assert.equal(plan.primary, "canceled", `an unanswered ${status} leg is canceled`);
  assert.equal(plan.fallback, "completed", `${status} falls back if it answered mid-flight`);
}

const inProgressPlan = resolveTwilioTerminationStatus("in-progress");
assert.ok(inProgressPlan);
assert.equal(inProgressPlan.primary, "completed", "an answered leg is completed");
assert.equal(inProgressPlan.fallback, "canceled");

// Both verbs must always be ones Twilio actually accepts, and must differ —
// otherwise the fallback retry is pointless.
for (const status of ["queued", "ringing", "initiated", "in-progress", "weird-new-status"]) {
  const plan = resolveTwilioTerminationStatus(status);
  assert.ok(plan, `${status} needs terminating`);
  assert.ok(ACCEPTED_UPDATE_STATUSES.has(plan.primary), `${status} primary verb is accepted`);
  assert.ok(ACCEPTED_UPDATE_STATUSES.has(plan.fallback), `${status} fallback verb is accepted`);
  assert.notEqual(plan.primary, plan.fallback, `${status} fallback differs from primary`);
}

// An unknown status must still be terminated, assuming answered. Failing open
// here would be how a leg survives.
assert.equal(resolveTwilioTerminationStatus("some-future-status").primary, "completed");

// Already-terminal legs are a no-op, so repeated/concurrent termination is safe.
for (const status of ["completed", "busy", "failed", "no-answer", "canceled"]) {
  assert.equal(
    resolveTwilioTerminationStatus(status),
    undefined,
    `${status} needs no termination`
  );
}

// --- Bridge leg classification ---------------------------------------------

const PARENT_SID = "CAacef95abd57f93f159f8cea757144917"; // browser leg, real incident SID
const CALLEE_SID = "CA5ddbec2713368383233a3535f4247793"; // REST-created leg, real incident SID

// Non-bridge calls must never be classified, or they would take the bridge
// branch and stop settling.
assert.equal(
  classifyBridgeLeg({
    bridgeModeRequested: false,
    providerCallSid: PARENT_SID,
    parentCallSid: PARENT_SID,
  }),
  undefined,
  "a normal call has no bridge leg"
);

// The callee's statusCallback URL carries an explicit label.
assert.equal(
  classifyBridgeLeg({
    bridgeModeRequested: true,
    labeledLeg: "callee",
    providerCallSid: CALLEE_SID,
    bridgeCalleeCallSid: CALLEE_SID,
    parentCallSid: PARENT_SID,
  }),
  "callee"
);

// The real browser-leg callback: no label (the TwiML App status callback URL
// cannot carry per-call query parameters), no ParentCallSid, and a CallSid that
// matches the stored parent SID.
assert.equal(
  classifyBridgeLeg({
    bridgeModeRequested: true,
    providerCallSid: PARENT_SID,
    bridgeCalleeCallSid: CALLEE_SID,
    parentCallSid: PARENT_SID,
  }),
  "parent",
  "an unlabeled callback matching the parent SID is the parent leg"
);

// An unlabeled callback whose SID matches the callee is still the callee — this
// is the safety net if the query label is ever lost.
assert.equal(
  classifyBridgeLeg({
    bridgeModeRequested: true,
    providerCallSid: CALLEE_SID,
    bridgeCalleeCallSid: CALLEE_SID,
    parentCallSid: PARENT_SID,
  }),
  "callee",
  "SID identity beats a missing label"
);

// The race the incident's fix had to handle: the browser leg ends before the
// callee SID has been persisted. With no callee SID on record, an unlabeled
// callback must classify as parent, so the call is NOT settled from the browser
// leg's short duration.
assert.equal(
  classifyBridgeLeg({
    bridgeModeRequested: true,
    providerCallSid: PARENT_SID,
    bridgeCalleeCallSid: undefined,
    parentCallSid: PARENT_SID,
  }),
  "parent",
  "parent callback before the callee SID is persisted"
);

// An explicit label always wins, even if it disagrees with SID identity: the
// label comes from a Twilio-signed URL and is the stronger signal.
assert.equal(
  classifyBridgeLeg({
    bridgeModeRequested: true,
    labeledLeg: "callee",
    providerCallSid: PARENT_SID,
    bridgeCalleeCallSid: CALLEE_SID,
    parentCallSid: PARENT_SID,
  }),
  "callee",
  "the signed label is authoritative"
);

// Unknown SID, no label, nothing stored yet: default to parent. Defaulting to
// callee instead would settle the bridge from whichever leg reported first,
// which is the original bug.
assert.equal(
  classifyBridgeLeg({ bridgeModeRequested: true, providerCallSid: "CAunknown" }),
  "parent"
);

// --- Out-of-order callback protection --------------------------------------

// A terminal event always applies.
assert.equal(
  shouldApplyProviderStatusPatch({ existingStatus: "in_progress", incomingIsTerminal: true }),
  true
);
// Twilio does not guarantee ordering, and a bridge call has two independent
// callback streams: a late `in-progress` must not resurrect a finished call.
assert.equal(
  shouldApplyProviderStatusPatch({ existingStatus: "completed", incomingIsTerminal: false }),
  false,
  "a late non-terminal event cannot un-complete a call"
);
assert.equal(
  shouldApplyProviderStatusPatch({
    existingStatus: "in_progress",
    existingEndedAt: "2026-07-30T14:41:02.610Z",
    incomingIsTerminal: false,
  }),
  false,
  "endedAt alone is enough to refuse a regression"
);
// Normal forward progress still applies.
assert.equal(
  shouldApplyProviderStatusPatch({ existingStatus: "connecting", incomingIsTerminal: false }),
  true
);
assert.equal(shouldApplyProviderStatusPatch({ incomingIsTerminal: false }), true);
// A duplicate terminal callback must still be allowed through; settlement
// itself is idempotent via the reservation status guard.
assert.equal(
  shouldApplyProviderStatusPatch({
    existingStatus: "completed",
    existingEndedAt: "2026-07-30T14:41:02.610Z",
    incomingIsTerminal: true,
  }),
  true
);

// --- Deadlines --------------------------------------------------------------

// The Voxandra deadline must land *after* Twilio's own timeLimit so it acts as
// a backstop rather than pre-empting normal termination.
assert.equal(bridgeTerminationDelayMs(300), (300 + BRIDGE_TERMINATION_GRACE_SECONDS) * 1000);
assert.ok(bridgeTerminationDelayMs(300) > 300 * 1000, "deadline is after Twilio's timeLimit");
assert.equal(bridgeTerminationDelayMs(0), BRIDGE_TERMINATION_GRACE_SECONDS * 1000);
// Garbage in must not produce a NaN delay, which would schedule immediately or
// never depending on the runtime.
assert.equal(bridgeTerminationDelayMs(Number.NaN), BRIDGE_TERMINATION_GRACE_SECONDS * 1000);
assert.equal(bridgeTerminationDelayMs(-50), BRIDGE_TERMINATION_GRACE_SECONDS * 1000);

// --- Abandoned reservation detection ---------------------------------------

const NOW = 1785425357889; // the incident's callee-completed timestamp
const GRACE_MS = STALE_RESERVATION_GRACE_SECONDS * 1000;

// A call still inside its own reserved duration is live, not abandoned. Every
// provider leg is capped at reservedSeconds, so this is the correct baseline.
assert.equal(
  isReservationAbandoned({ createdAt: NOW - 60_000, reservedSeconds: 300, now: NOW }),
  false,
  "a one-minute-old 300s reservation is live"
);
// Exactly at the boundary is not yet abandoned.
assert.equal(
  isReservationAbandoned({
    createdAt: NOW - (300 * 1000 + GRACE_MS),
    reservedSeconds: 300,
    now: NOW,
  }),
  false,
  "the boundary itself is not abandoned"
);
assert.equal(
  isReservationAbandoned({
    createdAt: NOW - (300 * 1000 + GRACE_MS) - 1,
    reservedSeconds: 300,
    now: NOW,
  }),
  true,
  "one millisecond past the boundary is abandoned"
);
// The incident's own 2940s reservation: still live at 49 minutes, abandoned
// once its cap plus the grace window has passed.
assert.equal(
  isReservationAbandoned({ createdAt: NOW - 2_940_000, reservedSeconds: 2940, now: NOW }),
  false
);
assert.equal(
  isReservationAbandoned({
    createdAt: NOW - 2_940_000 - GRACE_MS - 1,
    reservedSeconds: 2940,
    now: NOW,
  }),
  true
);
// A long legitimate call must not be swept mid-call: 3600s reserved, 59 minutes
// elapsed.
assert.equal(
  isReservationAbandoned({ createdAt: NOW - 59 * 60 * 1000, reservedSeconds: 3600, now: NOW }),
  false,
  "a 59-minute call with a 60-minute cap is still live"
);
// The two reservations stranded by the incident: never connected, so zero
// reserved-seconds progress, and abandoned once the grace window passes.
assert.equal(
  isReservationAbandoned({ createdAt: NOW - GRACE_MS - 1, reservedSeconds: 0, now: NOW }),
  true,
  "a never-connected reservation is abandoned after the grace window"
);
assert.equal(
  isReservationAbandoned({ createdAt: NOW - 1000, reservedSeconds: 0, now: NOW }),
  false
);
// Corrupt reservedSeconds must fail safe (treated as zero, not NaN).
assert.equal(
  isReservationAbandoned({
    createdAt: NOW - GRACE_MS - 1,
    reservedSeconds: Number.NaN,
    now: NOW,
  }),
  true
);

const { readFileSync } = await import("node:fs");
const voiceRoute = readFileSync(new URL("../src/app/api/twilio/voice/route.ts", import.meta.url), "utf8");
assert.ok(!voiceRoute.includes("await startBridgeLegRecording("), "initial TwiML must not wait for recording eligibility");
const statusRoute = readFileSync(new URL("../src/app/api/twilio/status/route.ts", import.meta.url), "utf8");
assert.ok(statusRoute.includes('params.StreamEvent === "stream-started"'), "recording starts from a signed connected-stream callback");

const { build } = await import("esbuild");
const { getFunctionName } = await import("convex/server");
async function loadBackend(file) {
  const result = await build({
    entryPoints: [new URL(file, import.meta.url).pathname],
    bundle: true, write: false, format: "esm", platform: "node",
  });
  return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { getBridgeMaxCallSeconds } = await loadBackend("../convex/twilioShared.ts");
const priorLimits = [process.env.TWILIO_MAX_CALL_SECONDS, process.env.TWILIO_BRIDGE_MAX_CALL_SECONDS];
try {
  delete process.env.TWILIO_MAX_CALL_SECONDS;
  delete process.env.TWILIO_BRIDGE_MAX_CALL_SECONDS;
  assert.equal(getBridgeMaxCallSeconds(), 1800);
  assert.equal(getBridgeMaxCallSeconds(45), 2700);
  assert.equal(getBridgeMaxCallSeconds(60), 3600);
  assert.equal(getBridgeMaxCallSeconds(120), 1800);
  process.env.TWILIO_BRIDGE_MAX_CALL_SECONDS = "120";
  assert.equal(getBridgeMaxCallSeconds(60), 120, "operator emergency ceiling still wins");
  delete process.env.TWILIO_BRIDGE_MAX_CALL_SECONDS;
  process.env.TWILIO_MAX_CALL_SECONDS = "900";
  assert.equal(getBridgeMaxCallSeconds(60), 900);
} finally {
  for (const [index, name] of ["TWILIO_MAX_CALL_SECONDS", "TWILIO_BRIDGE_MAX_CALL_SECONDS"].entries()) {
    if (priorLimits[index] === undefined) delete process.env[name]; else process.env[name] = priorLimits[index];
  }
}
const recordings = await loadBackend("../convex/bridgeRecordings.ts");
const lifecycle = await loadBackend("../convex/twilioLifecycle.ts");
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_CONVEX_WEBHOOK_SECRET"].map((name) => [name, process.env[name]]));
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "test-only";
process.env.TWILIO_CONVEX_WEBHOOK_SECRET = "test-only";

function recordingHarness() {
  const call = { _id: "call", callMode: "human_twilio_bridge", status: "in_progress", processingStatus: "calling", workspaceId: "workspace", parentCallSid: "CAparent", bridgeCalleeCallSid: "CAcallee" };
  const rows = new Map([[call._id, call]]);
  const jobs = [];
  const requests = [];
  let responses = [];
  const ctx = {
    db: {
      get: async (id) => rows.get(id) ?? null,
      patch: async (id, patch) => Object.assign(rows.get(id), patch),
      insert: async (_table, row) => { const id = `row${rows.size}`; rows.set(id, { _id: id, ...row }); return id; },
      query: () => ({ withIndex: (_index, filter) => {
        const matches = [];
        const q = { eq: (key, value) => { matches.push([key, value]); return q; } };
        filter(q);
        const selected = () => [...rows.values()].filter((row) => matches.every(([key, value]) => row[key] === value));
        return { first: async () => selected()[0] ?? null, collect: async () => selected() };
      } }),
    },
    scheduler: { runAfter: async (delay, ref, args) => jobs.push({ delay, name: getFunctionName(ref), args }) },
    runQuery: async (ref, args) => recordings[getFunctionName(ref).split(":")[1]]._handler(ctx, args),
    runMutation: async (ref, args) => recordings[getFunctionName(ref).split(":")[1]]._handler(ctx, args),
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, ...options });
    const next = responses.shift();
    assert.ok(next, "no unexpected provider requests");
    if (next instanceof Error) throw next;
    return Response.json(next.body, { status: next.status ?? 200 });
  };
  const claim = (overrides = {}) => recordings.claimBridgeRecording._handler(ctx, {
    secret: "test-only", callId: "call", leg: "parent", providerCallSid: "CAparent", startedAt: 1,
    callbackUrl: "https://example.invalid/recording", ...overrides,
  });
  return {
    call, rows, jobs, requests, ctx, claim,
    respond: (...items) => { responses = items; },
    run: async () => { const job = jobs.shift(); assert.equal(job.name, "twilioLifecycle:startBridgeRecording"); await lifecycle.startBridgeRecording._handler(ctx, job.args); assert.equal(responses.length, 0); },
  };
}
const live = { body: { status: "in-progress" } };
const emptyRecordings = { body: { recordings: [] } };
const ineligible = { status: 400, body: { message: "Requested resource is not eligible for recording" } };
try {
  const h = recordingHarness();
  await assert.rejects(h.claim({ secret: "wrong" }), /access denied/);
  await assert.rejects(h.claim({ providerCallSid: "CAother" }), /mismatch/);
  const claimed = await h.claim();
  await h.claim();
  assert.equal(h.jobs.length, 1, "duplicate stream callbacks schedule once");
  assert.equal(h.requests.length, 0, "stream callback only enqueues work");
  h.respond(live, emptyRecordings, ineligible);
  await h.run();
  assert.equal(h.rows.get(claimed.recordingId).status, "requested");
  assert.equal(h.jobs[0].delay, 1000);
  h.respond(live, emptyRecordings, { body: { sid: "REcreated" } });
  await h.run();
  const row = h.rows.get(claimed.recordingId);
  assert.equal(row.status, "recording");
  assert.ok(row.startedAt > 1, "timestamp tracks actual capture, not the initial claim");
  const form = new URLSearchParams(h.requests.at(-1).body);
  assert.equal(form.get("RecordingTrack"), "inbound");
  assert.equal(form.get("RecordingChannels"), "mono");
  assert.deepEqual(form.getAll("RecordingStatusCallbackEvent"), ["completed", "absent"]);
  assert.equal(form.get("Trim"), "do-not-trim");
  await h.claim();
  assert.equal(h.jobs.length, 0);
  row.status = "ready";
  await recordings.markBridgeRecordingStarted._handler(h.ctx, { recordingId: row._id, recordingSid: "REcreated", startedAt: Date.now() });
  await recordings.failBridgeRecordingStart._handler(h.ctx, { recordingId: row._id });
  assert.equal(row.status, "ready", "late job results cannot overwrite recording callbacks");

  const retrying = recordingHarness();
  const retryClaim = await retrying.claim();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    retrying.respond(live, emptyRecordings, ineligible);
    await retrying.run();
  }
  assert.equal(retrying.jobs.length, 0, "recording retries are bounded");
  assert.equal(retrying.rows.get(retryClaim.recordingId).status, "failed");
  assert.equal(retrying.call.status, "in_progress", "capture failure does not terminate a call");
  assert.equal(retrying.call.processingStatus, "calling");
  assert.equal(retrying.call.bridgeRecordCompleteness, "partial");
  retrying.call.endedAt = new Date().toISOString();
  await recordings.finalizeBridgeRecordingSet._handler(retrying.ctx, { callId: "call" });
  assert.equal(retrying.call.processingStatus, "transcription_failed", "no recordings cannot remain stuck processing");

  const ambiguous = recordingHarness();
  const ambiguousClaim = await ambiguous.claim();
  ambiguous.respond(live, emptyRecordings, new Error("response lost after provider accepted recording"));
  await ambiguous.run();
  ambiguous.respond(live, { body: { recordings: [{ sid: "REexisting", channels: 1, start_time: "2026-09-10T10:00:00Z" }] } });
  await ambiguous.run();
  assert.equal(ambiguous.requests.filter((request) => request.method === "POST").length, 1, "a retry reconciles an accepted recording rather than creating a duplicate");
  assert.equal(ambiguous.rows.get(ambiguousClaim.recordingId).recordingSid, "REexisting");
  assert.equal(ambiguous.rows.get(ambiguousClaim.recordingId).startedAt, Date.parse("2026-09-10T10:00:00Z"));

  const ended = recordingHarness();
  await ended.claim();
  ended.call.endedAt = new Date().toISOString();
  await ended.run();
  assert.equal(ended.requests.length, 0, "hangup before the job prevents provider recording requests");
  const late = await ended.claim({ leg: "callee", providerCallSid: "CAcallee" });
  assert.equal(late.shouldStart, false);
  assert.equal(ended.jobs.length, 0);

  const notReady = recordingHarness();
  await notReady.claim();
  notReady.respond({ body: { status: "ringing" } });
  await notReady.run();
  assert.equal(notReady.requests.length, 1, "an unconnected call is never recorded");
  assert.equal(notReady.jobs.length, 1);
  notReady.respond({ body: { status: "completed" } });
  await notReady.run();
  assert.equal(notReady.jobs.length, 0, "provider hangup stops retries even before our status callback arrives");

  const denied = recordingHarness();
  const deniedClaim = await denied.claim();
  denied.respond(live, emptyRecordings, { status: 403, body: { message: "Forbidden" } });
  await denied.run();
  assert.equal(denied.jobs.length, 0, "permanent recording failures are not retried");
  assert.equal(denied.rows.get(deniedClaim.recordingId).status, "failed");
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}

const { createRequire } = await import("node:module");
async function loadApp(file, mockServer = false) {
  const result = await build({
    entryPoints: [new URL(file, import.meta.url).pathname],
    bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
    plugins: mockServer ? [{
      name: "mock-twilio-boundary",
      setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/twilio\/server$/ }, () => ({ path: "server", namespace: "test" }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents:
          ["formDataToParams", "validateTwilioRequest", "getRequiredEnv", "getConvexHttpClient", "getTwilioClient", "logTwilioDebug", "startBridgeLegRecording", "createBridgeParentTwiML", "createVoiceTwiML"].map((name) => `export const ${name} = (...args) => globalThis.__bridgeRouteTest.${name}(...args);`).join("\n"),
        }));
      },
    }] : [],
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}
const twimlServer = await loadApp("../src/lib/twilio/server.ts");
const voiceWebhook = await loadApp("../src/app/api/twilio/voice/route.ts", true);
const statusWebhook = await loadApp("../src/app/api/twilio/status/route.ts", true);
const streamEnv = Object.fromEntries(["REALTIME_STREAM_SIGNING_SECRET", "REALTIME_MEDIA_STREAM_URL", "TWILIO_STATUS_CALLBACK_URL", "TWILIO_BRIDGE_LEG_WEBHOOK_URL"].map((name) => [name, process.env[name]]));
process.env.REALTIME_STREAM_SIGNING_SECRET = "test-only";
process.env.REALTIME_MEDIA_STREAM_URL = "wss://example.invalid/stream";
delete process.env.TWILIO_STATUS_CALLBACK_URL;
delete process.env.TWILIO_BRIDGE_LEG_WEBHOOK_URL;
try {
  for (const builder of [twimlServer.createBridgeParentTwiML, twimlServer.createBridgeCalleeTwiML]) {
    const xml = builder({ mediaStreamUrl: "wss://example.invalid/stream", mediaStreamParams: { voxandraCallId: "call" }, statusCallbackUrl: "https://example.invalid/status?bridgeLeg=parent" });
    assert.ok(xml.includes('statusCallback="https://example.invalid/status?bridgeLeg=parent"'));
    assert.ok(xml.includes('statusCallbackMethod="POST"'));
    assert.ok(xml.includes('name="streamSignature"'), "adding stream callbacks preserves media-stream authentication");
  }
  let signatureValid = true;
  const captureStarts = [];
  const mutations = [];
  let created = 0;
  const session = {
    callId: "call", workspaceId: "workspace", destinationE164: "+15005550006", callerIdNumber: "+15005550006",
    maxCallSeconds: 60, aiCaptureEnabled: true, bridgeModeRequested: true, translatedCaptionsRequested: true,
    translatedCaptionsSourceLanguage: "es", translatedCaptionsTargetLanguage: "en",
    realtimeSessionIds: { translatedCaptions: "translation" }, callerTranslatedVoice: "male", calledPersonTranslatedVoice: "female",
  };
  globalThis.__bridgeRouteTest = {
    formDataToParams: (form) => Object.fromEntries(form),
    validateTwilioRequest: () => signatureValid,
    getRequiredEnv: (name) => name === "NEXT_PUBLIC_APP_URL" ? "https://example.invalid" : "test-only",
    logTwilioDebug: () => {},
    getConvexHttpClient: () => ({ mutation: async (ref) => {
      const name = getFunctionName(ref);
      mutations.push(name);
      if (name.endsWith(":validateSessionForTwiML")) return session;
      if (name.endsWith(":recordBridgeCalleeCallSid")) return { terminateImmediately: false };
      return {};
    } }),
    getTwilioClient: () => ({ calls: { create: async () => { created += 1; return { sid: "CAcallee" }; } } }),
    startBridgeLegRecording: () => { throw new Error("Requested resource is not eligible for recording"); },
    createBridgeParentTwiML: twimlServer.createBridgeParentTwiML,
  };
  const response = await voiceWebhook.POST(new Request("https://example.invalid/api/twilio/voice", {
    method: "POST", body: new URLSearchParams({ voxandraCallId: "call", voxandraSessionToken: "test-only", CallSid: "CAparent" }),
  }));
  assert.equal(response.status, 200, "recording ineligibility cannot fail initial bridge TwiML");
  const xml = await response.text();
  assert.ok(xml.includes("<Connect><Stream"));
  assert.ok(xml.includes("bridgeLeg=parent"));
  assert.equal(created, 1);
  assert.ok(!mutations.some((name) => name.endsWith(":failBridgeCallSetup")));
  globalThis.__bridgeRouteTest.startBridgeLegRecording = (args) => { captureStarts.push(args); };
  mutations.length = 0;
  const streamRequest = (leg, event = "stream-started") => new Request(`https://example.invalid/api/twilio/status?voxandraCallId=call&bridgeLeg=${leg}`, {
    method: "POST", body: new URLSearchParams({ CallSid: leg === "parent" ? "CAparent" : "CAcallee", StreamEvent: event }),
  });
  for (const leg of ["parent", "callee"]) assert.equal((await statusWebhook.POST(streamRequest(leg))).status, 200);
  assert.deepEqual(captureStarts.map((args) => args.leg), ["parent", "callee"]);
  assert.equal(mutations.length, 0, "stream events must not masquerade as call lifecycle events");
  await statusWebhook.POST(streamRequest("parent", "stream-stopped"));
  await statusWebhook.POST(streamRequest("parent", "stream-error"));
  assert.equal(captureStarts.length, 2, "only stream-started triggers recording");
  signatureValid = false;
  assert.equal((await statusWebhook.POST(streamRequest("parent"))).status, 403);
  assert.equal(captureStarts.length, 2, "unsigned events cannot trigger capture");
} finally {
  delete globalThis.__bridgeRouteTest;
  for (const [name, value] of Object.entries(streamEnv)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}

const workspaceFunctions = await loadBackend("../convex/workspaces.ts");
const bridgeFunctions = await loadBackend("../convex/translationBridge.ts");
const realtimeFunctions = await loadBackend("../convex/realtimeRuntime.ts");
const twilioFunctions = await loadBackend("../convex/twilioProvider.ts");
const actualNow = Date.now;
const previousWorkerSecret = process.env.REALTIME_CONVEX_WORKER_SECRET;
process.env.REALTIME_CONVEX_WORKER_SECRET = "test-only";
let clock = 1_000_000;
Date.now = () => clock;
try {
  const rows = new Map([
    ["profile", { _id: "profile", userId: "user", defaultWorkspaceId: "workspace", table: "profiles" }],
    ["membership", { _id: "membership", workspaceId: "workspace", userId: "user", role: "owner", table: "workspaceMemberships" }],
    ["workspace", { _id: "workspace", table: "workspaces" }],
    ["call", { _id: "call", workspaceId: "workspace", createdByProfileId: "profile", bridgeModeRequested: true, parentCallSid: "CAparent", bridgeCalleeCallSid: "CAcallee", status: "in_progress", bridgeMaxCallSeconds: 1800, table: "calls" }],
  ]);
  const jobs = [];
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user" }) },
    db: {
      get: async (id) => rows.get(id),
      patch: async (id, patch) => Object.assign(rows.get(id), patch),
      query: (table) => {
        const matches = [];
        const q = { eq: (key, value) => { matches.push([key, value]); return q; } };
        const selected = () => [...rows.values()].filter((row) => row.table === table && matches.every(([key, value]) => row[key] === value));
        const builder = { collect: async () => selected(), first: async () => selected()[0] ?? null, withIndex: (_name, filter) => { filter(q); return builder; } };
        return builder;
      },
    },
    scheduler: { runAfter: async (delay, ref, args) => jobs.push({ delay, name: getFunctionName(ref), args }) },
  };
  const updateDisclosure = (state, secret = "test-only") => realtimeFunctions.updateBridgeDisclosureStateFromWorker._handler(ctx, { secret, callId: "call", state });
  await assert.rejects(updateDisclosure("done", "wrong"), /access denied/);
  for (const state of ["pending", "playing", "readying", "done"]) {
    await updateDisclosure(state);
    assert.equal(rows.get("call").bridgeDisclosureState, state);
  }
  await updateDisclosure("playing");
  await updateDisclosure("failed");
  assert.equal(rows.get("call").bridgeDisclosureState, "done", "late writes cannot undo a completed introduction");
  rows.get("call").bridgeDisclosureState = "playing";
  await updateDisclosure("failed");
  await updateDisclosure("done");
  assert.equal(rows.get("call").bridgeDisclosureState, "failed", "failure cannot later become a go-ahead");
  rows.get("call").status = "completed";
  assert.equal((await bridgeFunctions.getLiveBridgeState._handler(ctx, { callId: "call" })).calleePhase, "startup_failed");
  rows.get("call").workspaceId = "other";
  assert.equal(await bridgeFunctions.getLiveBridgeState._handler(ctx, { callId: "call" }), null);
  rows.get("call").workspaceId = "workspace";
  rows.get("call").bridgeDisclosureState = undefined;
  await updateDisclosure("playing");
  assert.equal(rows.get("call").bridgeDisclosureState, undefined, "ended calls do not acquire a live introduction status");
  rows.get("call").status = "in_progress";
  const webhookSecretBefore = process.env.TWILIO_CONVEX_WEBHOOK_SECRET;
  process.env.TWILIO_CONVEX_WEBHOOK_SECRET = "test-only";
  try {
    Object.assign(rows.get("call"), { provider: "twilio", callMode: "human_twilio_bridge" });
    const connectTokenHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("test-session"))).toString("hex");
    rows.set("session", { _id: "session", table: "twilioCallSessions", callId: "call", workspaceId: "workspace", connectTokenHash, status: "pending", expiresAt: clock + 60_000 });
    for (const status of [undefined, "released", "settled"]) {
      if (status) rows.set("reservation", { _id: "reservation", table: "creditReservations", callId: "call", status, reservedSeconds: 1800 });
      await assert.rejects(twilioFunctions.validateSessionForTwiML._handler(ctx, {
        secret: "test-only", callId: "call", sessionToken: "test-session", parentCallSid: "CAparent",
      }), /credit reservation is no longer active/, "a paid bridge cannot fall back to an unfunded long call");
      assert.equal(rows.get("session").status, "pending", "rejected setup does not consume the session");
    }
  } finally {
    if (webhookSecretBefore === undefined) delete process.env.TWILIO_CONVEX_WEBHOOK_SECRET;
    else process.env.TWILIO_CONVEX_WEBHOOK_SECRET = webhookSecretBefore;
  }
  for (const minutes of [30, 45, 60]) {
    await workspaceFunctions.setVoiceTranslationMaxCallMinutes._handler(ctx, { minutes });
    assert.equal(rows.get("workspace").voiceTranslationMaxCallMinutes, minutes);
  }
  rows.get("membership").role = "member";
  await assert.rejects(workspaceFunctions.setVoiceTranslationMaxCallMinutes._handler(ctx, { minutes: 60 }), /owner access/);
  const sync = (args = {}) => realtimeFunctions.syncBridgeInactivityFromWorker._handler(ctx, {
    secret: "test-only", callId: "call", providerCallSid: "CAparent", lastActivityAt: clock - 120_000, endIfIdle: false, ...args,
  });
  await assert.rejects(sync({ secret: "wrong" }), /access denied/);
  await assert.rejects(sync({ providerCallSid: "CAforeign" }), /access denied/);
  await sync();
  assert.equal(rows.get("call").bridgeInactivityDeadlineAt, clock + 60_000);
  rows.get("call").workspaceId = "other";
  await assert.rejects(bridgeFunctions.keepBridgeConnected._handler(ctx, { callId: "call" }), /Only the caller/);
  rows.get("call").workspaceId = "workspace";
  rows.get("call").createdByProfileId = "other";
  await assert.rejects(bridgeFunctions.keepBridgeConnected._handler(ctx, { callId: "call" }), /Only the caller/);
  rows.get("call").createdByProfileId = "profile";
  const oldActivityAt = clock - 120_000;
  await bridgeFunctions.keepBridgeConnected._handler(ctx, { callId: "call" });
  assert.equal(rows.get("call").bridgeInactivityDeadlineAt, undefined);
  assert.equal(rows.get("call").bridgeMaxCallSeconds, 1800, "Keep connected never changes the hard cap");
  assert.equal((await sync({ lastActivityAt: oldActivityAt })).lastActivityAt, clock, "a stale worker report cannot overwrite Keep connected");
  await assert.rejects(bridgeFunctions.keepBridgeConnected._handler(ctx, { callId: "call" }), /no longer active/);
  const keptAt = clock;
  clock += 120_000;
  await sync({ lastActivityAt: keptAt });
  assert.equal(rows.get("call").bridgeInactivityDeadlineAt, clock + 60_000);
  clock += 60_000;
  await assert.rejects(bridgeFunctions.keepBridgeConnected._handler(ctx, { callId: "call" }), /no longer active/);
  assert.equal((await sync({ lastActivityAt: keptAt, endIfIdle: true })).ended, true);
  assert.equal(rows.get("call").bridgeEndReason, "inactivity");
  assert.deepEqual(jobs.map((job) => job.args.callSid), ["CAparent", "CAcallee"]);
  await sync({ lastActivityAt: keptAt, endIfIdle: true });
  assert.equal(jobs.length, 2, "replayed cutoff cannot schedule duplicate termination jobs");
} finally {
  Date.now = actualNow;
  if (previousWorkerSecret === undefined) delete process.env.REALTIME_CONVEX_WORKER_SECRET;
  else process.env.REALTIME_CONVEX_WORKER_SECRET = previousWorkerSecret;
}

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { ConvexProvider, ConvexReactClient } = createRequire(import.meta.url)("convex/react");
const { BridgeInactivityNotice } = await loadApp("../src/components/dialer/bridge-inactivity-notice.tsx");
const renderingClient = new ConvexReactClient("https://example.convex.cloud");
try {
  const renderNotice = (deadlineAt) => renderToStaticMarkup(createElement(ConvexProvider, { client: renderingClient },
    createElement(BridgeInactivityNotice, { callId: "call", deadlineAt })));
  const warningHtml = renderNotice(Date.now() + 60_000);
  assert.ok(warningHtml.includes("Keep connected"));
  assert.ok(warningHtml.includes("not extra call time or credits"));
  assert.ok(!warningHtml.includes('disabled=""'));
  const expiredHtml = renderNotice(Date.now() - 1000);
  assert.ok(expiredHtml.includes('disabled=""'));
  assert.ok(expiredHtml.includes("Ending the inactive call"));
} finally { await renderingClient.close(); }
console.log("Twilio bridge lifecycle tests passed.");
