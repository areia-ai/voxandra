import type {
  AIMemory,
  ActionItem,
  Call,
  Case,
  Contact,
  ExtractedEntity,
  Reminder,
  ReviewSuggestion,
  Transcript,
} from "./types";

export interface SimulatedCallInput {
  phoneNumber: string;
  contactId?: string;
  caseId?: string;
  objective?: string;
}

export interface GeneratedCallArtifacts {
  transcript: Transcript;
  aiMemory: AIMemory & { extractedEntities: ExtractedEntity[] };
  reviewSuggestion: ReviewSuggestion;
}

interface GeneratorState {
  cases: Case[];
  contacts: Contact[];
}

type ScenarioKey =
  | "immigration"
  | "verification"
  | "sponsorship"
  | "invoice"
  | "banking"
  | "generic";

function cleanId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 36);
}

function hashString(value: string) {
  return value.split("").reduce((total, character) => total + character.charCodeAt(0), 0);
}

function addDays(isoDate: string, days: number) {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function friendlyDate(isoDate: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(isoDate));
}

function inferScenario(input: SimulatedCallInput, state: GeneratorState): ScenarioKey {
  const selectedCase = input.caseId ? state.cases.find((item) => item.id === input.caseId) : undefined;
  const selectedContact = input.contactId ? state.contacts.find((item) => item.id === input.contactId) : undefined;
  const text = `${input.objective ?? ""} ${selectedCase?.type ?? ""} ${selectedCase?.title ?? ""} ${selectedContact?.type ?? ""} ${selectedContact?.name ?? ""}`.toLowerCase();

  if (text.includes("immigration") || text.includes("visa") || text.includes("permit") || text.includes("d7")) {
    return "immigration";
  }

  if (text.includes("background") || text.includes("verification") || text.includes("university") || text.includes("employer")) {
    return "verification";
  }

  if (text.includes("sponsor") || text.includes("conference") || text.includes("media") || text.includes("insurance")) {
    return "sponsorship";
  }

  if (text.includes("invoice") || text.includes("supplier") || text.includes("payment")) {
    return "invoice";
  }

  if (text.includes("bank") || text.includes("finance") || text.includes("account")) {
    return "banking";
  }

  const scenarios: ScenarioKey[] = ["immigration", "verification", "sponsorship", "invoice", "banking", "generic"];
  return scenarios[hashString(input.phoneNumber) % scenarios.length];
}

function suggestedContact(input: SimulatedCallInput, scenario: ScenarioKey): ReviewSuggestion["suggestedContactCreation"] {
  if (input.contactId) {
    return undefined;
  }

  const byScenario: Record<ScenarioKey, NonNullable<ReviewSuggestion["suggestedContactCreation"]>> = {
    immigration: {
      name: "Consular Documents Office",
      type: "government",
      country: "Portugal",
      phoneNumber: input.phoneNumber,
    },
    verification: {
      name: "Records Verification Desk",
      type: "university",
      country: "United Kingdom",
      phoneNumber: input.phoneNumber,
    },
    sponsorship: {
      name: "Partnerships Office",
      type: "insurance",
      country: "United States",
      phoneNumber: input.phoneNumber,
    },
    invoice: {
      name: "Supplier Finance Desk",
      type: "supplier",
      country: "Germany",
      phoneNumber: input.phoneNumber,
    },
    banking: {
      name: "International Banking Support",
      type: "finance",
      country: "Netherlands",
      phoneNumber: input.phoneNumber,
    },
    generic: {
      name: "International Admin Office",
      type: "other",
      country: "Unknown",
      phoneNumber: input.phoneNumber,
    },
  };

  return byScenario[scenario];
}

