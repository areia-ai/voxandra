// Caller-facing copy for a Voice Translation call's setup phases. In bridge
// mode the browser leg is "answered" the instant its <Connect><Stream> starts,
// so the Twilio Device reports "in call" while the other person's phone is
// still ringing and again while the spoken disclosure plays to them. These
// labels replace that misleading "In call" with what is actually happening.
// Shared by the dialer card and the mini call bar so they never disagree.

export type LiveBridgeCalleePhase =
  | "dialing"
  | "ringing"
  | "preparing"
  | "disclosure"
  | "readying"
  | "startup_failed"
  | "translating"
  | "degraded"
  | "busy"
  | "no_answer"
  | "failed"
  | "ended";

export type LiveBridgePhaseTone = "waiting" | "hold" | "live" | "degraded" | "ended";

// Collapses the raw signals Convex already stores — the callee leg's Twilio
// status (written by the status callbacks), the worker-reported disclosure
// state, and whether the worker degraded the bridge to a plain call — into one
// caller-facing phase. Twilio reports the `answered` event with status
// "in-progress".
export function resolveLiveBridgeCalleePhase(args: {
  calleeStatus: string | undefined | null;
  disclosureState: string | undefined | null;
  translationDegraded?: boolean;
}): LiveBridgeCalleePhase {
  if (args.disclosureState === "failed") return "startup_failed";
  switch (args.calleeStatus) {
    case "ringing":
      return "ringing";
    case "in-progress":
      if (args.translationDegraded) return "degraded";
      if (args.disclosureState === "readying") return "readying";
      if (!args.disclosureState || args.disclosureState === "pending") return "preparing";
      return args.disclosureState === "done" || args.disclosureState === "skipped"
        ? "translating"
        : "disclosure";
    case "busy":
      return "busy";
    case "no-answer":
      return "no_answer";
    case "failed":
      return "failed";
    case "completed":
    case "canceled":
      return "ended";
    default:
      return "dialing";
  }
}

export function describeLiveBridgePhase(
  phase: LiveBridgeCalleePhase,
  otherPerson: string
): { label: string; hint?: string; tone: LiveBridgePhaseTone } {
  switch (phase) {
    case "dialing":
      return { label: `Calling ${otherPerson}…`, tone: "waiting" };
    case "ringing":
      return { label: `Ringing ${otherPerson}…`, tone: "waiting" };
    case "preparing":
      return { label: "Connected · Preparing the introduction", hint: "Please wait. Your voice isn't reaching the other person yet.", tone: "hold" };
    case "disclosure":
      return {
        label: "Translation notice playing · Please wait",
        hint: `You and ${otherPerson} are hearing the introduction. Your voice won't reach the other person until you hear the spoken go-ahead.`,
        tone: "hold",
      };
    case "readying":
      return { label: "Getting ready · Wait for the spoken go-ahead", tone: "hold" };
    case "startup_failed":
      return { label: "Couldn't start translation", hint: "The conversation didn't start. Please try calling again.", tone: "ended" };
    case "translating":
      return { label: "Translation ready · You can speak now", tone: "live" };
    case "degraded":
      return {
        label: "Translation stopped — you're on a regular call now",
        hint: `Live Translation became unavailable for this call. You and ${otherPerson} now hear each other's real voices at full volume; the call itself continues normally.`,
        tone: "degraded",
      };
    case "busy":
      return { label: `${otherPerson} is busy`, tone: "ended" };
    case "no_answer":
      return { label: `${otherPerson} didn't answer`, tone: "ended" };
    case "failed":
      return { label: `Couldn't reach ${otherPerson}`, tone: "ended" };
    case "ended":
      return { label: `${otherPerson} left the call`, tone: "ended" };
  }
}

// Whether the local Twilio phase should be shown as still-ringing even though
// the browser leg itself has already connected.
export function isLiveBridgeStillConnecting(phase: LiveBridgeCalleePhase | undefined) {
  return phase === "dialing" || phase === "ringing";
}

// The reason a translated call ended before any conversation, if it did.
export function liveBridgeEndReason(
  phase: LiveBridgeCalleePhase | undefined
): LiveBridgeCalleePhase | null {
  return phase === "busy" || phase === "no_answer" || phase === "failed" || phase === "startup_failed" ? phase : null;
}

export function shouldApplyBridgeDisclosureState(current: string | undefined, next: string) {
  const order: Record<string, number> = { pending: 0, playing: 1, readying: 2, done: 3, skipped: 3, failed: 3 };
  return Object.hasOwn(order, next) && (current === undefined || (order[current] < 3 && order[next] > order[current]));
}
