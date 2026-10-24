// Behavioral tests for the caller-facing Voice Translation setup phases.
//
// In bridge mode the browser leg is "answered" the instant <Connect><Stream>
// starts, so without these the dialer said "In call" over up to a minute of
// silence (the other phone ringing, then the spoken disclosure). The mapping
// below is what both the dialer card and the mini call bar render, driven by
// the callee leg's Twilio status and the worker-reported disclosure state.
import assert from "node:assert/strict";
import {
  describeLiveBridgePhase,
  isLiveBridgeStillConnecting,
  liveBridgeEndReason,
  resolveLiveBridgeCalleePhase,
  shouldApplyBridgeDisclosureState,
} from "../src/lib/live-bridge-state.ts";

const resolve = (calleeStatus, disclosureState) =>
  resolveLiveBridgeCalleePhase({ calleeStatus, disclosureState });

// Before Twilio has reported anything about the callee leg, or while it is
// still queued/initiated, the call is being placed.
for (const status of [undefined, null, "queued", "initiated"]) {
  assert.equal(resolve(status, undefined), "dialing", `${status} → dialing`);
}
assert.equal(resolve("ringing", undefined), "ringing");

// Twilio's `answered` callback carries status "in-progress". Until the worker
// says the disclosure finished, the caller must keep waiting.
for (const disclosure of [undefined, null, "pending"]) {
  assert.equal(resolve("in-progress", disclosure), "preparing", `in-progress + ${disclosure} → preparing`);
}
assert.equal(resolve("in-progress", "playing"), "disclosure");
assert.equal(resolve("in-progress", "readying"), "readying");
for (const status of ["in-progress", "completed", "failed", "canceled"]) {
  assert.equal(resolve(status, "failed"), "startup_failed", "the startup failure remains visible after hangup");
}
assert.equal(resolve("in-progress", "done"), "translating");
assert.equal(
  resolve("in-progress", "skipped"),
  "translating",
  "a leg that continued without a disclosure is live immediately"
);

// Once the worker degraded the bridge to a plain call, an in-progress callee is
// "degraded" regardless of where the disclosure got to — and nothing else is.
for (const disclosure of [undefined, "pending", "playing", "done", "skipped"]) {
  assert.equal(
    resolveLiveBridgeCalleePhase({ calleeStatus: "in-progress", disclosureState: disclosure, translationDegraded: true }),
    "degraded",
    `in-progress + degraded + ${disclosure} → degraded`
  );
}
assert.equal(
  resolveLiveBridgeCalleePhase({ calleeStatus: "ringing", disclosureState: undefined, translationDegraded: true }),
  "ringing",
  "degraded only applies once the callee is on the call"
);
assert.equal(
  resolveLiveBridgeCalleePhase({ calleeStatus: "completed", disclosureState: "done", translationDegraded: true }),
  "ended"
);

// Terminal outcomes that mean no conversation happened are named as such.
assert.equal(resolve("busy", undefined), "busy");
assert.equal(resolve("no-answer", undefined), "no_answer");
assert.equal(resolve("failed", undefined), "failed");
assert.equal(resolve("completed", "done"), "ended");
assert.equal(resolve("canceled", undefined), "ended");

// Only dialing/ringing keep the step indicator on "ringing".
assert.equal(isLiveBridgeStillConnecting("dialing"), true);
assert.equal(isLiveBridgeStillConnecting("ringing"), true);
for (const phase of ["disclosure", "translating", "degraded", "busy", "no_answer", "failed", "ended", undefined]) {
  assert.equal(isLiveBridgeStillConnecting(phase), false, `${phase} is not still connecting`);
}

// Only busy/no-answer/failed are surfaced as a post-call reason; a normal hangup is not.
assert.equal(liveBridgeEndReason("busy"), "busy");
assert.equal(liveBridgeEndReason("no_answer"), "no_answer");
assert.equal(liveBridgeEndReason("failed"), "failed");
for (const phase of ["ended", "translating", "degraded", "disclosure", "ringing", "dialing", undefined]) {
  assert.equal(liveBridgeEndReason(phase), null, `${phase} has no end reason`);
}

// Degraded copy: says translation stopped, explains full volume, reassures the
// call continues, and is visually distinct from the hold and live tones.
const degraded = describeLiveBridgePhase("degraded", "Ana Ferreira");
assert.equal(degraded.tone, "degraded");
assert.match(degraded.label, /stopped/i);
assert.match(degraded.hint ?? "", /full volume/);
assert.match(degraded.hint ?? "", /continues/);
assert.match(degraded.hint ?? "", /Ana Ferreira/);

// Copy: names the other person, and the hold phase carries the "wait for the
// tone" instruction that matches the worker's go-ahead chime.
const name = "Ana Ferreira";
assert.equal(describeLiveBridgePhase("ringing", name).label, "Ringing Ana Ferreira…");
assert.equal(describeLiveBridgePhase("dialing", name).tone, "waiting");
const disclosure = describeLiveBridgePhase("disclosure", name);
assert.equal(disclosure.tone, "hold");
assert.match(disclosure.hint ?? "", /spoken go-ahead/, "hold hint matches the audible instruction");
assert.match(disclosure.hint ?? "", /voice won't reach/);
assert.match(describeLiveBridgePhase("preparing", name).label, /Preparing/);
assert.match(describeLiveBridgePhase("readying", name).label, /Wait/);
assert.equal(liveBridgeEndReason("startup_failed"), "startup_failed");
assert.match(disclosure.hint ?? "", /Ana Ferreira/, "hold hint names the other person");
const live = describeLiveBridgePhase("translating", name);
assert.equal(live.tone, "live");
assert.equal(live.hint, undefined, "the live phase needs no instruction");
assert.equal(describeLiveBridgePhase("no_answer", name).label, "Ana Ferreira didn't answer");
assert.equal(describeLiveBridgePhase("busy", name).tone, "ended");
for (const phase of ["dialing", "ringing", "preparing", "disclosure", "readying", "startup_failed", "translating", "degraded", "busy", "no_answer", "failed", "ended"]) {
  const described = describeLiveBridgePhase(phase, name);
  assert.ok(described.label.length > 0, `${phase} has a label`);
  assert.equal(
    /\b(bridge|leg|palabra|twilio|worker)\b/i.test(`${described.label} ${described.hint ?? ""}`),
    false,
    `${phase} copy exposes no internal vocabulary`
  );
}

const states = ["pending", "playing", "readying", "done", "skipped", "failed"];
for (const [index, current] of states.entries()) {
  assert.equal(shouldApplyBridgeDisclosureState(undefined, current), true);
  for (const [nextIndex, next] of states.entries()) {
    assert.equal(shouldApplyBridgeDisclosureState(current, next), index < 3 && nextIndex > index, `${current} → ${next}`);
  }
}
assert.equal(shouldApplyBridgeDisclosureState("done", "playing"), false);
assert.equal(shouldApplyBridgeDisclosureState("failed", "done"), false);
assert.equal(shouldApplyBridgeDisclosureState(undefined, "unknown"), false);
console.log("Live bridge state tests passed.");
