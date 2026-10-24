import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const secret = randomBytes(32).toString("hex");
const destination = "+14155550101";
let time = 1800000000000;
class Clock extends Date { static now() { return time; } }
const env = {};
const result = await build({
  stdin: { contents: `export * as access from './convex/trialAccess'; export { recordRealtimeUsageEvent } from './convex/realtimeBilling'; export { createOutboundSession,cancelOutboundSession } from './convex/twilioCalls'; export { validateSessionForTwiML } from './convex/twilioProvider'; export { POST } from './src/app/api/trial/route'; export * as policy from './src/lib/translated-trial';`,
    resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
  bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
  plugins: [{ name: "offline-trial-boundaries", setup(plugin) {
    plugin.onResolve({ filter: /(?:_generated\/server|authHelpers|callGuidance|realtimeRuntime)$/ }, ({ path }) => ({ path, namespace: "trial-test" }));
    plugin.onLoad({ filter: /.*/, namespace: "trial-test" }, ({ path }) => ({ contents:
      path.endsWith("_generated/server") ? `export const mutation=x=>x, query=x=>x, internalMutation=x=>x, internalQuery=x=>x, action=x=>x, internalAction=x=>x;` :
      path.endsWith("authHelpers") ? `export async function requireWorkspaceMembership(ctx){ if(!ctx.access)throw Error('unauthenticated');return ctx.access; } export async function requireWorkspace(ctx){return (await requireWorkspaceMembership(ctx)).workspaceId;} export const requireWorkspaceAdmin=requireWorkspaceMembership;` :
      path.endsWith("callGuidance") ? `export async function seedDeterministicGuidanceItems(){} export async function buildLiveGuidanceContextSnapshot(){return undefined;}` :
      `export async function createRequestedRealtimeSession(ctx,args){return ctx.db.insert('realtimeSessions',{...args,status:'requested'});}`
    }));
  } }],
});
const testModule = { exports: {} };
runInNewContext(result.outputFiles[0].text, { module: testModule, exports: testModule.exports, require, Buffer, URL,
  TextEncoder, Uint8Array, crypto: webcrypto, Date: Clock, process: { env }, console,
  fetch() { throw new Error("network_forbidden"); },
});
const { access, POST, createOutboundSession, cancelOutboundSession, validateSessionForTwiML,
  recordRealtimeUsageEvent, policy } = testModule.exports;
let rows, serial, context;
function reset() {
  rows = new Map(); serial = 0; time = 1800000000000;
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { TRANSLATED_TRIAL_ENABLED: "true", TWILIO_ALLOWED_COUNTRIES: "US,PT",
    TWILIO_FREE_CALL_ALLOWED_COUNTRIES: "PT", REALTIME_VOICE_TRANSLATION_ENABLED: "true",
    NEXT_PUBLIC_TWILIO_CALLING_ENABLED: "true", TWILIO_CALLER_ID: "+14155550102",
    TWILIO_CONVEX_WEBHOOK_SECRET: secret });
  const db = {
    query(table) {
      const filters = [];
      let reverse = false;
      const values = () => [...rows.values()].filter((r) => r._table === table && filters.every((f) => f(r)))
        .sort((a, b) => (reverse ? -1 : 1) * (a._creationTime - b._creationTime));
      const q = {
        withIndex(_name, callback) {
          const builder = { eq(key, value) { filters.push((r) => r[key] === value); return builder; },
            gt(key, value) { filters.push((r) => r[key] > value); return builder; },
            gte(key, value) { filters.push((r) => r[key] >= value); return builder; },
            lt(key, value) { filters.push((r) => r[key] < value); return builder; } };
          callback?.(builder); return q;
        },
        order(value) { reverse = value === "desc"; return q; },
        async take(n) { return values().slice(0, n); }, async collect() { return values(); },
        async first() { return values()[0] ?? null; },
        async unique() { const items = values(); assert.ok(items.length <= 1); return items[0] ?? null; },
      };
      return q;
    },
    async get(id) { return rows.get(id) ?? null; },
    async insert(table, value) { const id = table + ":" + ++serial; rows.set(id, { ...value, _id: id, _table: table, _creationTime: serial }); return id; },
    async patch(id, changes) { assert.ok(rows.has(id)); const row = { ...rows.get(id), ...changes }; for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key]; rows.set(id, row); },
    async delete(id) { rows.delete(id); },
  };
  context = { db, access: { workspaceId: "workspace-test", userId: "user-test", profile: { _id: "profile-test", email: "operator@example.test" } },
    scheduler: { runAfter: async () => "scheduled" } };
  rows.set("workspace-test", { _id: "workspace-test", _table: "workspaces", voiceTranslationEnabled: true });
  rows.set("wallet-test", { _id: "wallet-test", _table: "walletSummaries", workspaceId: "workspace-test", planId: "free", subscriptionStatus: "free", freeCallUsed: false });
}
async function invoke(definition, args) {
  const before = structuredClone(rows);
  try { return await definition.handler(context, args); }
  catch (error) { rows = before; throw error; }
}
const count = (table) => [...rows.values()].filter((row) => row._table === table).length;
const trialArgs = () => ({ phoneNumber: destination, isFreeCall: true, enableTranslatedCaptions: true,
  enableBridgeMode: true, translatedCaptionsSourceLanguage: "es", translatedCaptionsTargetLanguage: "en" });
