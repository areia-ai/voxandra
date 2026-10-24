import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { getFunctionName } from "convex/server";

const require = createRequire(import.meta.url);
const react = require("react");
const testEnv = {};
let hooks;
let context;
let nextSessionId = 0;
let sessionCount = 0;
let lastSessionArgs;
let consentStored = false;
let pathname = "/app";
const timers = new Map();
const routes = [];
const devices = [];
const queries = {
  "profiles:getMyWorkspace": { _id: "workspace-test" },
  "contacts:getContacts": [],
  "callingNumbers:getCallingNumbers": [],
  "twilioCalls:getTwilioSetupStatus": { enabled: true, configured: true, hasDestinationAllowlist: true },
  "twilioCalls:getFreeCallStatus": { eligible: false, used: true },
  "twilioCalls:estimateDestinationRate": { available: true, retailRateCentsPerMinute: 5 },
};
const mutations = {
  "twilioCalls:createOutboundSession": async (args) => {
    lastSessionArgs = args;
    sessionCount += 1;
    return { callId: `call-${++nextSessionId}`, sessionToken: "test-session", maxCallSeconds: 1800 };
  },
  "twilioCalls:cancelOutboundSession": async () => {},
  "callKeypad:recordKeypadPress": async () => {},
  "callGuidance:updateCallGuidanceItemStatus": async () => {},
  "contacts:createContact": async () => {},
};

class MockCall extends EventEmitter {
  disconnect() {
    if (this.closed || this.deferDisconnect) return;
    this.closed = true;
    this.emit("disconnect", {});
  }
}
class MockDevice extends EventEmitter {
  constructor() {
    super();
    devices.push(this);
  }
  async connect() {
    this.call = new MockCall();
    return this.call;
  }
  destroy() { this.destroyed = true; }
  disconnectAll() { this.call?.disconnect(); }
}

const result = await build({
  stdin: {
    contents: 'export { DialerMock } from "./src/components/dialer/dialer-mock"; export { CallProvider } from "./src/components/providers/call-provider";',
    resolveDir: new URL("..", import.meta.url).pathname,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  packages: "external",
  plugins: [{
    name: "mock-calling-boundaries",
    setup(plugin) {
      plugin.onResolve({ filter: /^@twilio\/voice-sdk$/ }, () => ({ path: "sdk", namespace: "test" }));
      plugin.onResolve({ filter: /^@\/lib\/analytics$/ }, () => ({ path: "analytics", namespace: "test" }));
      plugin.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
        contents: path === "sdk"
          ? "export const Device = globalThis.MockDevice;"
          : "export function captureProductEvent() {}",
      }));
    },
  }],
});
const testModule = { exports: {} };
runInNewContext(result.outputFiles[0].text, {
  module: testModule,
  exports: testModule.exports,
  require(name) {
    if (name === "react") return {
      ...react,
      useState(initial) {
        const index = hooks.index++;
        const owner = hooks;
        if (!(index in owner.values)) owner.values[index] = typeof initial === "function" ? initial() : initial;
        return [owner.values[index], (value) => {
          owner.values[index] = typeof value === "function" ? value(owner.values[index]) : value;
        }];
      },
      useRef(initial) {
        const index = hooks.index++;
        return hooks.values[index] ??= { current: initial };
      },
      useMemo: (compute) => compute(),
      useCallback: (callback) => callback,
      useEffect: () => {},
      useContext: () => context,
    };
    if (name === "convex/react") return {
      useQuery: (reference, args) => args === "skip" ? undefined : queries[getFunctionName(reference)],
      useMutation: (reference) => {
        const mutation = mutations[getFunctionName(reference)];
        assert.ok(mutation, `unexpected mutation ${getFunctionName(reference)}`);
        return mutation;
      },
    };
    if (name === "@convex-dev/auth/react") return { useAuthToken: () => "test-auth" };
    if (name === "next/navigation") return {
      useRouter: () => ({ push: (route) => routes.push(route) }),
      usePathname: () => pathname,
    };
    return require(name);
  },
  MockDevice,
  process: { env: testEnv },
  console: { ...console, error: () => {} },
  DOMException,
  fetch: async (url) => {
    assert.equal(url, "/api/twilio/token", "no SMS, trial grant, real network or payment requests");
    return { ok: true, json: async () => ({ token: "test-token" }) };
  },
  navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
  window: {
    localStorage: { getItem: () => consentStored ? "1" : null, setItem() {} },
    setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  },
});
const { CallProvider, DialerMock } = testModule.exports;
let providerHooks;
let dialerHooks;
let handoff;
let dismissals;
function fresh() {
  providerHooks = { values: [], index: 0 };
  dialerHooks = { values: [], index: 0 };
  timers.clear();
  routes.length = 0;
  devices.length = 0;
  sessionCount = 0;
  handoff = null;
  dismissals = 0;
  consentStored = false;
  pathname = "/app";
  renderProvider();
}
function renderProvider() {
  hooks = providerHooks;
  hooks.index = 0;
  context = CallProvider({ children: null }).props.value;
}
function renderDialer(variant = "dashboard") {
  renderProvider();
  hooks = dialerHooks;
  hooks.index = 0;
  return DialerMock({
    variant,
    initialPhoneNumber: "+12025550123",
    postCallHandoff: handoff,
    onCallEnd: () => { handoff = { stage: "processing", title: "Test call", phoneNumber: "+12025550123", actions: [] }; },
    onDismissPostCall: () => { handoff = null; dismissals += 1; },
  });
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(text).join("");
  return text(tree?.props?.children ?? "");
}
function button(tree, label) {
  const found = nodes(tree).find((node) => node.type === "button" &&
    (node.props["aria-label"] === label || text(node) === label));
  assert.ok(found, `button ${label} is rendered`);
  assert.ok(!found.props.disabled, `button ${label} is enabled`);
  return found;
}
async function startFromDialer(variant = "dashboard") {
  await button(renderDialer(variant), "Start call").props.onClick();
  if (!consentStored) {
    await button(renderDialer(variant), "I have permission").props.onClick();
  }
  renderProvider();
}
function finish() {
  devices.at(-1).call.emit("accept");
  renderProvider();
  assert.equal(context.call.phase, "in_call");
  context.endCall();
  renderProvider();
  assert.equal(context.call.phase, "completed");
}
function flushTimers() {
  const pending = [...timers.values()];
  timers.clear();
  pending.forEach((callback) => callback());
}

