import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

export function trialRequire(condition: unknown, code = "trial_unavailable"): asserts condition {
  if (!condition) throw new ConvexError(code);
}

export async function isAuthorizedTranslatedTrialCall(ctx: MutationCtx, call: Doc<"calls"> | null, feature: string) {
  if (!call?.isFreeCall || !call.bridgeModeRequested || feature !== "translated_audio") return false;
  if (call.translatedTrialAuthorized === true && typeof call.freeCallClaimedAt === "number" &&
      Number.isFinite(call.freeCallClaimedAt) && call.freeCallClaimedAt > 0) return true;
  if (!call.trialGrantId) return false;
  const grant = await ctx.db.get(call.trialGrantId);
  return Boolean(grant?.status === "used" && grant.callId === call._id && grant.workspaceId === call.workspaceId &&
    grant.userId === call.createdByUserId && grant.destination === call.dialedNumber && grant.usedAt !== undefined);
}