const create = (changes = {}) => invoke(createOutboundSession, { ...trialArgs(), ...changes });
const claim = (session) => invoke(validateSessionForTwiML, { secret, callId: session.callId,
  sessionToken: session.sessionToken, parentCallSid: "CA" + randomBytes(16).toString("hex") });

reset();
let session = await create();
assert.equal(session.bridgeModeRequested, true);
assert.equal(session.translatedCaptionsRequested, true);
assert.equal(session.realtimeCopilotRequested, false);
assert.equal(session.maxCallSeconds, 90);
assert.equal(rows.get(session.callId).translatedTrialAuthorized, true);
assert.equal(rows.get(session.callId).bridgeMaxCallSeconds, 90);
assert.equal(count("creditReservations"), 0);
assert.equal(count("trialGrants"), 0);
assert.equal(count("trialVerifications"), 0);
await assert.rejects(() => create(), /already starting/);
let call = rows.get(session.callId);
assert.equal(await access.isAuthorizedTranslatedTrialCall(context, call, "translated_audio"), false);
const claimed = await claim(session);
assert.equal(claimed.maxCallSeconds, 90);
assert.equal(rows.get("wallet-test").freeCallUsed, true);
assert.equal(rows.get("wallet-test").freeCallUsedCallId, session.callId);
assert.equal(await access.isAuthorizedTranslatedTrialCall(context, rows.get(session.callId), "translated_audio"), true);
await assert.rejects(() => claim(session), /already been used/);
await assert.rejects(() => create(), /already been used/);
context.access.userId = "other-member";
await assert.rejects(() => create(), /already been used/);
context.access.userId = "user-test";
context.access.workspaceId = "second-workspace";
rows.set("second-workspace", { _id: "second-workspace", _table: "workspaces", voiceTranslationEnabled: true });
rows.set("second-wallet", { _id: "second-wallet", _table: "walletSummaries", workspaceId: "second-workspace", planId: "free", subscriptionStatus: "free", freeCallUsed: false });
assert.equal((await create()).isFreeCall, true, "trial allowance is per workspace");

for (const scenario of ["anonymous", "missing-email", "paid", "source-auto", "same-language", "translation-off", "workspace-off", "blocked-country", "missing-bridge", "guidance"]) {
  reset();
  const args = {};
  if (scenario === "anonymous") context.access = undefined;
  if (scenario === "missing-email") context.access.profile.email = "";
  if (scenario === "paid") rows.get("wallet-test").planId = "solo";
  if (scenario === "source-auto") args.translatedCaptionsSourceLanguage = "auto";
  if (scenario === "same-language") args.translatedCaptionsSourceLanguage = "en";
  if (scenario === "translation-off") env.REALTIME_VOICE_TRANSLATION_ENABLED = "false";
  if (scenario === "workspace-off") rows.get("workspace-test").voiceTranslationEnabled = false;
  if (scenario === "blocked-country") env.TWILIO_ALLOWED_COUNTRIES = "PT";
  if (scenario === "missing-bridge") args.enableBridgeMode = false;
  if (scenario === "guidance") args.enableLiveCopilot = true;
  await assert.rejects(() => create(args), undefined, scenario);
  assert.equal(count("calls"), 0, scenario);
  assert.equal(count("trialGrants"), 0);
}
reset();
assert.equal((await create({ phoneNumber: "+351210000000", translatedCaptionsSourceLanguage: "pt" })).maxCallSeconds, 90);
reset();
env.TRANSLATED_TRIAL_DAILY_BUDGET_CENTS = "0";
env.TRANSLATED_TRIAL_ALLOWED_COUNTRIES = "PT";
assert.equal((await create()).maxCallSeconds, 90, "retired budget and trial-country settings no longer restrict supported routes");
reset();
env.TRANSLATED_TRIAL_ENABLED = "false";
env.TWILIO_FREE_CALL_ALLOWED_COUNTRIES = "US";
await assert.rejects(() => create());
session = await create({ enableBridgeMode: false, enableTranslatedCaptions: false });
assert.equal(session.bridgeModeRequested, false);
assert.equal((await claim(session)).maxCallSeconds, 90);
reset();
session = await create();
env.TRANSLATED_TRIAL_ENABLED = "false";
await assert.rejects(() => claim(session));
assert.equal(rows.get("wallet-test").freeCallUsed, false);
reset();
session = await create();
time += 5 * 60_000 + 1;
await assert.rejects(() => claim(session), /expired/);
assert.equal(rows.get("wallet-test").freeCallUsed, false);
reset();
session = await create();
await invoke(cancelOutboundSession, { callId: session.callId, sessionToken: session.sessionToken });
assert.equal(rows.get("wallet-test").freeCallUsed, false);
assert.equal((await create()).maxCallSeconds, 90);