export function buildSimulatedCallArtifacts({
  call,
  input,
  state,
  durationSeconds,
}: {
  call: Call;
  input: SimulatedCallInput;
  state: GeneratorState;
  durationSeconds: number;
}): GeneratedCallArtifacts {
  const scenario = inferScenario(input, state);
  const seed = cleanId(call.id);
  const followUpIso = addDays(call.startedAt, scenario === "invoice" ? 2 : 5);
  const followUpDate = friendlyDate(followUpIso);
  const reference = `${scenario.slice(0, 3).toUpperCase()}-${(hashString(call.id + input.phoneNumber) * 37)
    .toString()
    .slice(0, 5)}`;

  const base = {
    immigration: {
      type: "Relocation document check",
      summary: `The office confirmed reference ${reference} is missing updated proof of address and a recent bank statement. They can keep the appointment window open if the documents are sent by ${followUpDate}.`,
      outcome: "Missing documents and follow-up deadline identified.",
      newCaseTitle: "Immigration document follow-up",
      actionTitle: "Send missing residence documents",
      actionDescription: "Send proof of address and recent bank statement before the office closes the appointment window.",
      reminderTitle: "Confirm immigration documents were accepted",
      requiredDocuments: ["Proof of address", "Recent bank statement"],
      entities: [
        ["reference_number", "Reference number", reference],
        ["required_document", "Required document", "Proof of address"],
        ["required_document", "Required document", "Recent bank statement"],
        ["appointment_date", "Appointment window", friendlyDate(addDays(call.startedAt, 12))],
        ["due_date", "Follow-up deadline", followUpDate],
      ],
      transcript: [
        ["You", `I am calling about a residence file. The reference I have is ${reference}. Can you tell me what is missing?`],
        ["Office", "I can see the file. The main missing item is updated proof of address."],
        ["You", "Is there anything else required before the appointment can stay in place?"],
        ["Office", "Yes, we also need a recent bank statement. It should show the account holder and the last month of activity."],
        ["You", `If we send both documents, can the appointment window remain open?`],
        ["Office", `Yes. Send them before ${followUpDate}, then call again to confirm they were accepted.`],
        ["You", "Thank you. I will send proof of address and the bank statement, then follow up."],
        ["Office", "That is correct. Keep the reference number in the subject line."],
      ],
    },
    verification: {
      type: "Background verification",
      summary: `The records desk found a matching candidate record under reference ${reference}. Official confirmation requires a signed consent form, and the office noted one date discrepancy that needs written clarification.`,
      outcome: "Record located; consent and date clarification required.",
      newCaseTitle: "Candidate verification follow-up",
      actionTitle: "Send consent form and date clarification",
      actionDescription: "Email the signed consent form and ask the candidate to confirm the disputed end date.",
      reminderTitle: "Follow up on verification release",
      requiredDocuments: ["Signed consent form"],
      entities: [
        ["reference_number", "Verification reference", reference],
        ["person_name", "Candidate", "Aminah Clarke"],
        ["verification_outcome", "Verification outcome", "Record located"],
        ["discrepancy", "Discrepancy", "End date needs clarification"],
        ["next_step", "Next step", "Send signed consent form"],
      ],
      transcript: [
        ["You", `I am checking a candidate verification request. The reference is ${reference}.`],
        ["Office", "We found a matching record, but we cannot release official dates without consent."],
        ["You", "Is the degree title consistent with the candidate's submission?"],
        ["Office", "The title appears consistent. The only issue is the end date."],
        ["You", "What should we send next?"],
        ["Office", "Send a signed consent form and ask the candidate to clarify the end date in writing."],
        ["You", `If we send that today, when should we follow up?`],
        ["Office", `Follow up around ${followUpDate}.`],
      ],
    },
    sponsorship: {
      type: "Sponsorship qualification",
      summary: `The partnerships team showed conditional interest. Lena Ortiz is the decision maker, budget could reach $18,000, and they asked for audience demographics and panel options before ${followUpDate}.`,
      outcome: "Warm sponsor lead qualified with a clear follow-up package.",
      newCaseTitle: "Conference sponsorship follow-up",
      actionTitle: "Send sponsor pack",
      actionDescription: "Email audience demographics, panel options, and mid-tier sponsorship pricing.",
      reminderTitle: "Follow up on sponsor package",
      requiredDocuments: ["Sponsor pack", "Audience demographics"],
      entities: [
        ["decision_maker", "Decision maker", "Lena Ortiz"],
        ["amount", "Budget mentioned", "$18,000"],
        ["interest_level", "Interest level", "Warm, conditional interest"],
        ["due_date", "Requested by", followUpDate],
        ["next_step", "Next step", "Send sponsor pack"],
      ],
      transcript: [
        ["You", "I am calling about possible sponsorship for our risk leadership conference."],
        ["Office", "The person you want is Lena Ortiz. She reviews partnership packages."],
        ["You", "Is there budget for this kind of event?"],
        ["Office", "Potentially. For the right audience, it could be up to eighteen thousand dollars."],
        ["You", "What would help Lena evaluate it?"],
        ["Office", "Audience demographics, panel options, and a clear mid-tier package."],
        ["You", `Can I send that and follow up around ${followUpDate}?`],
        ["Office", "Yes, that timing works."],
      ],
    },
    invoice: {
      type: "Invoice dispute",
      summary: `Finance confirmed invoice ${reference} is paused because the purchase order proof is missing. The disputed amount is EUR 4,850 and Petra Klein owns the next payment step.`,
      outcome: "Payment path identified; proof document required.",
      newCaseTitle: "Supplier invoice dispute",
      actionTitle: "Send purchase order proof",
      actionDescription: "Send PO proof to Petra Klein and ask finance to confirm the revised payment path.",
      reminderTitle: "Confirm invoice payment path",
      requiredDocuments: ["Purchase order proof"],
      entities: [
        ["invoice_number", "Invoice number", reference],
        ["amount", "Disputed amount", "EUR 4,850"],
        ["person_name", "Responsible person", "Petra Klein"],
        ["due_date", "Follow-up date", followUpDate],
        ["next_step", "Next payment step", "Send purchase order proof"],
      ],
      transcript: [
        ["You", `I am calling about invoice ${reference}. The amount does not match our purchase order.`],
        ["Office", "I see the invoice is paused. The disputed amount is four thousand eight hundred fifty euros."],
        ["You", "Who owns the next step on your side?"],
        ["Office", "Petra Klein in finance is handling it."],
        ["You", "What does she need from us?"],
        ["Office", "Send the purchase order proof and mark it for her attention."],
        ["You", `Should I follow up on ${followUpDate}?`],
        ["Office", "Yes, that is reasonable."],
      ],
    },
    banking: {
      type: "Banking support follow-up",
      summary: `The support desk opened reference ${reference} for an international transfer trace. They need the payment receipt and beneficiary IBAN before they can escalate.`,
      outcome: "Transfer trace opened; documents required for escalation.",
      newCaseTitle: "International transfer trace",
      actionTitle: "Send transfer receipt and beneficiary IBAN",
      actionDescription: "Send the receipt and beneficiary IBAN to support with the reference number in the subject.",
      reminderTitle: "Check transfer trace escalation",
      requiredDocuments: ["Transfer receipt", "Beneficiary IBAN"],
      entities: [
        ["reference_number", "Bank reference", reference],
        ["required_document", "Required document", "Transfer receipt"],
        ["required_document", "Required document", "Beneficiary IBAN"],
        ["due_date", "Follow-up date", followUpDate],
        ["next_step", "Next step", "Send documents for escalation"],
      ],
      transcript: [
        ["You", "I am calling about an international transfer that has not arrived."],
        ["Office", `I can open a trace. Your reference is ${reference}.`],
        ["You", "What do you need from us to escalate it?"],
        ["Office", "We need the payment receipt and beneficiary IBAN."],
        ["You", "Can I send those by email?"],
        ["Office", "Yes, include the reference number in the subject line."],
        ["You", `When should I check back?`],
        ["Office", `Please check back around ${followUpDate}.`],
      ],
    },
    generic: {
      type: "International admin follow-up",
      summary: `The office created reference ${reference}, identified a missing document, and asked for a follow-up around ${followUpDate}. Voxandra suggests creating a case so this does not get lost.`,
      outcome: "Reference number and next step captured.",
      newCaseTitle: "International admin follow-up",
      actionTitle: "Send requested document",
      actionDescription: "Send the requested document with the reference number in the subject line.",
      reminderTitle: "Follow up with international office",
      requiredDocuments: ["Requested supporting document"],
      entities: [
        ["reference_number", "Reference number", reference],
        ["required_document", "Required document", "Requested supporting document"],
        ["due_date", "Follow-up date", followUpDate],
        ["next_step", "Next step", "Send document and confirm receipt"],
      ],
      transcript: [
        ["You", input.objective || "I am calling to check what is needed for this administrative request."],
        ["Office", `We can help. The reference for this call is ${reference}.`],
        ["You", "What should I do next?"],
        ["Office", "Please send the requested supporting document by email."],
        ["You", "Should I include anything in the subject line?"],
        ["Office", "Yes, include the reference number so it can be matched quickly."],
        ["You", `When should I follow up?`],
        ["Office", `Follow up around ${followUpDate}.`],
      ],
    },
  }[scenario];

  const entities = base.entities.map(
    ([type, label, value], index): ExtractedEntity => ({
      id: `entity-${seed}-${index}`,
      type: type as ExtractedEntity["type"],
      label,
      value,
      confidence: Math.max(0.76, 0.94 - index * 0.03),
    }),
  );

  const action: ActionItem = {
    id: `action-${seed}`,
    callId: call.id,
    caseId: input.caseId,
    title: base.actionTitle,
    description: base.actionDescription,
    dueAt: followUpIso,
    status: "open",
    source: "simulated",
  };

  const reminder: Reminder = {
    id: `reminder-${seed}`,
    title: base.reminderTitle,
    remindAt: followUpIso,
    status: "upcoming",
    callId: call.id,
    caseId: input.caseId,
    contactId: input.contactId,
    source: "simulated",
  };

  const transcript: Transcript = {
    id: `transcript-${seed}`,
    callId: call.id,
    source: "simulated",
    language: "English",
    confidence: 0.86,
    text: base.transcript.map(([speaker, text]) => `${speaker}: ${text}`).join("\n"),
    segments: base.transcript.map(([speaker, text]) => ({
      speaker: speaker as Transcript["segments"][number]["speaker"],
      text,
    })),
  };

  const aiMemory: AIMemory & { extractedEntities: ExtractedEntity[] } = {
    id: `memory-${seed}`,
    callId: call.id,
    caseId: input.caseId,
    detectedCallType: base.type,
    summary: base.summary,
    outcome: base.outcome,
    confidence: 0.86,
    requiredDocuments: base.requiredDocuments,
    highlights: entities.slice(0, 3).map((entity) => entity.value),
    reviewStatus: "pending",
    extractedEntities: entities,
  };

  const reviewSuggestion: ReviewSuggestion = {
    id: `review-${seed}`,
    callId: call.id,
    detectedCallType: base.type,
    summary: base.summary,
    extractedEntities: entities,
    suggestedActionItems: [action],
    suggestedReminder: reminder,
    suggestedExistingCaseId: input.caseId,
    suggestedNewCaseTitle: input.caseId ? undefined : base.newCaseTitle,
    suggestedContactCreation: suggestedContact(input, scenario),
    confidence: 0.86,
    status: "pending",
  };

  return {
    transcript,
    aiMemory,
    reviewSuggestion: {
      ...reviewSuggestion,
      suggestedActionItems: reviewSuggestion.suggestedActionItems.map((item) => ({
        ...item,
        description:
          input.objective && input.objective.length > 6
            ? `${item.description} Objective noted: ${input.objective}`
            : item.description,
      })),
      confidence: Math.min(0.94, 0.8 + Math.min(durationSeconds, 180) / 900),
    },
  };
}
