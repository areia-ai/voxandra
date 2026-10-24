import { internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { findRelevantLearningExamples, matchesAnyToken, tokenize } from "./agentLearning";

// Context the shadow agent needs to make a grounded prediction: the call's
// objective, contact/thread names, and how this workspace handled similar
// reviewed calls. Deliberately excludes the extraction draft so predictions
// stay independent of the record they are scored against.
export const getShadowContextForCall = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) return null;

    const [contact, thread] = await Promise.all([
      call.contactId ? ctx.db.get(call.contactId) : Promise.resolve(null),
      call.caseId ? ctx.db.get(call.caseId) : Promise.resolve(null),
    ]);
    const safeContact = contact?.workspaceId === call.workspaceId ? contact : null;
    const safeThread = thread?.workspaceId === call.workspaceId ? thread : null;

    const examples = await findRelevantLearningExamples(ctx, {
      workspaceId: call.workspaceId,
      contact: safeContact,
      thread: safeThread,
      phoneNumber: call.dialedNumber,
      objective: call.objective,
      limit: 3,
    });

    return {
      workspaceId: call.workspaceId,
      objective: call.objective,
      contactName: safeContact?.name,
      threadTitle: safeThread?.title,
      similarReviewedCalls: examples.map(({ example }) => ({
        summary: example.summary.slice(0, 300),
        outcome: example.outcome?.slice(0, 200),
        playbookHint: example.reviewedMeaning?.playbookHint?.slice(0, 200),
      })),
    };
  },
});

type ShadowPrediction = {
  predictedObjective?: string;
  predictedOutcome?: string;
  nextQuestionsAgentWouldAsk?: string[];
  predictedFollowUps?: Array<{ title?: string; kind?: string }>;
  predictedEscalations?: string[];
  confidence?: number;
};

function parsePrediction(detail: string | undefined): ShadowPrediction | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as ShadowPrediction)
      : null;
  } catch {
    return null;
  }
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Deterministic token-overlap scoring of the latest shadow prediction against
// the human-reviewed outcome. Pure string operations — no model call — so it
// is safe to run inline in the review mutations.
export async function scoreShadowPredictionForCall(
  ctx: MutationCtx,
  args: {
    call: Doc<"calls">;
    outcomeStatus?: string;
    acceptedFollowUps: string[];
  }
) {
  const events = await ctx.db
    .query("agentRunEvents")
    .withIndex("by_call", (q) => q.eq("callId", args.call._id))
    .collect();
  const predictionEvent = events
    .filter(
      (event) =>
        event.workspaceId === args.call.workspaceId &&
        event.eventType === "prediction" &&
        event.mode === "agent_shadow"
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!predictionEvent) return;

  const prediction = parsePrediction(predictionEvent.detail);
  if (!prediction) return;

  const runs = await ctx.db
    .query("shadowAgentRuns")
    .withIndex("by_call", (q) => q.eq("callId", args.call._id))
    .collect();
  const run =
    runs.find((item) => item.agentRunEventId === predictionEvent._id) ??
    runs
      .filter((item) => item.status === "succeeded")
      .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!run || run.workspaceId !== args.call.workspaceId) return;

  const predictedOutcomeTokens = tokenize(prediction.predictedOutcome);
  const outcomeAgreement =
    predictedOutcomeTokens.length && args.outcomeStatus
      ? clampScore(
          matchesAnyToken(args.outcomeStatus, predictedOutcomeTokens) /
            predictedOutcomeTokens.length
        )
      : 0;

  const predictedTitles = (prediction.predictedFollowUps ?? [])
    .map((item) => item.title?.trim() ?? "")
    .filter(Boolean);
  const acceptedJoined = args.acceptedFollowUps.join("\n");
  const matchedPredictions = predictedTitles.filter(
    (title) => matchesAnyToken(acceptedJoined, tokenize(title)) > 0
  ).length;
  const predictedJoined = predictedTitles.join("\n");
  const matchedAccepted = args.acceptedFollowUps.filter(
    (followUp) => matchesAnyToken(predictedJoined, tokenize(followUp)) > 0
  ).length;

  const followUpPrecision = predictedTitles.length
    ? clampScore(matchedPredictions / predictedTitles.length)
    : args.acceptedFollowUps.length
      ? 0
      : 1;
  const followUpRecall = args.acceptedFollowUps.length
    ? clampScore(matchedAccepted / args.acceptedFollowUps.length)
    : predictedTitles.length
      ? 0
      : 1;

  const now = Date.now();
  await ctx.db.patch(run._id, {
    outcomeAgreement,
    followUpPrecision,
    followUpRecall,
    scoredAt: now,
  });

  await ctx.db.insert("agentRunEvents", {
    workspaceId: args.call.workspaceId,
    callId: args.call._id,
    mode: "agent_shadow",
    eventType: "summary",
    status: "recorded",
    title: "Shadow prediction scored against reviewed record",
    detail: JSON.stringify({
      shadowAgentRunId: run._id,
      predictionEventId: predictionEvent._id,
      outcomeAgreement,
      followUpPrecision,
      followUpRecall,
      predictedFollowUpCount: predictedTitles.length,
      acceptedFollowUpCount: args.acceptedFollowUps.length,
    }),
    createdAt: now,
  });
}
