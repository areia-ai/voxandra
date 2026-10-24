import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";

const MAX_KEYPAD_EVENTS_PER_CALL = 64;
// A run of consecutive presses this close together is treated as one entry
// sequence (IVR menu choices are slower; account numbers and PINs are not).
const RUN_GAP_MS = 2500;
// Digits beyond this many in one rapid run are stored masked.
const UNMASKED_RUN_LIMIT = 3;
const TERMINAL_CALL_STATUSES = new Set(["completed", "failed", "canceled", "expired"]);
const ALLOWED_DIGITS = new Set([..."0123456789*#"]);

export const recordKeypadPress = mutation({
  args: {
    callId: v.id("calls"),
    digit: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.workspaceId !== workspaceId) {
      return { recorded: false };
    }
    if (TERMINAL_CALL_STATUSES.has(call.status)) {
      return { recorded: false };
    }

    const digit = args.digit.slice(0, 1);
    if (!ALLOWED_DIGITS.has(digit)) {
      return { recorded: false };
    }

    const events = await ctx.db
      .query("callKeypadEvents")
      .withIndex("by_call", (q) => q.eq("callId", args.callId))
      .collect();
    if (events.length >= MAX_KEYPAD_EVENTS_PER_CALL) {
      return { recorded: false };
    }

    const now = Date.now();
    const sorted = events.sort((a, b) => a.sequence - b.sequence);
    let runLength = 0;
    let cursor = now;
    for (let index = sorted.length - 1; index >= 0; index--) {
      if (cursor - sorted[index].pressedAt <= RUN_GAP_MS) {
        runLength++;
        cursor = sorted[index].pressedAt;
      } else {
        break;
      }
    }
    const masked = runLength >= UNMASKED_RUN_LIMIT;

    await ctx.db.insert("callKeypadEvents", {
      workspaceId,
      callId: args.callId,
      digit: masked ? "•" : digit,
      masked,
      sequence: sorted.length ? sorted[sorted.length - 1].sequence + 1 : 1,
      pressedAt: now,
    });

    return { recorded: true, masked };
  },
});
