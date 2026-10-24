export function assertMaintenanceSecret(secret: string) {
  const expected =
    process.env.MAINTENANCE_CONVEX_SECRET ||
    process.env.TWILIO_CONVEX_WEBHOOK_SECRET ||
    process.env.STRIPE_CONVEX_WEBHOOK_SECRET;

  if (!expected) {
    throw new Error("Maintenance secret is not configured.");
  }
  if (secret !== expected) {
    throw new Error("Unauthorized maintenance request.");
  }
}

export function sanitizeMaintenanceError(message: string) {
  return message
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/AC[0-9a-fA-F]{32}/g, "[account]")
    .replace(/CA[0-9a-fA-F]{32}/g, "[call]")
    .replace(/RE[0-9a-fA-F]{32}/g, "[recording]")
    .slice(0, 300);
}

export function normalizeMaintenanceLimit(limit: number | undefined, fallback = 100) {
  if (!Number.isFinite(limit ?? fallback)) return fallback;
  return Math.max(1, Math.min(Math.floor(limit ?? fallback), 500));
}
