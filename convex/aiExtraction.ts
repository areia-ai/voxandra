"use node";

import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  AI_EXTRACTION_PROMPT_VERSION,
  DEFAULT_OPENAI_MODEL,
  buildExtractionPrompt,
  estimateCostUsd,
} from "../src/lib/ai/extraction-prompt";
import { resolveTranscriptLanguage } from "../src/lib/server/openai-transcription";
import { assertCallRecordLanguagePreference } from "../src/lib/call-record-languages";

const callTypeSchema = z.enum([
  "relocation_immigration",
  "background_verification",
  "insurance_claim",
  "banking_finance",
  "supplier_invoice",
  "b2b_sales",
  "legal_admin",
  "generic",
]);

const extractedEntitySchema = z.object({
  type: z.string(),
  label: z.string(),
  value: z.string(),
  confidence: z.number(),
});

const actionItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  dueAt: z.string().nullable(),
});

const reminderSchema = z
  .object({
    title: z.string(),
    remindAt: z.string(),
  })
  .nullable();

const participantCallerSchema = z.object({
  name: z.string().nullable(),
  roleLabel: z.enum(["caller", "customer", "client", "candidate", "account_holder", "unknown"]),
  confidence: z.number(),
  evidence: z.string().nullable(),
});

const participantRepresentativeSchema = z.object({
  name: z.string().nullable(),
  roleLabel: z.enum(["agent", "officer", "support_rep", "registrar", "HR_rep", "supplier_rep", "finance_rep", "unknown"]),
  institutionName: z.string().nullable(),
  confidence: z.number(),
  evidence: z.string().nullable(),
});

const participantInstitutionSchema = z.object({
  name: z.string().nullable(),
  type: z.enum(["bank", "government", "visa_office", "university", "employer", "supplier", "finance", "insurance", "customer_support", "other", "unknown"]),
  confidence: z.number(),
  evidence: z.string().nullable(),
});

const participantSubjectSchema = z.object({
  name: z.string().nullable(),
  subjectType: z.enum(["client", "candidate", "customer", "account", "case_subject", "unknown"]),
  confidence: z.number(),
  evidence: z.string().nullable(),
});

const participantsSchema = z.object({
  caller: participantCallerSchema,
  representative: participantRepresentativeSchema,
  institution: participantInstitutionSchema,
  subject: participantSubjectSchema,
});

const extractionSchema = z.object({
  detectedCallType: callTypeSchema,
  summary: z.string(),
  outcome: z.string().nullable(),
  confidence: z.number(),
  keyPoints: z.array(z.string()),
  extractedEntities: z.array(extractedEntitySchema),
  requiredDocuments: z.array(z.string()),
  actionItems: z.array(actionItemSchema),
  suggestedReminder: reminderSchema,
  suggestedExistingCaseId: z.string().nullable(),
  suggestedNewCaseTitle: z.string().nullable(),
  suggestedContactName: z.string().nullable(),
  suggestedContactType: z.string().nullable(),
  suggestedContactCountry: z.string().nullable(),
  riskFlags: z.array(z.string()),
  discrepancies: z.array(z.string()),
  language: z.string().nullable(),
  participants: participantsSchema,
});

