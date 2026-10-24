import type { Id } from "./_generated/dataModel";
import { normalizePhoneE164 } from "../src/lib/phone";
import { getDestinationCountryForPrefix } from "../src/lib/calling-rates";

export const DEFAULT_MAX_CALL_SECONDS = 600;
export const DEFAULT_BRIDGE_MAX_CALL_SECONDS = 1800;
export const FREE_CALL_MAX_SECONDS = 90;
export const TWILIO_SESSION_TTL_MS = 5 * 60 * 1000;

export function getTwilioDeviceIdentity(userId: string) {
  return `vox_${userId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 110)}`;
}

export function isE164(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhoneE164(value));
}

export function getDestinationCountry(destinationE164: string) {
  return getDestinationCountryForPrefix(destinationE164);
}

function splitEnvList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getAllowedNumbers() {
  return splitEnvList(process.env.TWILIO_ALLOWED_NUMBERS);
}

export function getAllowedCountries() {
  return splitEnvList(process.env.TWILIO_ALLOWED_COUNTRIES).map((item) =>
    item.toUpperCase()
  );
}

export function getFreeCallAllowedNumbers() {
  return splitEnvList(process.env.TWILIO_FREE_CALL_ALLOWED_NUMBERS);
}

export function getFreeCallAllowedCountries() {
  return splitEnvList(process.env.TWILIO_FREE_CALL_ALLOWED_COUNTRIES).map((item) =>
    item.toUpperCase()
  );
}

export function getMaxCallSeconds() {
  const parsed = Number(process.env.TWILIO_MAX_CALL_SECONDS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_CALL_SECONDS;
  return Math.min(Math.floor(parsed), 3600);
}

export function getBridgeMaxCallSeconds(workspaceMinutes?: number) {
  const workspaceSeconds = workspaceMinutes && [30, 45, 60].includes(workspaceMinutes)
    ? workspaceMinutes * 60
    : DEFAULT_BRIDGE_MAX_CALL_SECONDS;
  const ceilings = [process.env.TWILIO_BRIDGE_MAX_CALL_SECONDS, process.env.TWILIO_MAX_CALL_SECONDS]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 1)
    .map(Math.floor);
  return Math.min(workspaceSeconds, 3600, ...ceilings);
}

export function getFreeCallMaxSeconds() {
  return Math.min(getMaxCallSeconds(), FREE_CALL_MAX_SECONDS);
}

export function isTwilioCallingEnabled() {
  return process.env.NEXT_PUBLIC_TWILIO_CALLING_ENABLED === "true";
}

function listAllowsDestination(args: {
  destinationE164: string;
  allowedNumbers: string[];
  allowedCountries: string[];
  emptyReason: string;
  deniedReason: string;
}) {
  const { allowedNumbers, allowedCountries } = args;
  const normalized = normalizePhoneE164(args.destinationE164);

  if (allowedNumbers.includes(normalized)) {
    return { allowed: true, reason: "allowed_number" };
  }

  const destinationCountry = getDestinationCountry(normalized).toUpperCase();
  const countryAllowed =
    allowedCountries.includes(destinationCountry) ||
    (destinationCountry === "US/CA" &&
      (allowedCountries.includes("US") || allowedCountries.includes("CA")));

  if (countryAllowed) {
    return { allowed: true, reason: "allowed_country" };
  }

  if (allowedNumbers.length === 0 && allowedCountries.length === 0) {
    return {
      allowed: false,
      reason: args.emptyReason,
    };
  }

  return {
    allowed: false,
    reason: args.deniedReason,
  };
}

export function destinationAllowed(destinationE164: string) {
  return listAllowsDestination({
    destinationE164,
    allowedNumbers: getAllowedNumbers(),
    allowedCountries: getAllowedCountries(),
    emptyReason:
      "Real calling requires TWILIO_ALLOWED_NUMBERS or TWILIO_ALLOWED_COUNTRIES before testing.",
    deniedReason: "This destination is not enabled for Voxandra calling.",
  });
}

export function freeCallDestinationAllowed(destinationE164: string) {
  const normalized = normalizePhoneE164(destinationE164);
  const freeAllowedNumbers = getFreeCallAllowedNumbers();
  const freeAllowedCountries = getFreeCallAllowedCountries();

  if (freeAllowedNumbers.length === 0 && freeAllowedCountries.length === 0) {
    return destinationAllowed(normalized);
  }

  return listAllowsDestination({
    destinationE164: normalized,
    allowedNumbers: freeAllowedNumbers,
    allowedCountries: freeAllowedCountries,
    emptyReason:
      "Free trial calling requires TWILIO_FREE_CALL_ALLOWED_NUMBERS or TWILIO_FREE_CALL_ALLOWED_COUNTRIES before testing.",
    deniedReason: "This destination is not enabled for free Voxandra trial calls.",
  });
}

export function normalizeTwilioStatus(providerStatus: string | undefined) {
  switch (providerStatus) {
    case "initiated":
    case "queued":
      return { status: "connecting", processingStatus: "calling" };
    case "ringing":
      return { status: "ringing", processingStatus: "calling" };
    case "answered":
    case "in-progress":
      return { status: "in_progress", processingStatus: "calling" };
    case "completed":
      return { status: "completed", processingStatus: "transcript_needed" };
    case "busy":
    case "failed":
    case "no-answer":
    case "canceled":
      return { status: providerStatus, processingStatus: "call_failed" };
    default:
      return { status: providerStatus ?? "unknown", processingStatus: "calling" };
  }
}

export function assertServerSecret(secret: string) {
  const expected = process.env.TWILIO_CONVEX_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized provider mutation");
  }
}

export type TwilioPayloadSummary = {
  from?: string;
  to?: string;
  callStatus?: string;
  callDuration?: string;
  direction?: string;
  sequenceNumber?: string;
  timestamp?: string;
  callbackSource?: string;
};

export type TwilioProviderEventLookup = {
  callId?: Id<"calls">;
  providerCallSid?: string;
  parentCallSid?: string;
};
