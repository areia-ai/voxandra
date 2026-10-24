import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio Media Stream custom parameters are the ONLY thing the realtime worker
// knows about a call when a WebSocket arrives at /twilio/media-stream — and
// Twilio does not sign Media Stream connections the way it signs webhooks.
// Without this, anyone who could reach the worker's public hostname could open
// a socket, send a forged `start` event naming any callId/workspaceId, and make
// the worker open provider sessions on Voxandra's keys or write captions into
// someone else's live call.
//
// So the Next.js TwiML routes sign every parameter set with a secret shared
// only between Vercel and the worker (REALTIME_STREAM_SIGNING_SECRET), and the
// worker refuses any `start` whose parameters do not carry a fresh, valid
// signature. The canonical form covers EVERY parameter except the signature
// itself, so a parameter added later is automatically covered without anyone
// remembering to include it.
//
// This file must stay a mirror of scripts/realtime-media-worker-stream-auth.mjs
// (the worker cannot import TypeScript). scripts/test-realtime-media-worker.mjs
// asserts the two produce byte-identical signatures for the same input.

export const STREAM_SIGNATURE_PARAM = "streamSignature";
export const STREAM_SIGNATURE_EXPIRES_PARAM = "streamSignatureExpiresAt";
// Twilio fetches TwiML and opens the Media Stream within seconds; the callee
// leg of a bridge call gets its own fresh signature when Twilio requests that
// leg's TwiML. Ten minutes is generous headroom for retries and clock skew
// while still bounding replay of a captured parameter set.
export const STREAM_SIGNATURE_TTL_MS = 10 * 60 * 1000;

export type StreamParams = Record<string, string>;

export function canonicalizeStreamParams(params: StreamParams): string {
  return Object.keys(params)
    .filter((key) => key !== STREAM_SIGNATURE_PARAM)
    .sort()
    .map((key) => `${key}=${String(params[key] ?? "")}`)
    .join("\n");
}

function computeSignature(params: StreamParams, secret: string): string {
  return createHmac("sha256", secret).update(canonicalizeStreamParams(params)).digest("hex");
}

export function signMediaStreamParams(
  params: StreamParams,
  secret: string,
  options: { now?: number; ttlMs?: number } = {}
): StreamParams {
  if (!secret) throw new Error("Stream signing secret is required.");
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? STREAM_SIGNATURE_TTL_MS;
  const withExpiry: StreamParams = {
    ...params,
    [STREAM_SIGNATURE_EXPIRES_PARAM]: String(now + ttlMs),
  };
  return { ...withExpiry, [STREAM_SIGNATURE_PARAM]: computeSignature(withExpiry, secret) };
}

export type StreamSignatureVerification =
  | { ok: true }
  | { ok: false; reason: "missing_signature" | "missing_expiry" | "expired" | "invalid_signature" };

export function verifyMediaStreamSignature(
  params: StreamParams,
  secret: string,
  now: number = Date.now()
): StreamSignatureVerification {
  const provided = params[STREAM_SIGNATURE_PARAM];
  if (typeof provided !== "string" || provided.length === 0) {
    return { ok: false, reason: "missing_signature" };
  }
  const expiresAt = Number(params[STREAM_SIGNATURE_EXPIRES_PARAM]);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "missing_expiry" };
  if (now > expiresAt) return { ok: false, reason: "expired" };
  const expected = computeSignature(params, secret);
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}