type ExtractionResult = z.infer<typeof extractionSchema>;

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const DERIVED_ENTITY_LABELS: Record<string, { risk: string; discrepancy: string }> = {
  en: { risk: "Risk flag", discrepancy: "Discrepancy" },
  es: { risk: "Señal de riesgo", discrepancy: "Discrepancia" },
  pt: { risk: "Sinal de risco", discrepancy: "Discrepância" },
  fr: { risk: "Risque", discrepancy: "Écart" },
  de: { risk: "Risikohinweis", discrepancy: "Abweichung" },
  it: { risk: "Segnalazione di rischio", discrepancy: "Discrepanza" },
  nl: { risk: "Risicosignaal", discrepancy: "Afwijking" },
  pl: { risk: "Sygnał ryzyka", discrepancy: "Rozbieżność" },
  uk: { risk: "Ознака ризику", discrepancy: "Розбіжність" },
  ru: { risk: "Признак риска", discrepancy: "Несоответствие" },
  ar: { risk: "مؤشر خطر", discrepancy: "تعارض" },
  hi: { risk: "जोखिम संकेत", discrepancy: "विसंगति" },
  id: { risk: "Indikasi risiko", discrepancy: "Ketidaksesuaian" },
  vi: { risk: "Dấu hiệu rủi ro", discrepancy: "Sai lệch" },
  ko: { risk: "위험 신호", discrepancy: "불일치" },
  ja: { risk: "リスク指標", discrepancy: "不一致" },
  zh: { risk: "风险提示", discrepancy: "差异" },
  tr: { risk: "Risk işareti", discrepancy: "Tutarsızlık" },
};