for (const variant of ["dashboard", "full"]) {
  for (const stored of [true, false]) {
    fresh();
    consentStored = stored;
    await startFromDialer(variant);
    assert.equal(sessionCount, 1);
    finish();
    await startFromDialer(variant);
    assert.equal(sessionCount, 2, `${variant}: completed call can be followed by a second call (stored consent: ${stored})`);
    assert.equal(context.call.phase, "connecting");
    finish();
    await startFromDialer(variant);
    assert.equal(sessionCount, 3, `${variant}: repeated calls work without reloading`);
  }
}

for (const stage of ["processing", "ready", "failed"]) {
  fresh();
  consentStored = true;
  await startFromDialer();
  finish();
  flushTimers();
  handoff.stage = stage;
  await button(renderDialer(), stage === "failed" ? "Call again" : "Start another call").props.onClick();
  renderProvider();
  assert.equal(dismissals, 1);
  assert.equal(context.call.phase, "idle", `${stage}: dismissing the handoff resets the dialer`);
  await startFromDialer();
  assert.equal(sessionCount, 2);
}

for (const variant of ["dashboard", "full"]) {
  for (const event of ["error", "cancel", "reject"]) {
    fresh();
    consentStored = true;
    await startFromDialer(variant);
    devices.at(-1).call.closed = true;
    devices.at(-1).call.emit(event, new Error("Test failure"));
    renderProvider();
    assert.equal(context.call.phase, "failed");
    await startFromDialer(variant);
    assert.equal(sessionCount, 2, `${variant}: ${event} calls can be retried`);
    assert.equal(context.call.phase, "connecting");
  }
}

fresh();
consentStored = true;
await startFromDialer();
finish();
pathname = "/app/calls/test-record";
renderProvider();
flushTimers();
pathname = "/app";
dialerHooks = { values: [], index: 0 };
await startFromDialer();
assert.equal(sessionCount, 2, "returning from a Call Record can start another call without remounting the provider");

fresh();
await button(renderDialer(), "Start call").props.onClick();
assert.equal(sessionCount, 0, "opening consent does not place a call");
await button(renderDialer(), "Cancel").props.onClick();
assert.equal(sessionCount, 0, "canceling consent does not place a call");

