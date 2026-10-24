import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireWorkspace } from "./authHelpers";
import { findRelevantLearningExamples } from "./agentLearning";
import { normalizePhoneE164, phoneNumbersMatch } from "../src/lib/phone";
import { getWorkflowTemplate } from "../src/lib/workflow-templates";

function mostRecentCalls(calls: Doc<"calls">[]) {
  return calls
    .slice()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

function unresolvedItemStatus(status: string) {
  return !["completed", "done", "dismissed", "accepted"].includes(status.toLowerCase());
}

export const getPreCallBrief = query({
  args: {
    phoneNumber: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    caseId: v.optional(v.id("cases")),
    workflowTemplateKey: v.optional(v.string()),
    objective: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceId = await requireWorkspace(ctx);
    return await buildPreCallBrief(ctx, workspaceId, args);
  },
});

export async function buildPreCallBrief(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Doc<"workspaces">["_id"],
  args: {
    phoneNumber?: string;
    contactId?: Doc<"contacts">["_id"];
    caseId?: Doc<"cases">["_id"];
    workflowTemplateKey?: string;
    objective?: string;
  }
) {
    const normalizedPhone = normalizePhoneE164(args.phoneNumber);

    let contact: Doc<"contacts"> | null = null;
    if (args.contactId) {
      const contactRecord = await ctx.db.get(args.contactId);
      if (contactRecord && contactRecord.workspaceId === workspaceId) {
        contact = contactRecord;
      }
    }

    if (!contact && normalizedPhone) {
      contact = await ctx.db
        .query("contacts")
        .withIndex("by_phone_e164", (q) =>
          q.eq("workspaceId", workspaceId).eq("phoneE164", normalizedPhone)
        )
        .first();
    }

    if (!contact && args.phoneNumber) {
      const contacts = await ctx.db
        .query("contacts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect();
      contact =
        contacts.find((item) => phoneNumbersMatch(item.phoneNumber, args.phoneNumber)) ?? null;
    }

    let thread: Doc<"cases"> | null = null;
    if (args.caseId) {
      const caseRecord = await ctx.db.get(args.caseId);
      if (caseRecord && caseRecord.workspaceId === workspaceId) {
        thread = caseRecord;
      }
    }

    if (!thread && contact?.relatedCaseIds.length) {
      const cases = await Promise.all(contact.relatedCaseIds.map((id) => ctx.db.get(id)));
      thread =
        cases
          .filter((caseItem): caseItem is Doc<"cases"> => !!caseItem && caseItem.workspaceId === workspaceId)
          .sort((a, b) => new Date(b.lastCallAt).getTime() - new Date(a.lastCallAt).getTime())[0] ??
        null;
    }

    const template = getWorkflowTemplate(
      args.workflowTemplateKey ?? thread?.workflowTemplateKey
    );

    const callCandidates = thread
      ? await ctx.db
          .query("calls")
          .withIndex("by_case", (q) => q.eq("caseId", thread!._id))
          .collect()
      : contact
        ? await ctx.db
            .query("calls")
            .withIndex("by_contact", (q) => q.eq("contactId", contact!._id))
            .collect()
        : await ctx.db
            .query("calls")
            .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
            .collect();

    const relatedCalls = mostRecentCalls(
      callCandidates.filter(
        (call) =>
          call.workspaceId === workspaceId &&
          (thread ||
            contact ||
            !args.phoneNumber ||
            phoneNumbersMatch(call.dialedNumber, args.phoneNumber))
      )
    );

    const recentCalls = [];
    for (const call of relatedCalls.slice(0, 3)) {
      const memory = await ctx.db
        .query("aiMemories")
        .withIndex("by_call", (q) => q.eq("callId", call._id))
        .first();
      recentCalls.push({
        callId: call._id,
        startedAt: call.startedAt,
        durationSeconds: call.durationSeconds,
        status: call.status,
        reviewPending: call.reviewPending,
        summary: memory?.summary ?? call.highlights[0] ?? "No reviewed memory yet.",
        outcome: memory?.outcome,
      });
    }

    const [workspaceActionItems, workspaceReminders] = await Promise.all([
      ctx.db
        .query("actionItems")
        .withIndex("by_status", (q) => q.eq("workspaceId", workspaceId).eq("status", "open"))
        .collect(),
      ctx.db
        .query("reminders")
        .withIndex("by_status", (q) => q.eq("workspaceId", workspaceId).eq("status", "upcoming"))
        .collect(),
    ]);

    const relatedCallIds = new Set(relatedCalls.map((call) => call._id));
    const openActionItems = workspaceActionItems
      .filter(
        (item) =>
          unresolvedItemStatus(item.status) &&
          ((thread && item.caseId === thread._id) ||
            (item.callId && relatedCallIds.has(item.callId)))
      )
      .slice(0, 4);

    const openReminders = workspaceReminders
      .filter(
        (item) =>
          item.status !== "completed" &&
          ((thread && item.caseId === thread._id) ||
            (contact && item.contactId === contact._id) ||
            (item.callId && relatedCallIds.has(item.callId)))
      )
      .sort((a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime())
      .slice(0, 4);

    const keyFacts = [];
    const entityCalls = relatedCalls.slice(0, 6);
    for (const call of entityCalls) {
      const entities = await ctx.db
        .query("extractedEntities")
        .withIndex("by_call", (q) => q.eq("callId", call._id))
        .collect();
      for (const entity of entities) {
        if (keyFacts.length >= 6) break;
        if (
          ["reference", "case_number", "invoice_number", "claim_number", "date", "amount", "required_document", "risk_flag", "discrepancy"].some((type) =>
            entity.type.toLowerCase().includes(type)
          )
        ) {
          keyFacts.push({
            type: entity.type,
            label: entity.label,
            value: entity.value,
            callId: call._id,
          });
        }
      }
      if (keyFacts.length >= 6) break;
    }

    let suggestedObjective = template.objectivePrompt;
    if (thread?.nextFollowUpAt) {
      suggestedObjective = `Follow up on ${thread.title} and confirm the next owner.`;
    }
    if (openReminders[0]?.title) {
      suggestedObjective = openReminders[0].title;
    }
    if (openActionItems[0]?.title) {
      suggestedObjective = openActionItems[0].title;
    }

    const compactText = (value: string | null | undefined, limit: number) =>
      (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
    const similarReviewedCalls = (
      await findRelevantLearningExamples(ctx, {
        workspaceId,
        contact,
        thread,
        phoneNumber: args.phoneNumber,
        objective: args.objective,
        limit: 3,
      })
    ).map(({ example }) => ({
      callId: example.callId,
      sourceEvent: example.sourceEvent,
      summary: compactText(example.summary, 300),
      outcome: compactText(example.outcome, 200) || undefined,
      realizedOutcomes: (example.realizedOutcomes ?? []).slice(0, 3),
      playbookHint:
        compactText(example.reviewedMeaning?.playbookHint, 200) || undefined,
      updatedAt: example.updatedAt,
    }));

    return {
      template,
      contact,
      thread,
      recentCalls,
      openActionItems,
      openReminders,
      keyFacts,
      suggestedObjective,
      similarReviewedCalls,
      checklist: template.checklist,
    };
}
