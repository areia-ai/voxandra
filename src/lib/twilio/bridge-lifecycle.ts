// Pure decision logic for the two-leg translated-call bridge lifecycle.
//
// Deliberately dependency-free: Convex mutations/actions, the Next.js Twilio
// webhook routes, and scripts/test-twilio-bridge-lifecycle.mjs all import it,
// and that test runs under `node --experimental-strip-types` with no bundler,
// so a single transitive extensionless import would break it. Keeping the
// rules here (rather than inline in the webhook handlers) is what makes them
// testable at all — the 2026-07-30 orphaned-leg incident was caused by
// untestable branch logic buried inside a mutation.

/** Terminal values of Twilio's `Call.status` / `CallStatus` callback field. */
export const TWILIO_TERMINAL_CALL_STATUSES = [
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
] as const;

/**
 * Terminal values of Voxandra's own `calls.status`. `normalizeTwilioStatus`
 * passes Twilio's terminal names through unchanged, so this is that set plus
 * the Voxandra-only `expired` (session TTL) state.
 */
export const VOXANDRA_TERMINAL_CALL_STATUSES = [
  ...TWILIO_TERMINAL_CALL_STATUSES,
  "expired",
] as const;

/**
 * Twilio ends a call itself at `timeLimit`, but only for legs it created with
 * one. A browser leg answered with `<Connect><Stream>` has no `<Dial>` and
 * therefore no provider-side maximum at all, so both legs also get a Voxandra
 * deadline. The grace period lets Twilio's own `timeLimit` win the normal
 * case, so the deadline job is a backstop rather than the primary mechanism.
 */
export const BRIDGE_TERMINATION_GRACE_SECONDS = 20;

/**
 * How long after a reservation's own `reservedSeconds` a still-`reserved`
 * reservation is considered abandoned. Every call path caps the provider leg
 * at `reservedSeconds` (`<Dial timeLimit>` or `calls.create({ timeLimit })`),
 * so a call cannot legitimately outlive it; anything past this window means a
 * terminal status callback was lost and the credits are stranded.
 */
export const STALE_RESERVATION_GRACE_SECONDS = 10 * 60;

export function isTerminalTwilioCallStatus(status: string | undefined | null) {
  if (!status) return false;
  return (TWILIO_TERMINAL_CALL_STATUSES as readonly string[]).includes(status);
}

export function isTerminalVoxandraCallStatus(status: string | undefined | null) {
  if (!status) return false;
  return (VOXANDRA_TERMINAL_CALL_STATUSES as readonly string[]).includes(status);
}

export type TwilioTerminationStatus = "canceled" | "completed";

/**
 * Which `Status` value to POST to Twilio to end a call in a given state.
 *
 * Twilio only accepts `canceled` or `completed` (verified against the
 * installed SDK's `CallUpdateStatus`), and rejects the wrong one for the
 * call's current state with a 400. Because the state can change between
 * reading it and writing it — a `ringing` leg is answered mid-flight — this
 * returns both verbs so the caller can retry with `fallback` instead of
 * giving up. Attempting one verb once, as the original fix did, silently left
 * the sibling leg alive.
 *
 * Returns `undefined` when the call is already terminal (nothing to do).
 */
export function resolveTwilioTerminationStatus(
  currentStatus: string | undefined | null
): { primary: TwilioTerminationStatus; fallback: TwilioTerminationStatus } | undefined {
  if (isTerminalTwilioCallStatus(currentStatus)) return undefined;
  // `initiated` is a callback event name rather than a Call resource status,
  // but treat it (and `queued`/`ringing`) as not-yet-answered.
  if (currentStatus === "queued" || currentStatus === "ringing" || currentStatus === "initiated") {
    return { primary: "canceled", fallback: "completed" };
  }
  // `in-progress` and anything unrecognized: assume answered, fall back to
  // cancel. Guessing "answered" is the safe default — a redundant `completed`
  // on an unanswered leg fails with a 400 we then retry as `canceled`.
  return { primary: "completed", fallback: "canceled" };
}

export type BridgeLeg = "parent" | "callee";

/**
 * Which leg of a bridge call a status callback belongs to.
 *
 * The callee leg is created via the REST API, so its `statusCallback` URL
 * carries an explicit `bridgeLeg=callee` label. The browser parent leg has no
 * `<Dial>` and therefore no per-call callback of its own — its single terminal
 * event arrives via the TwiML Application's console-configured Status Callback
 * URL, which cannot carry per-call query parameters. Production evidence from
 * the 2026-07-30 incident: `Direction: inbound`, `SequenceNumber: 0`, no
 * `ParentCallSid`, no `voxandraCallId`. Defaulting an unlabeled bridge
 * callback to `parent` is therefore correct, not merely convenient.
 */
export function classifyBridgeLeg(args: {
  bridgeModeRequested: boolean;
  labeledLeg?: BridgeLeg;
  providerCallSid?: string;
  bridgeCalleeCallSid?: string;
  parentCallSid?: string;
}): BridgeLeg | undefined {
  if (!args.bridgeModeRequested) return undefined;
  if (args.labeledLeg) return args.labeledLeg;
  if (args.providerCallSid && args.providerCallSid === args.bridgeCalleeCallSid) {
    return "callee";
  }
  if (args.providerCallSid && args.providerCallSid === args.parentCallSid) {
    return "parent";
  }
  return "parent";
}

/**
 * Whether a status callback may overwrite the call record's lifecycle fields.
 *
 * Twilio does not guarantee callback ordering (that is what `SequenceNumber`
 * is for), and a bridge call has two independent callback streams. A late
 * non-terminal event must never drag a finished call back to `in_progress` /
 * `calling`, which would strand it outside the post-call pipeline forever.
 */
export function shouldApplyProviderStatusPatch(args: {
  existingStatus?: string;
  existingEndedAt?: string;
  incomingIsTerminal: boolean;
}) {
  if (args.incomingIsTerminal) return true;
  if (args.existingEndedAt) return false;
  return !isTerminalVoxandraCallStatus(args.existingStatus);
}

/** Milliseconds from leg creation until the Voxandra termination backstop fires. */
export function bridgeTerminationDelayMs(maxCallSeconds: number) {
  const seconds = Number.isFinite(maxCallSeconds) ? Math.floor(maxCallSeconds) : 0;
  return (Math.max(0, seconds) + BRIDGE_TERMINATION_GRACE_SECONDS) * 1000;
}

/** Whether a still-`reserved` reservation is old enough to be swept. */
export function isReservationAbandoned(args: {
  createdAt: number;
  reservedSeconds: number;
  now: number;
}) {
  const reserved = Number.isFinite(args.reservedSeconds)
    ? Math.max(0, Math.floor(args.reservedSeconds))
    : 0;
  const deadline =
    args.createdAt + (reserved + STALE_RESERVATION_GRACE_SECONDS) * 1000;
  return args.now > deadline;
}
