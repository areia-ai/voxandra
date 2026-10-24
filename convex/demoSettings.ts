import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";

export const getDemoSettings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    return await ctx.db
      .query("demoSettings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .first();
  },
});

export const updateDemoSettings = internalMutation({
  args: {
    demoSettingsId: v.id("demoSettings"),
    showDemoHints: v.boolean(),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const settings = await ctx.db.get(args.demoSettingsId);
    if (!settings || settings.workspaceId !== workspaceId) throw new Error("Settings not found");
    await ctx.db.patch(args.demoSettingsId, {
      showDemoHints: args.showDemoHints,
    });
  },
});
