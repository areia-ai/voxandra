"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { deleteRecordingFromTwilio } from "./twilioRecordings";
import {
  assertMaintenanceSecret,
  normalizeMaintenanceLimit,
  sanitizeMaintenanceError,
} from "./maintenanceShared";

type LegacyRecordingCleanupResult = {
  scanned: number;
  deleted: number;
  deletionFailed: number;
  missingRecordingSid: number;
  cleared: number;
  dryRun: boolean;
  withRecordingSid?: number;
  withoutRecordingSid?: number;
};

export const cleanupLegacyRecordingUrls = action({
  args: {
    secret: v.string(),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<LegacyRecordingCleanupResult> => {
    assertMaintenanceSecret(args.secret);

    const limit = normalizeMaintenanceLimit(args.limit);
    const calls = await ctx.runQuery(internal.maintenance.listLegacyRecordingUrlCalls, { limit });
    const result = {
      scanned: calls.length,
      deleted: 0,
      deletionFailed: 0,
      missingRecordingSid: 0,
      cleared: 0,
      dryRun: args.dryRun === true,
    };

    if (args.dryRun) {
      return {
        ...result,
        withRecordingSid: calls.filter((call) => Boolean(call.recordingSid)).length,
        withoutRecordingSid: calls.filter((call) => !call.recordingSid).length,
      };
    }

    for (const call of calls) {
      if (!call.recordingSid) {
        await ctx.runMutation(internal.maintenance.clearLegacyRecordingUrl, {
          callId: call.callId,
          deleteStatus: "failed",
          errorMessage: "Legacy recording SID missing.",
        });
        result.missingRecordingSid += 1;
        result.cleared += 1;
        continue;
      }

      try {
        await deleteRecordingFromTwilio(call.recordingSid);
        await ctx.runMutation(internal.maintenance.clearLegacyRecordingUrl, {
          callId: call.callId,
          deleteStatus: "deleted",
        });
        result.deleted += 1;
        result.cleared += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Twilio recording deletion failed.";
        await ctx.runMutation(internal.maintenance.clearLegacyRecordingUrl, {
          callId: call.callId,
          deleteStatus: "failed",
          errorMessage: sanitizeMaintenanceError(message),
        });
        result.deletionFailed += 1;
        result.cleared += 1;
      }
    }

    return result;
  },
});