function getOutputText(response: unknown) {
  if (
    response &&
    typeof response === "object" &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text;
  }

  if (!response || typeof response !== "object" || !("output" in response) || !Array.isArray(response.output)) {
    return "";
  }

  return response.output
    .flatMap((item) =>
      item && typeof item === "object" && "content" in item && Array.isArray(item.content)
        ? item.content
        : []
    )
    .map((part) =>
      part && typeof part === "object" && "text" in part && typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("")
    .trim();
}

function extractTokenUsage(response: unknown): {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | null {
  if (!response || typeof response !== "object") return null;
  const usage = "usage" in response ? response.usage : null;
  if (!usage || typeof usage !== "object") return null;

  const prompt_tokens = "prompt_tokens" in usage && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const completion_tokens = "completion_tokens" in usage && typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const total_tokens = "total_tokens" in usage && typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;

  if (prompt_tokens === undefined && completion_tokens === undefined && total_tokens === undefined) return null;
  return { prompt_tokens, completion_tokens, total_tokens };
}

async function performExtraction(
  ctx: ActionCtx,
  args: {
    transcriptText: string;
    phoneNumber?: string;
    contactName?: string;
    existingContactId?: Id<"contacts">;
    caseName?: string;
    existingCaseId?: Id<"cases">;
    context?: string;
    language?: string;
    callRecordLanguage?: string;
    retryOfRunId?: Id<"aiExtractionRuns">;
    existingCallId?: Id<"calls">;
    workflowTemplateKey?: string;
    source?: "imported_transcript" | "simulated_future" | "provider_transcript_future";
    workspaceId?: Id<"workspaces">;
    replacePendingDraft?: boolean;
  }
): Promise<{ callId: Id<"calls">; runId: Id<"aiExtractionRuns"> }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI extraction is not configured. Add OPENAI_API_KEY to the Convex deployment environment.");
  }

  if (args.transcriptText.trim().length < 20) {
    throw new Error("Paste a longer transcript or note before analyzing.");
  }

  // Determine workspaceId: explicit arg > call record > auth identity
  let workspaceId: Id<"workspaces">;
  let existingCallInfo: {
    workspaceId: Id<"workspaces">;
    workflowTemplateKey?: string;
    objective?: string;
    contactId?: Id<"contacts">;
    caseId?: Id<"cases">;
    callRecordLanguage?: string;
    callRecordLanguageSource?: string;
  } | null = null;
  if (args.workspaceId) {
    workspaceId = args.workspaceId;
  } else if (args.existingCallId) {
    existingCallInfo = await ctx.runQuery(internal.aiExtractionInternal.getCallWorkspace, { callId: args.existingCallId });
    if (!existingCallInfo) throw new Error("Call not found");
    workspaceId = existingCallInfo.workspaceId;
  } else {
    const workspace = await ctx.runQuery(api.profiles.getMyWorkspace, {});
    if (!workspace) throw new Error("No workspace found");
    workspaceId = workspace._id;
  }

  if (args.existingCallId && !existingCallInfo) {
    existingCallInfo = await ctx.runQuery(internal.aiExtractionInternal.getCallWorkspace, { callId: args.existingCallId });
    if (!existingCallInfo || existingCallInfo.workspaceId !== workspaceId) {
      throw new Error("Call not found");
    }
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const effectiveTranscriptLanguage = resolveTranscriptLanguage(args.language, args.transcriptText);
  const effectiveCallRecordLanguage =
    args.callRecordLanguage ?? existingCallInfo?.callRecordLanguage ?? effectiveTranscriptLanguage;

  const [cases, contacts] = await Promise.all([
    ctx.runQuery(internal.aiExtractionInternal.getCasesByWorkspace, { workspaceId }),
    ctx.runQuery(internal.aiExtractionInternal.getContactsByWorkspace, { workspaceId }),
  ]);

  const effectiveCaseId = args.existingCaseId ?? existingCallInfo?.caseId;
  const effectiveContactId = args.existingContactId ?? existingCallInfo?.contactId;
  const selectedCase = effectiveCaseId
    ? cases.find((caseItem: { _id: Id<"cases"> }) => caseItem._id === effectiveCaseId)
    : null;
  const selectedContact = effectiveContactId
    ? contacts.find((contact: { _id: Id<"contacts"> }) => contact._id === effectiveContactId)
    : null;
  const workflowTemplateKey =
    args.workflowTemplateKey ??
    existingCallInfo?.workflowTemplateKey ??
    selectedCase?.workflowTemplateKey;
  const extractionContext = args.context ?? existingCallInfo?.objective;

  let callId: Id<"calls">;
  let transcriptId: Id<"transcripts"> | null = null;

  if (args.existingCallId) {
    callId = args.existingCallId;
    const transcript = await ctx.runQuery(internal.aiExtractionInternal.getTranscriptByCallIdInternal, { callId });
    transcriptId = transcript?._id ?? null;
  } else {
    callId = await ctx.runMutation(internal.importedTranscripts.createImportedCallDraft, {
      transcriptText: args.transcriptText,
      phoneNumber: args.phoneNumber,
      contactId: args.existingContactId,
      existingCaseId: args.existingCaseId,
      context: args.context,
      language: effectiveTranscriptLanguage,
      workspaceId,
    });
    const transcript = await ctx.runQuery(internal.aiExtractionInternal.getTranscriptByCallIdInternal, { callId });
    transcriptId = transcript?._id ?? null;
  }

  const runId = await ctx.runMutation(internal.aiExtractionRuns.createExtractionRun, {
    callId,
    transcriptId: transcriptId ?? undefined,
    source: args.source ?? "imported_transcript",
    promptVersion: AI_EXTRACTION_PROMPT_VERSION,
    model,
    inputCharCount: JSON.stringify({
      transcriptText: args.transcriptText,
      context: extractionContext,
      phoneNumber: args.phoneNumber,
      contactName: args.contactName,
      caseName: args.caseName,
      transcriptLanguage: effectiveTranscriptLanguage,
      callRecordLanguage: effectiveCallRecordLanguage,
      workflowTemplateKey,
      cases,
      contacts,
    }).length,
    transcriptCharCount: args.transcriptText.length,
    retryOfRunId: args.retryOfRunId,
    workspaceId,
  });

  await ctx.runMutation(internal.aiExtractionRuns.markExtractionRunRunning, { runId, workspaceId });

  const startedAt = Date.now();
  let rawText = "";

  try {
    const { systemPrompt, taskInstructions } = buildExtractionPrompt({
      transcriptText: args.transcriptText,
      phoneNumber: args.phoneNumber,
      contactName: args.contactName ?? selectedContact?.name,
      caseName: args.caseName ?? selectedCase?.title,
      context: extractionContext,
      transcriptLanguage: effectiveTranscriptLanguage,
      callRecordLanguage: effectiveCallRecordLanguage,
      workflowTemplateKey,
      cases: cases.map((c: { _id: Id<"cases">; title: string; summary: string; clientName: string; status: string }) => ({ id: c._id, title: c.title, summary: c.summary, clientName: c.clientName, status: c.status })),
      contacts: contacts.map((c: { _id: Id<"contacts">; name: string; type: string; country: string; phoneNumber: string; notes: string }) => ({ id: c._id, name: c.name, type: c.type, country: c.country, phoneNumber: c.phoneNumber, notes: c.notes })),
    });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: taskInstructions },
      ],
      text: {
        format: zodTextFormat(extractionSchema, "voxandra_call_memory"),
      },
    });

    rawText = getOutputText(response);
    const outputCharCount = rawText.length;
    const tokenUsage = extractTokenUsage(response);
    const estimatedCost = estimateCostUsd(model, tokenUsage);
    const latencyMs = Date.now() - startedAt;

    let parsed: ExtractionResult;
    try {
      parsed = extractionSchema.parse(JSON.parse(rawText));
    } catch (validationError) {
      const validationMessage = validationError instanceof Error ? validationError.message : "Validation failed";
      const validationErrors = [validationMessage];
      await ctx.runMutation(internal.aiExtractionRuns.markExtractionRunValidationFailed, {
        runId,
        validationErrors,
        outputCharCount,
        latencyMs,
        workspaceId,
      });
      await ctx.runMutation(internal.importedTranscripts.markImportedAnalysisFailed, {
        callId,
        errorMessage: "AI extraction output did not match the expected schema. Please retry or adjust the notes.",
        workspaceId,
      });
      throw new Error("Voxandra could not validate the AI output. Please retry or adjust the notes.");
    }

    const allowedCaseIds = new Set(cases.map((caseItem: { _id: Id<"cases"> }) => caseItem._id as string));
    const suggestedExistingCaseId: Id<"cases"> | null =
      effectiveCaseId ??
      (parsed.suggestedExistingCaseId && allowedCaseIds.has(parsed.suggestedExistingCaseId)
        ? (parsed.suggestedExistingCaseId as Id<"cases">)
        : null);

    const suggestedNewCaseTitle = suggestedExistingCaseId
      ? null
      : nullableText(args.caseName) ?? nullableText(parsed.suggestedNewCaseTitle);

    const suggestedExistingContactId = effectiveContactId ?? null;
    const suggestedContactName = suggestedExistingContactId
      ? null
      : nullableText(args.contactName) ?? nullableText(parsed.suggestedContactName);

    const derivedLabels = DERIVED_ENTITY_LABELS[effectiveCallRecordLanguage] ?? DERIVED_ENTITY_LABELS.en;
    const riskAndDiscrepancyEntities = [...parsed.riskFlags, ...parsed.discrepancies].map((value, index) => ({
      type: index < parsed.riskFlags.length ? "risk_flag" : "discrepancy",
      label: index < parsed.riskFlags.length ? derivedLabels.risk : derivedLabels.discrepancy,
      value,
      confidence: Math.min(0.85, clampConfidence(parsed.confidence)),
    }));

    const reviewSuggestionId = await ctx.runMutation(internal.importedTranscripts.completeImportedAnalysis, {
      callId,
      detectedCallType: parsed.detectedCallType,
      summary: parsed.summary,
      outcome: parsed.outcome ?? "",
      confidence: clampConfidence(parsed.confidence),
      keyPoints: parsed.keyPoints.filter(Boolean),
      requiredDocuments: parsed.requiredDocuments.filter(Boolean),
      language: effectiveCallRecordLanguage,
      entities: [...parsed.extractedEntities, ...riskAndDiscrepancyEntities]
        .filter((entity) => entity.value.trim())
        .map((entity) => ({
          ...entity,
          confidence: clampConfidence(entity.confidence),
        })),
      actionItems: parsed.actionItems
        .filter((item) => item.title.trim())
        .map((item) => ({
          title: item.title,
          description: item.description,
          dueAt: item.dueAt,
        })),
      reminder: parsed.suggestedReminder,
      suggestedExistingCaseId,
      suggestedNewCaseTitle,
      suggestedExistingContactId,
      suggestedContactName,
      suggestedContactType: suggestedContactName ? nullableText(parsed.suggestedContactType) ?? "other" : null,
      suggestedContactCountry: suggestedContactName ? nullableText(parsed.suggestedContactCountry) ?? "Unknown" : null,
      suggestedContactPhone: suggestedContactName ? nullableText(args.phoneNumber) : null,
      riskFlags: parsed.riskFlags,
      promptVersion: AI_EXTRACTION_PROMPT_VERSION,
      model,
      participants: {
        caller: {
          name: parsed.participants.caller.name,
          roleLabel: parsed.participants.caller.roleLabel,
          confidence: clampConfidence(parsed.participants.caller.confidence),
          evidence: parsed.participants.caller.evidence,
        },
        representative: {
          name: parsed.participants.representative.name,
          roleLabel: parsed.participants.representative.roleLabel,
          confidence: clampConfidence(parsed.participants.representative.confidence),
          institutionName: parsed.participants.representative.institutionName,
          evidence: parsed.participants.representative.evidence,
        },
        institution: {
          name: parsed.participants.institution.name,
          type: parsed.participants.institution.type,
          confidence: clampConfidence(parsed.participants.institution.confidence),
          evidence: parsed.participants.institution.evidence,
        },
        subject: {
          name: parsed.participants.subject.name,
          subjectType: parsed.participants.subject.subjectType,
          confidence: clampConfidence(parsed.participants.subject.confidence),
          evidence: parsed.participants.subject.evidence,
        },
      },
      workspaceId,
      replacePendingDraft: args.replacePendingDraft,
    });

    await ctx.runMutation(internal.aiExtractionRuns.markExtractionRunSucceeded, {
      runId,
      reviewSuggestionId,
      outputCharCount,
      tokenUsage: tokenUsage ?? undefined,
      estimatedCostUsd: estimatedCost ?? undefined,
      latencyMs,
      workspaceId,
    });

    return { callId, runId };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "AI extraction failed.";
    const errorCode = error instanceof Error && "code" in error ? String(error.code) : undefined;

    await ctx.runMutation(internal.aiExtractionRuns.markExtractionRunFailed, {
      runId,
      errorCode: errorCode ?? "extraction_error",
      errorMessage: message,
      latencyMs,
      workspaceId,
    });
    if (!args.replacePendingDraft) {
      await ctx.runMutation(internal.importedTranscripts.markImportedAnalysisFailed, {
        callId,
        errorMessage: "AI extraction failed",
        workspaceId,
      });
    }

    console.error("OpenAI transcript extraction failed", { callId, runId, message });
    throw new Error(
      message.includes("OPENAI_API_KEY")
        ? message
        : "Voxandra could not extract a structured call record from this transcript. Please retry or adjust the notes."
    );
  }
}

