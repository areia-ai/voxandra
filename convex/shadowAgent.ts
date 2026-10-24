"use node";

import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  SHADOW_AGENT_PROMPT_VERSION,
  buildShadowAgentPrompt,
} from "../src/lib/ai/shadow-agent-prompt";
import { DEFAULT_OPENAI_MODEL, estimateCostUsd } from "../src/lib/ai/extraction-prompt";

const shadowPredictionSchema = z.object({
  predictedObjective: z.string(),
  predictedOutcome: z.string(),
  nextQuestionsAgentWouldAsk: z.array(z.string()),
  predictedFollowUps: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["action_item", "reminder"]),
    })
  ),
  predictedEscalations: z.array(z.string()),
  confidence: z.number(),
});

type ShadowPredictionResult = z.infer<typeof shadowPredictionSchema>;

function getOutputText(response: unknown): string {
  const asRecord = response as { output_text?: unknown };
  if (typeof asRecord.output_text === "string") return asRecord.output_text;
  return "";
}

function extractTokenUsage(response: unknown) {
  const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage;
  if (!usage) return undefined;
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
  };
}

// Shadow Agent v1: after a call is transcribed, predict what an agent would
// have done on this call and record the prediction as an agent run event.
// Observation only — no external action, no customer-facing surface. The
// prediction is scored later, at review time, against the human-reviewed
// record (see convex/shadowAgentScoring.ts).
export const runShadowPrediction = internalAction({
  args: {
    callId: v.id("calls"),
    transcriptText: v.string(),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (process.env.SHADOW_AGENT_ENABLED === "false") return;
    if (!process.env.OPENAI_API_KEY) return;
    if (args.transcriptText.trim().length < 20) return;

    const context = await ctx.runQuery(internal.shadowAgentScoring.getShadowContextForCall, {
      callId: args.callId,
    });
    if (!context) return;
    const workspaceId = context.workspaceId;

    const model =
      process.env.OPENAI_SHADOW_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    const { systemPrompt, taskInstructions } = buildShadowAgentPrompt({
      transcriptText: args.transcriptText,
      objective: context.objective,
      contactName: context.contactName,
      threadTitle: context.threadTitle,
      language: args.language,
      similarReviewedCalls: context.similarReviewedCalls,
    });

    const runId = await ctx.runMutation(internal.shadowAgentRuns.createShadowRun, {
      workspaceId,
      callId: args.callId,
      promptVersion: SHADOW_AGENT_PROMPT_VERSION,
      model,
      inputCharCount: systemPrompt.length + taskInstructions.length,
    });
    await ctx.runMutation(internal.shadowAgentRuns.markShadowRunRunning, {
      runId,
      workspaceId,
    });

    const startedAt = Date.now();
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.responses.create({
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: taskInstructions },
        ],
        text: {
          format: zodTextFormat(shadowPredictionSchema, "voxandra_shadow_prediction"),
        },
      });

      const rawText = getOutputText(response);
      const latencyMs = Date.now() - startedAt;

      let parsed: ShadowPredictionResult;
      try {
        parsed = shadowPredictionSchema.parse(JSON.parse(rawText));
      } catch (validationError) {
        await ctx.runMutation(internal.shadowAgentRuns.markShadowRunValidationFailed, {
          runId,
          workspaceId,
          validationErrors: [
            validationError instanceof Error ? validationError.message : "Validation failed",
          ],
          outputCharCount: rawText.length,
          latencyMs,
        });
        return;
      }

      const { eventId } = await ctx.runMutation(
        internal.realtimeRuntime.recordAgentRunEventInternal,
        {
          workspaceId,
          callId: args.callId,
          mode: "agent_shadow",
          eventType: "prediction",
          status: "recorded",
          title: `Shadow prediction: ${parsed.predictedObjective.slice(0, 140)}`,
          detail: JSON.stringify(parsed),
          riskLevel: "low",
        }
      );

      await ctx.runMutation(internal.shadowAgentRuns.markShadowRunSucceeded, {
        runId,
        workspaceId,
        agentRunEventId: eventId,
        outputCharCount: rawText.length,
        tokenUsage: extractTokenUsage(response),
        estimatedCostUsd: estimateCostUsd(model, extractTokenUsage(response)) ?? undefined,
        latencyMs,
      });
    } catch (error) {
      await ctx.runMutation(internal.shadowAgentRuns.markShadowRunFailed, {
        runId,
        workspaceId,
        errorCode: "shadow_prediction_failed",
        errorMessage: error instanceof Error ? error.message : "Shadow prediction failed",
        latencyMs: Date.now() - startedAt,
      });
    }
  },
});