fresh();
consentStored = true;
await button(renderDialer(), "Start call").props.onClick();
for (const event of [null, "ringing", "accept"]) {
  if (event) devices.at(-1).call.emit(event);
  renderProvider();
  assert.equal(nodes(renderDialer()).some((node) => node.type === "button" && node.props["aria-label"] === "Start call"), false);
  await context.startCall({ phoneNumber: "+12025550123" });
  assert.equal(sessionCount, 1, "active calls block a second session");
}
devices.at(-1).call.deferDisconnect = true;
context.endCall();
renderProvider();
assert.equal(context.call.phase, "processing");
await context.startCall({ phoneNumber: "+12025550123" });
assert.equal(sessionCount, 1, "a call still disconnecting blocks a second session");
assert.equal(nodes(renderDialer()).some((node) => node.type === "button" && node.props["aria-label"] === "Start call"), false);

for (const action of ["reset", "redial"]) {
  fresh();
  consentStored = true;
  await startFromDialer();
  finish();
  if (action === "reset") context.resetCallState();
  else await startFromDialer();
  flushTimers();
  assert.equal(handoff, null, `${action}: old delayed handoff cannot replace the new dialer`);
  assert.deepEqual(routes, []);
}

fresh();
consentStored = true;
await startFromDialer();
finish();
pathname = "/app/memory";
renderProvider();
flushTimers();
assert.equal(routes.length, 1, "normal completion still routes to the record away from the dashboard");
for (const variant of ["dashboard", "full"]) {
  fresh(); consentStored = true;
  queries["twilioCalls:getFreeCallStatus"] = { eligible: true, used: false, maxSeconds: 90, translatedTrialEnabled: true };
  queries["translationBridge:getBridgeModeAvailability"] = { available: false };
  queries["realtimeUsage:getRealtimeUsageSummary"] = { planId: "free", translatedCaptions: { canStart: false },
    translatedAudio: { canStart: false }, liveCopilot: { canStart: false } };
  const tree = renderDialer(variant);
  const blocked = nodes(tree).find((node) => node.type === "button" && (node.props["aria-label"] === "Start free trial call" || text(node) === "Start free trial call"));
  assert.ok(blocked.props.disabled, "workspace/global translation controls still block calls");
  assert.equal(sessionCount, 0, "rendering never starts a call");
  queries["translationBridge:getBridgeModeAvailability"] = { available: true };
  const start = button(renderDialer(variant), "Start free trial call");
  await Promise.all([start.props.onClick(), start.props.onClick()]);
  assert.equal(sessionCount, 1, "signed-in trial starts directly and rapid duplicate clicks cannot start two sessions");
  assert.equal(lastSessionArgs.isFreeCall, true);
  assert.equal(Object.hasOwn(lastSessionArgs, "trialGrant"), false);
  assert.equal(lastSessionArgs.enableBridgeMode, true);
  assert.equal(lastSessionArgs.enableTranslatedCaptions, true);
  assert.equal(lastSessionArgs.enableLiveCopilot, false);
  assert.notEqual(lastSessionArgs.translatedCaptionsSourceLanguage, lastSessionArgs.translatedCaptionsTargetLanguage);
}
// Both actual dialer variants expose the full catalog in the staged expansion.
testEnv.NEXT_PUBLIC_PALABRA_EXPANDED_LANGUAGES_ENABLED = "true";
for (const variant of ["dashboard", "full"]) {
  fresh(); consentStored = true;
  queries["twilioCalls:getFreeCallStatus"] = { eligible: true, used: false, maxSeconds: 90, translatedTrialEnabled: true };
  queries["translationBridge:getBridgeModeAvailability"] = { available: true };
  const languageSelectors = nodes(renderDialer(variant)).filter((node) => node.type === "select" && nodes(node).filter((n) => n.type === "option").length === 48);
  assert.equal(languageSelectors.length, 2, `${variant}: both participants get 48 languages`);
  languageSelectors[0].props.onChange({ target: { value: "he" } });
  languageSelectors[1].props.onChange({ target: { value: "cy" } });
  const start = button(renderDialer(variant), "Start free trial call");
  await start.props.onClick();
  assert.equal(lastSessionArgs.translatedCaptionsTargetLanguage, "he");
  assert.equal(lastSessionArgs.translatedCaptionsSourceLanguage, "cy");
  assert.equal(lastSessionArgs.enableBridgeMode, true);
}
console.log("Dialer lifecycle tests passed.");