export const extractFromRecording: ReturnType<typeof internalAction> = internalAction({
  args: {
    transcriptText: v.string(),
    existingCallId: v.id("calls"),
    phoneNumber: v.optional(v.string()),
    contactName: v.optional(v.string()),
    existingContactId: v.optional(v.id("contacts")),
    caseName: v.optional(v.string()),
    existingCaseId: v.optional(v.id("cases")),
    context: v.optional(v.string()),
    language: v.optional(v.string()),
    callRecordLanguage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const callInfo = await ctx.runQuery(internal.aiExtractionInternal.getCallWorkspace, { callId: args.existingCallId });
    if (!callInfo) throw new Error("Call not found");
    const { callId } = await performExtraction(ctx, {
      ...args,
      source: "provider_transcript_future",
      workspaceId: callInfo.workspaceId,
    });
    return { callId };
  },
});

export const analyzeImportedTranscript: ReturnType<typeof action> = action({
  args: {
    transcriptText: v.string(),
    phoneNumber: v.optional(v.string()),
    contactName: v.optional(v.string()),
    existingContactId: v.optional(v.id("contacts")),
    caseName: v.optional(v.string()),
    existingCaseId: v.optional(v.id("cases")),
    context: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check AI features enabled
    const aiEnabled = await ctx.runQuery(api.walletSummaries.checkAIFeaturesEnabled, {});
    if (!aiEnabled) {
      throw new Error("AI Call Records require a paid plan. Upgrade to unlock transcript analysis.");
    }
    const { callId } = await performExtraction(ctx, args);
    return { callId };
  },
});

