import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspace } from "./authHelpers";

export const getCases = query({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);
    const cases = await ctx.db
      .query("cases")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    return cases.sort(
      (a, b) =>
        new Date(b.lastCallAt).getTime() - new Date(a.lastCallAt).getTime()
    );
  },
});

export const getCaseById = query({
  args: { id: v.id("cases") },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    const caseItem = await ctx.db.get(args.id);
    if (!caseItem || caseItem.workspaceId !== workspaceId) return null;
    return caseItem;
  },
});