reset();
session = await create();
const realtimeSessionId = session.realtimeSessionIds.translatedCaptions;
const usage = { workspaceId: "workspace-test", callId: session.callId, realtimeSessionId,
  feature: "translated_audio", durationSeconds: 90, startedAt: time, endedAt: time + 90_000 };
await assert.rejects(() => recordRealtimeUsageEvent(context, usage));
await claim(session);
env.TRANSLATED_TRIAL_ENABLED = "false";
await context.db.patch("wallet-test", { planId: "solo", subscriptionStatus: "active" });
const eventId = await recordRealtimeUsageEvent(context, usage);
const event = rows.get(eventId);
assert.equal(event.chargedCents, 0); assert.equal(event.overageCents, 0); assert.equal(event.chargeStatus, "not_required");
assert.equal(event.estimatedProviderCostCents, 12); assert.equal(event.isFreeTrial, true);
assert.equal(await recordRealtimeUsageEvent(context, usage), eventId);
await assert.rejects(() => recordRealtimeUsageEvent(context, { ...usage, feature: "live_copilot" }));
await assert.rejects(() => recordRealtimeUsageEvent(context, { ...usage, realtimeSessionId: undefined }));
const paidId = await context.db.insert("calls", { workspaceId: "workspace-test", isFreeCall: false });
const paidSession = await context.db.insert("realtimeSessions", { workspaceId: "workspace-test", callId: paidId, mode: "translated_captions" });
await assert.rejects(() => recordRealtimeUsageEvent(context, { ...usage, realtimeSessionId: paidSession }));
const paidEventId = await recordRealtimeUsageEvent(context, { ...usage, callId: paidId, realtimeSessionId: paidSession, durationSeconds: 300 });
assert.equal(rows.get(paidEventId).includedSecondsApplied, 300);
assert.equal(rows.get(paidEventId).overageCents, 0);
call = rows.get(session.callId);
assert.equal(await access.isAuthorizedTranslatedTrialCall(context, { ...call, translatedTrialAuthorized: undefined }, "translated_audio"), false);
assert.equal(await access.isAuthorizedTranslatedTrialCall(context, { ...call, freeCallClaimedAt: undefined }, "translated_audio"), false);
const legacyGrant = await context.db.insert("trialGrants", { status: "used", callId: call._id, workspaceId: call.workspaceId,
  userId: call.createdByUserId, destination: call.dialedNumber, usedAt: time });
assert.equal(await access.isAuthorizedTranslatedTrialCall(context, { ...call, translatedTrialAuthorized: undefined, trialGrantId: legacyGrant }, "translated_audio"), true);
await context.db.patch(legacyGrant, { status: "approved" });
assert.equal(await access.isAuthorizedTranslatedTrialCall(context, { ...call, translatedTrialAuthorized: undefined, trialGrantId: legacyGrant }, "translated_audio"), false);

for (const action of ["send", "check", "authorize"]) {
  const request = new Request("https://example.test/api/trial", { method: "POST", headers: { Authorization: "Bearer unused" }, body: JSON.stringify({ action }) });
  const response = await POST(request);
  assert.equal(response.status, 410);
  assert.equal(request.bodyUsed, false, "retired endpoint never reads OTP or phone data");
  assert.equal(response.headers.get("cache-control"), "no-store");
}
assert.equal((await POST(new Request("https://example.test/api/trial", { method: "POST" }))).status, 401);
reset();
assert.equal(policy.TRANSLATED_TRIAL_SECONDS, 90);
assert.equal(policy.publicTranslatedTrialEnabled(), false);
env.NEXT_PUBLIC_TRANSLATED_TRIAL_ENABLED = "true";
assert.equal(policy.freeTrialLabel(), "free 90-second translated call");
// Expanded language validation runs through the real session mutation, not only helpers.
for (const pair of [["he", "en"], ["en", "he"], ["ar", "nl"], ["zh", "cy"]]) {
  reset();
  const args = { translatedCaptionsSourceLanguage: pair[0], translatedCaptionsTargetLanguage: pair[1] };
  await assert.rejects(() => create(args));
  assert.equal(count("calls"), 0);
  env.PALABRA_EXPANDED_LANGUAGES_ENABLED = "true";
  const expandedSession = await create(args);
  assert.equal(expandedSession.bridgeModeRequested, true);
  assert.equal(expandedSession.maxCallSeconds, 90);
  assert.equal(rows.get(expandedSession.callId).translatedTrialAuthorized, true);
}
reset();
env.PALABRA_EXPANDED_LANGUAGES_ENABLED = "true";
for (const unsupported of ["auto", "fa", "yue", "az", "xx"]) {
  await assert.rejects(() => create({ translatedCaptionsSourceLanguage: unsupported }));
  assert.equal(count("calls"), 0);
}
console.log("Sign-in-only translated trial and legacy settlement tests passed (offline).");