export const retryImportedTranscriptExtraction: ReturnType<typeof action> = action({
  args: {
    callId: v.id("calls"),
    transcriptText: v.string(),
    phoneNumber: v.optional(v.string()),
    contactName: v.optional(v.string()),
    existingContactId: v.optional(v.id("contacts")),
    caseName: v.optional(v.string()),
    existingCaseId: v.optional(v.id("cases")),
    context: v.optional(v.string()),
    language: v.optional(v.string()),
    failedRunId: v.id("aiExtractionRuns"),
  },
  handler: async (ctx, args) => {
    // Verify the failed run exists and is actually failed
    const failedRun = await ctx.runQuery(api.aiExtractionRuns.getExtractionRunById, {
      runId: args.failedRunId,
    });
    if (!failedRun) {
      throw new Error("Original extraction run not found.");
    }
    if (failedRun.status !== "failed" && failedRun.status !== "validation_failed") {
      throw new Error("Retry is only available for failed or validation_failed runs.");
    }

    // Clean up any partial records from the failed run
    await ctx.runMutation(internal.importedTranscripts.cleanupFailedAnalysis, { callId: args.callId });

    const { callId } = await performExtraction(ctx, {
      transcriptText: args.transcriptText,
      phoneNumber: args.phoneNumber,
      contactName: args.contactName,
      existingContactId: args.existingContactId,
      caseName: args.caseName,
      existingCaseId: args.existingCaseId,
      context: args.context,
      language: args.language,
      retryOfRunId: args.failedRunId,
      existingCallId: args.callId,
    });

    return { callId };
  },
});

