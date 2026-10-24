/**
 * AI Extraction Prompt Versioning
 *
 * Rules for coding agents:
 * - Always bump the version string when changing the prompt or schema.
 * - Never change prompts silently; document the change in LOG.md.
 * - Keep backward compatibility in mind: older aiMemories/reviewSuggestions
 *   store the version they were generated with.
 */

import { getWorkflowTemplate } from "../workflow-templates";

export const AI_EXTRACTION_PROMPT_VERSION = "call-memory-v9-operator-language-authority";

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/**
 * Build the extraction prompt for a given transcript and context.
 */
export function buildExtractionPrompt({
  transcriptText,
  phoneNumber,
  contactName,
  caseName,
  context,
  transcriptLanguage,
  callRecordLanguage,
  cases,
  contacts,
  workflowTemplateKey,
}: {
  transcriptText: string;
  phoneNumber?: string;
  contactName?: string;
  caseName?: string;
  context?: string;
  transcriptLanguage?: string;
  callRecordLanguage?: string;
  cases: Array<{ id: string; title: string; summary: string; clientName: string; status: string }>;
  contacts: Array<{ id: string; name: string; type: string; country: string; phoneNumber: string; notes: string }>;
  workflowTemplateKey?: string;
}) {
  const workflowTemplate = getWorkflowTemplate(workflowTemplateKey);
  const systemPrompt =
    "You extract operational call memory for Voxandra. Return only JSON matching the schema. The draft must be reviewed by a human before records are accepted.";

  const taskInstructions = [
    "Analyze this pasted call transcript or rough call notes for Voxandra.",
    "",
    "Return structured JSON only. The output is a draft for human review.",
    "",
    "Rules:",
    "- Never invent facts. If information is missing, use null or an empty array.",
    "- Preserve uncertainty: lower confidence when notes are rough or ambiguous.",
    "- Keep the summary concise (1-3 sentences) and factual.",
    "- Extract operationally useful details: references, people, dates, amounts, documents, next steps, discrepancies, risk flags.",
    "- Identify action items with clear titles and due dates when mentioned.",
    "- Identify follow-up dates and reminders.",
    "- Identify required documents explicitly requested during the call.",
    "- Identify references, case numbers, invoice numbers, claim numbers, and appointment IDs.",
    "- Classify the call type automatically from the allowed list.",
    "- Treat cases as lightweight work threads: an ongoing process the call belongs to, not a heavy CRM case.",
    "- Suggest an existing thread only when the transcript clearly concerns the same person/process/reference/institutional workflow.",
    "- Suggest a new thread title when the call starts a distinct ongoing process worth grouping with future calls.",
    "- Use the selected workflow template as an extraction lens, but do not invent template fields that were not discussed.",
    "- Prioritize template-relevant references, blockers, dates, owners, required documents, and next steps.",
    "- Do not provide legal, medical, or financial advice.",
    "- Do not claim that the transcript proves anything.",
    "- Do not hallucinate contact names, case numbers, or dates that are not in the text.",
    "- Use ISO 8601 strings for due dates or reminder times when enough information exists; otherwise use null.",
    "- For suggestedExistingCaseId, return only an ID from the provided existing cases list, or null.",
    "",
    "Language handling (critical):",
    "- Treat callRecordLanguage as authoritative for generated operational content. It represents the Voxandra operator's language and is independent from the other participant and Live Translation.",
    "- transcriptLanguage describes the recorded conversation only. Never use it, existing cases, contacts, prior summaries, or contact notes to override callRecordLanguage.",
    "- Set the JSON language field to callRecordLanguage.",
    "- Write all human-reviewable generated content in callRecordLanguage.",
    "- This includes summary, outcome, keyPoints, extracted entity labels and values, requiredDocuments, action item titles/descriptions, reminder title, suggestedNewCaseTitle, suggestedContactName/type/country, riskFlags, discrepancies, and participant evidence.",
    "- Keep app UI chrome outside this JSON in English; only this JSON review content should follow the call language.",
    "- Preserve proper nouns, phone numbers, account numbers, references, and dates from the transcript unless the schema requires ISO normalization.",
    "- If the call is multilingual, still write generated prose in callRecordLanguage and preserve quoted words in their original language.",
    "- Context records may legitimately be written in another language. Their language must not influence the language of this call's generated content.",
    "",
    "Participant role inference (critical for correct organization):",
    "- Analyze who is speaking and infer their role in the conversation.",
    "- caller: the person who initiated the call or is seeking help. Clues: provides personal details (address, DOB, account number, vehicle info), asks questions, requests assistance, says 'I need' or 'I want'. If the caller gives a personal name and a team or department, put the personal name in caller.name and keep the team as contextual wording in the summary or entities.",
    "- representative: the named person answering or assisting at the reached organization. Clues: says 'thank you for calling', 'how may I help you', asks verification questions, provides institutional information, says 'I will' or 'we will'. If the transcript says 'Raul at Northstar Finance', set representative.name to 'Raul' and representative.institutionName to 'Northstar Finance'.",
    "- institution: the organization, company, government office, public agency, university, finance department, supplier, employer, support line, or other institution being contacted. This should usually become the contact/institution record, NOT the caller or the individual representative.",
    "- subject: the person or account the call is about. Often the same as the caller, but may differ (e.g., a parent calling about a child's application, an HR rep calling about a candidate).",
    "- Keep representative and institution separate even when both appear together. Do NOT merge a representative name with the company, institution, government office, university, or department name.",
    "- Do NOT treat every person name as a contact/institution. Distinguish caller from representative from institution.",
    "- If unsure about a role, set the roleLabel/subjectType/type to 'unknown' and lower the confidence.",
    "- Never invent names or organizations not present in the transcript.",
    "- Include brief evidence strings explaining why you inferred each role.",
    "",
    "Action item and reminder phrasing:",
    "- Phrase action items around the operational next step, not around a person generically.",
    "- BAD: 'Follow up with Lauren' (who is Lauren? what about?)",
    "- GOOD: 'Follow up with Nissan support to complete John Smith's map update order.'",
    "- GOOD: 'Confirm with John Smith whether to continue the map update order.'",
    "- Attach action items to the case/caller by default, unless the representative explicitly promised to do something.",
    "- If a representative promised to send something or call back, phrase it as: 'Wait for [institution] to [action]' rather than 'Follow up with [representative name]'.",
    "",
    `Current date: ${new Date().toISOString()}`,
    "",
    "Optional user context:",
    JSON.stringify(
      {
        phoneNumber: nullableText(phoneNumber),
        contactOrInstitutionName: nullableText(contactName),
        caseName: nullableText(caseName),
        context: nullableText(context),
        transcriptLanguage: nullableText(transcriptLanguage),
        callRecordLanguage: nullableText(callRecordLanguage),
        workflowTemplate: {
          key: workflowTemplate.key,
          label: workflowTemplate.label,
          extractionFocus: workflowTemplate.extractionFocus,
          checklist: workflowTemplate.checklist,
        },
      },
      null,
      2
    ),
    "",
    "Existing cases available for matching:",
    JSON.stringify(
      cases.map((caseItem) => ({
        id: caseItem.id,
        title: caseItem.title,
        clientName: caseItem.clientName,
        status: caseItem.status,
        summary: caseItem.summary,
      })),
      null,
      2
    ),
    "",
    "Existing contacts/institutions available for context:",
    JSON.stringify(
      contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        type: contact.type,
        country: contact.country,
        phoneNumber: contact.phoneNumber,
        notes: contact.notes,
      })),
      null,
      2
    ),
    "",
    `Required generated-content language: ${nullableText(callRecordLanguage) ?? "unknown"}`,
    "Ignore the language of contextual records when following this instruction.",
    "",
    "Transcript or notes:",
    transcriptText,
  ].join("\n");

  return { systemPrompt, taskInstructions };
}

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Simple cost estimation for OpenAI models.
 * Prices are approximate and should be updated when OpenAI pricing changes.
 * Returns null if the model is not in the known price map.
 */
export function estimateCostUsd(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined
): number | null {
  if (!usage) return null;

  // Pricing per 1M tokens (input / output) — approximate as of 2025-05
  const priceMap: Record<string, { input: number; output: number }> = {
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-2024-08-06": { input: 2.5, output: 10 },
    "gpt-4o-2024-05-13": { input: 5, output: 15 },
    "gpt-5.4-mini-2026-03-17": { input: 0.15, output: 0.6 },
    "gpt-5.4-2026-03-17": { input: 2.5, output: 10 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "o1-mini": { input: 1.1, output: 4.4 },
  };

  const normalizedModel = Object.keys(priceMap).find((k) => model.includes(k));
  if (!normalizedModel) return null;

  const prices = priceMap[normalizedModel];
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;

  const inputCost = (inputTokens / 1_000_000) * prices.input;
  const outputCost = (outputTokens / 1_000_000) * prices.output;

  return Number((inputCost + outputCost).toFixed(6));
}
