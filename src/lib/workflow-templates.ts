export type WorkflowTemplateKey =
  | "general_follow_up"
  | "supplier_payment"
  | "support_escalation"
  | "claim_status"
  | "logistics_delivery"
  | "appointment_intake";

export type WorkflowTemplate = {
  key: WorkflowTemplateKey;
  label: string;
  shortLabel: string;
  description: string;
  extractionFocus: string[];
  checklist: string[];
  objectivePrompt: string;
};

export const workflowTemplates: WorkflowTemplate[] = [
  {
    key: "general_follow_up",
    label: "General follow-up",
    shortLabel: "General",
    description: "A flexible call record template for open-ended operational follow-up.",
    extractionFocus: [
      "people and organizations",
      "reference numbers",
      "dates and deadlines",
      "commitments",
      "next steps",
    ],
    checklist: [
      "Confirm the reason for the call.",
      "Capture the best reference number or account identifier.",
      "Clarify who owns the next step.",
      "Ask when the team should follow up.",
    ],
    objectivePrompt: "Confirm the current status, next owner, and follow-up date.",
  },
  {
    key: "supplier_payment",
    label: "Supplier/payment",
    shortLabel: "Payment",
    description: "Track invoice, purchase order, document, approval, and payment release calls.",
    extractionFocus: [
      "invoice numbers",
      "purchase orders",
      "payment status",
      "blocking documents",
      "release dates",
      "finance contacts",
    ],
    checklist: [
      "Confirm the PO or invoice number.",
      "Ask whether payment is approved, blocked, or released.",
      "Capture any missing document or portal requirement.",
      "Confirm the expected release date or next update.",
    ],
    objectivePrompt: "Confirm payment status, blockers, and the exact release requirement.",
  },
  {
    key: "support_escalation",
    label: "Support escalation",
    shortLabel: "Support",
    description: "Keep support cases, incident details, owners, and promised updates together.",
    extractionFocus: [
      "ticket numbers",
      "issue symptoms",
      "severity",
      "owner",
      "workaround",
      "promised update",
    ],
    checklist: [
      "Confirm the ticket or case number.",
      "Ask who owns the escalation.",
      "Capture severity, workaround, and current blocker.",
      "Confirm when the next update will arrive.",
    ],
    objectivePrompt: "Get the case status, owner, blocker, and next promised update.",
  },
  {
    key: "claim_status",
    label: "Claim/status update",
    shortLabel: "Claim",
    description: "Track claims, requirements, evidence, decisions, and status updates.",
    extractionFocus: [
      "claim numbers",
      "policy or account identifiers",
      "required evidence",
      "review status",
      "decision dates",
      "appeal or escalation path",
    ],
    checklist: [
      "Confirm the claim or account reference.",
      "Ask what evidence or document is still needed.",
      "Capture the review status and expected decision date.",
      "Ask how to escalate if the deadline slips.",
    ],
    objectivePrompt: "Confirm claim status, missing evidence, and the next decision date.",
  },
  {
    key: "logistics_delivery",
    label: "Logistics/delivery",
    shortLabel: "Logistics",
    description: "Track shipments, delivery windows, exceptions, addresses, and handoffs.",
    extractionFocus: [
      "tracking numbers",
      "delivery windows",
      "addresses",
      "carrier contacts",
      "exceptions",
      "handoff requirements",
    ],
    checklist: [
      "Confirm the tracking or shipment number.",
      "Ask for the current location and delivery window.",
      "Capture any exception, address issue, or missing handoff.",
      "Confirm who will update whom next.",
    ],
    objectivePrompt: "Confirm delivery status, exception reason, and next handoff.",
  },
  {
    key: "appointment_intake",
    label: "Appointment/intake",
    shortLabel: "Intake",
    description: "Track appointment booking, intake requirements, preparation, and reminders.",
    extractionFocus: [
      "appointment dates",
      "intake requirements",
      "documents to bring",
      "location",
      "preparation steps",
      "confirmation numbers",
    ],
    checklist: [
      "Confirm the appointment date, time, and location.",
      "Ask what documents or preparation are required.",
      "Capture confirmation or booking reference.",
      "Confirm cancellation or rescheduling rules.",
    ],
    objectivePrompt: "Confirm appointment details, preparation requirements, and reminder timing.",
  },
];

export const DEFAULT_WORKFLOW_TEMPLATE_KEY: WorkflowTemplateKey = "general_follow_up";

export function getWorkflowTemplate(key: string | null | undefined): WorkflowTemplate {
  return (
    workflowTemplates.find((template) => template.key === key) ??
    workflowTemplates.find((template) => template.key === DEFAULT_WORKFLOW_TEMPLATE_KEY)!
  );
}

export function isWorkflowTemplateKey(value: string | null | undefined): value is WorkflowTemplateKey {
  return workflowTemplates.some((template) => template.key === value);
}