export const regeneratePendingCallRecordLanguage: ReturnType<typeof action> = action({
  args: {
    callId: v.id("calls"),
    callRecordLanguage: v.string(),
  },
  handler: async (ctx, args) => {
    const language = assertCallRecordLanguagePreference(args.callRecordLanguage);
    if (language === "auto") throw new Error("Choose a language before regenerating the draft.");

    const [call, transcript] = await Promise.all([
      ctx.runQuery(api.calls.getCallById, { id: args.callId }),
      ctx.runQuery(api.transcripts.getTranscriptByCallId, { callId: args.callId }),
    ]);
    if (!call || !transcript) throw new Error("Call transcript not found.");
    if (!call.reviewPending) throw new Error("Only a review-pending draft can be regenerated.");

    const latestRun = await ctx.runQuery(api.aiExtractionRuns.getLatestExtractionRunByCallId, {
      callId: args.callId,
    });
    const { callId } = await performExtraction(ctx, {
      transcriptText: transcript.text,
      phoneNumber: call.dialedNumber,
      existingContactId: call.contactId,
      existingCaseId: call.caseId,
      context: call.userNotes,
      language: transcript.language,
      callRecordLanguage: language,
      retryOfRunId: latestRun?._id,
      existingCallId: args.callId,
      source:
        call.callMode === "imported" || call.callMode === "internal_audio_import"
          ? "imported_transcript"
          : "provider_transcript_future",
      workspaceId: call.workspaceId,
      replacePendingDraft: true,
    });
    return { callId };
  },
});
