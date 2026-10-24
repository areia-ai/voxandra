// Shadow Agent v1 prompt. The shadow agent observes finished human calls and
// predicts what a well-prepared phone agent for this workspace would have done.
// Predictions are scored later against the human-reviewed record, so this
// prompt must never see the extraction draft: predictions have to be
// independent of the output they are compared with.
//
// Bump SHADOW_AGENT_PROMPT_VERSION on any prompt or schema change and log the
// change in LOG.md, same as AI_EXTRACTION_PROMPT_VERSION.

export const SHADOW_AGENT_PROMPT_VERSION = "shadow-agent-v1";

export interface ShadowAgentSimilarCall {
  summary: string;
  outcome?: string;
  playbookHint?: string;
}

export interface ShadowAgentPromptInput {
  transcriptText: string;
  objective?: string;
  contactName?: string;
  threadTitle?: string;
  language?: string;
  similarReviewedCalls?: ShadowAgentSimilarCall[];
}

export function buildShadowAgentPrompt(input: ShadowAgentPromptInput): {
  systemPrompt: string;
  taskInstructions: string;
} {
  const systemPrompt = [
    "You are Voxandra's shadow phone agent. A human just finished a real business phone call; you are reviewing the transcript after the fact.",
    "Predict what a careful, well-prepared phone agent working for this workspace would have done on this call: the objective it would have pursued, the outcome it would report, the next questions it would have asked before ending the call, the follow-ups it would create, and anything it would escalate to a human.",
    "Ground every prediction in the transcript and the provided workspace context. Never invent names, numbers, dates, or commitments that are not supported by the transcript.",
    "Keep follow-up titles short and operational. Report escalations only for genuine risk, ambiguity, or commitments a human must approve.",
    "Respond in the same language as the workspace context and transcript when possible.",
  ].join("\n");

  const contextLines = [
    input.objective ? `Call objective: ${input.objective}` : undefined,
    input.contactName ? `Contact: ${input.contactName}` : undefined,
    input.threadTitle ? `Work thread: ${input.threadTitle}` : undefined,
    input.language ? `Call record language: ${input.language}` : undefined,
  ].filter(Boolean);

  const exampleLines = (input.similarReviewedCalls ?? [])
    .slice(0, 3)
    .map((example, index) =>
      [
        `Example ${index + 1}: ${example.summary}`,
        example.outcome ? `Outcome: ${example.outcome}` : undefined,
        example.playbookHint ? `Playbook hint: ${example.playbookHint}` : undefined,
      ]
        .filter(Boolean)
        .join(" | ")
    );

  const taskInstructions = [
    contextLines.length ? `Workspace context:\n${contextLines.join("\n")}` : undefined,
    exampleLines.length
      ? `How this workspace handled similar reviewed calls:\n${exampleLines.join("\n")}`
      : undefined,
    `Call transcript:\n${input.transcriptText}`,
    "Produce your predictions now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, taskInstructions };
}
