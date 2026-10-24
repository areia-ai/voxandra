import { createHmac, timingSafeEqual } from "node:crypto";

// Worker-side mirror of src/lib/realtime/stream-signature.ts — the worker
// cannot import TypeScript, and this must stay a dependency-free leaf so the
// fixture test can load both and assert they agree byte-for-byte. Read the
// rationale there; keep the two files in lockstep.

export const STREAM_SIGNATURE_PARAM = "streamSignature";
export const STREAM_SIGNATURE_EXPIRES_PARAM = "streamSignatureExpiresAt";
export const STREAM_SIGNATURE_TTL_MS = 10 * 60 * 1000;

export function canonicalizeStreamParams(params) {
  return Object.keys(params)
    .filter((key) => key !== STREAM_SIGNATURE_PARAM)
    .sort()
    .map((key) => `${key}=${String(params[key] ?? "")}`)
    .join("\n");
}

function computeSignature(params, secret) {
  return createHmac("sha256", secret).update(canonicalizeStreamParams(params)).digest("hex");
}

export function signMediaStreamParams(params, secret, options = {}) {
  if (!secret) throw new Error("Stream signing secret is required.");
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? STREAM_SIGNATURE_TTL_MS;
  const withExpiry = { ...params, [STREAM_SIGNATURE_EXPIRES_PARAM]: String(now + ttlMs) };
  return { ...withExpiry, [STREAM_SIGNATURE_PARAM]: computeSignature(withExpiry, secret) };
}

export function verifyMediaStreamSignature(params, secret, now = Date.now()) {
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
