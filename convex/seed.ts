import { internalMutation } from "./_generated/server";
import { requireWorkspace } from "./authHelpers";

export const seedDemoData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);

    // Check if already seeded in this workspace
    const existingContacts = await ctx.db
      .query("contacts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    
    if (existingContacts.length > 0) {
      return { workspaceId, alreadySeeded: true };
    }

    // Create contacts
    const contactImmigration = await ctx.db.insert("contacts", {
      workspaceId,
      name: "Lisbon Immigration Office",
      type: "government",
      country: "Portugal",
      phoneNumber: "+351 210 555 014",
      lastCallAt: "2026-04-29T10:15:00+01:00",
      relatedCaseIds: [],
      notes: "Usually asks for reference number before discussing appointment details.",
    });

    const contactUniversity = await ctx.db.insert("contacts", {
      workspaceId,
      name: "University of Manchester Registry",
      type: "university",
      country: "United Kingdom",
      phoneNumber: "+44 161 275 5000",
      lastCallAt: "2026-04-28T15:40:00+01:00",
      relatedCaseIds: [],
      notes: "Registry team handles degree verification requests by email after phone intake.",
    });

    const contactInsurance = await ctx.db.insert("contacts", {
      workspaceId,
      name: "Northstar Insurance Partnerships",
      type: "insurance",
      country: "United States",
      phoneNumber: "+1 312 555 0188",
      lastCallAt: "2026-04-25T17:20:00+01:00",
      relatedCaseIds: [],
      notes: "Partnerships director asked for a written sponsor pack before committing.",
    });

    const contactSupplier = await ctx.db.insert("contacts", {
      workspaceId,
      name: "Alpine Components Finance",
      type: "supplier",
      country: "Germany",
      phoneNumber: "+49 30 5557 1044",
      lastCallAt: "2026-04-24T09:05:00+01:00",
      relatedCaseIds: [],
      notes: "Finance queue routes invoice disputes to Petra Klein.",
    });

    // Create cases
    const caseRenewal = await ctx.db.insert("cases", {
      workspaceId,
      title: "Residence permit renewal for Sofia Mendes",
      type: "Relocation / immigration",
      clientName: "Sofia Mendes",
      status: "waiting",
      lastCallAt: "2026-04-29T10:15:00+01:00",
      nextFollowUpAt: "2026-05-06T09:00:00+01:00",
      callIds: [],
      contactIds: [],
      unresolvedActionItemIds: [],
      summary:
        "D7-style renewal is waiting on proof of accommodation and updated bank statements before the appointment can be confirmed.",
    });

    const caseBackground = await ctx.db.insert("cases", {
      workspaceId,
      title: "Background verification for Aminah Clarke",
      type: "Background verification",
      clientName: "Aminah Clarke",
      status: "active",
      lastCallAt: "2026-04-28T15:40:00+01:00",
      nextFollowUpAt: "2026-05-02T11:00:00+01:00",
      callIds: [],
      contactIds: [],
      unresolvedActionItemIds: [],
      summary:
        "University confirmed degree record but needs candidate consent before releasing official dates.",
    });

    const caseSponsor = await ctx.db.insert("cases", {
      workspaceId,
      title: "Insurance sponsor outreach for Risk Leaders Forum",
      type: "B2B media / conference",
      clientName: "Risk Leaders Forum",
      status: "active",
      lastCallAt: "2026-04-25T17:20:00+01:00",
      nextFollowUpAt: "2026-05-03T16:30:00+01:00",
      callIds: [],
      contactIds: [],
      unresolvedActionItemIds: [],
      summary:
        "Prospect showed interest in a mid-tier sponsorship if audience demographics and panel availability are clear.",
    });

    const caseInvoice = await ctx.db.insert("cases", {
      workspaceId,
      title: "Invoice dispute with Alpine Components",
      type: "Supplier / invoice",
      clientName: "Marisol Trading",
      status: "blocked",
      lastCallAt: "2026-04-24T09:05:00+01:00",
      nextFollowUpAt: "2026-05-01T12:00:00+01:00",
      callIds: [],
      contactIds: [],
      unresolvedActionItemIds: [],
      summary:
        "Supplier is holding payment allocation until the purchase order proof and revised amount are confirmed.",
    });

    // Create calls
    const callImmigration = await ctx.db.insert("calls", {
      workspaceId,
      contactId: contactImmigration,
      caseId: caseRenewal,
      dialedNumber: "+351 210 555 014",
      startedAt: "2026-04-29T09:15:00.000Z",
      durationSeconds: 742,
      status: "completed",
      processingStatus: "memory_ready",
      aiMemoryReady: true,
      reviewPending: false,
      highlights: ["Reference SEF-REN-48392", "Bank statements missing", "Follow up May 6"],
      userNotes: "",
      simulated: true,
      callMode: "simulated",
    });

    const callUniversity = await ctx.db.insert("calls", {
      workspaceId,
      contactId: contactUniversity,
      caseId: caseBackground,
      dialedNumber: "+44 161 275 5000",
      startedAt: "2026-04-28T14:40:00.000Z",
      durationSeconds: 518,
      status: "completed",
      processingStatus: "memory_ready",
      aiMemoryReady: true,
      reviewPending: false,
      highlights: ["Candidate consent needed", "Degree record located", "Dates need official release"],
      userNotes: "",
      simulated: true,
      callMode: "simulated",
    });

    const callInsurance = await ctx.db.insert("calls", {
      workspaceId,
      contactId: contactInsurance,
      caseId: caseSponsor,
      dialedNumber: "+1 312 555 0188",
      startedAt: "2026-04-25T16:20:00.000Z",
      durationSeconds: 604,
      status: "completed",
      processingStatus: "memory_ready",
      aiMemoryReady: true,
      reviewPending: false,
      highlights: ["Budget up to $18k", "Decision maker: Lena Ortiz", "Email sponsor pack"],
      userNotes: "",
      simulated: true,
      callMode: "simulated",
    });

    const callInvoice = await ctx.db.insert("calls", {
      workspaceId,
      contactId: contactSupplier,
      caseId: caseInvoice,
      dialedNumber: "+49 30 5557 1044",
      startedAt: "2026-04-24T08:05:00.000Z",
      durationSeconds: 681,
      status: "completed",
      processingStatus: "memory_ready",
      aiMemoryReady: true,
      reviewPending: false,
      highlights: ["Invoice AC-77821", "Disputed amount EUR 4,850", "Petra Klein owns next step"],
      userNotes: "",
      simulated: true,
      callMode: "simulated",
    });

    // Create transcripts
    const transcriptImmigration = await ctx.db.insert("transcripts", {
      workspaceId,
      callId: callImmigration,
      source: "mock",
      language: "English",
      confidence: 0.91,
      text: "Caller asked about residence permit renewal reference SEF-REN-48392. The office said the file is missing updated bank statements and proof of accommodation. Appointment can be held for May 14 if documents arrive by May 6.",
      segments: [
        { speaker: "A", text: "I am calling about Sofia Mendes and renewal reference SEF-REN-48392. Can you confirm what is still missing?" },
        { speaker: "B", text: "The file is missing updated bank statements for the last three months and current proof of accommodation." },
        { speaker: "B", text: "If those are uploaded by May 6, we can keep the May 14 appointment window." },
      ],
      speakerMappings: [
        { label: "A", name: "Caller", role: "caller", source: "ai_inferred", confidence: 0.8 },
        { label: "B", name: "Immigration Office", role: "institution", source: "ai_inferred", confidence: 0.8 },
      ],
      transcriptionModel: "gpt-4o-transcribe-diarize",
      transcriptionProvider: "openai",
    });

    const transcriptUniversity = await ctx.db.insert("transcripts", {
      workspaceId,
      callId: callUniversity,
      source: "mock",
      language: "English",
      confidence: 0.88,
      text: "Registry located Aminah Clarke's MSc record. They can confirm attendance from September 2018 to July 2020, but official verification requires a signed consent form and case reference BV-2048.",
      segments: [
        { speaker: "A", text: "We are verifying Aminah Clarke's MSc record and employment background for case BV-2048." },
        { speaker: "B", text: "We have located a matching record. Official dates require a signed candidate consent form." },
        { speaker: "B", text: "There is no discrepancy in the award title, but the attendance end date needs formal release." },
      ],
      speakerMappings: [
        { label: "A", name: "Caller", role: "caller", source: "ai_inferred", confidence: 0.8 },
        { label: "B", name: "University Registry", role: "institution", source: "ai_inferred", confidence: 0.8 },
      ],
      transcriptionModel: "gpt-4o-transcribe-diarize",
      transcriptionProvider: "openai",
    });

    const transcriptInsurance = await ctx.db.insert("transcripts", {
      workspaceId,
      callId: callInsurance,
      source: "mock",
      language: "English",
      confidence: 0.84,
      text: "Northstar Insurance is interested in conference participation. Lena Ortiz is the decision maker. Budget discussed was up to $18,000 if audience demographics and panel options fit. Follow-up email requested by May 3.",
      segments: [
        { speaker: "A", text: "Would Northstar consider sponsoring the Risk Leaders Forum this year?" },
        { speaker: "B", text: "Lena Ortiz owns that decision. The budget could be up to eighteen thousand dollars for the right package." },
        { speaker: "B", text: "Please send the sponsor pack with audience demographics and panel opportunities before Friday." },
      ],
      speakerMappings: [
        { label: "A", name: "Caller", role: "caller", source: "ai_inferred", confidence: 0.8 },
        { label: "B", name: "Northstar Insurance", role: "institution", source: "ai_inferred", confidence: 0.8 },
      ],
      transcriptionModel: "gpt-4o-transcribe-diarize",
      transcriptionProvider: "openai",
    });

    const transcriptInvoice = await ctx.db.insert("transcripts", {
      workspaceId,
      callId: callInvoice,
      source: "mock",
      language: "English",
      confidence: 0.9,
      text: "Alpine Components finance reviewed invoice AC-77821. The disputed amount is EUR 4,850. Payment is paused until Marisol Trading sends purchase order proof. Petra Klein will recheck the account after receiving it.",
      segments: [
        { speaker: "A", text: "We need to resolve invoice AC-77821. The amount does not match the purchase order." },
        { speaker: "B", text: "We see a disputed balance of four thousand eight hundred fifty euros." },
        { speaker: "B", text: "Send the purchase order proof to Petra Klein and she will release the next payment step." },
      ],
      speakerMappings: [
        { label: "A", name: "Caller", role: "caller", source: "ai_inferred", confidence: 0.8 },
        { label: "B", name: "Alpine Components Finance", role: "institution", source: "ai_inferred", confidence: 0.8 },
      ],
      transcriptionModel: "gpt-4o-transcribe-diarize",
      transcriptionProvider: "openai",
    });

    // Create AI memories
    const memoryImmigration = await ctx.db.insert("aiMemories", {
      workspaceId,
      callId: callImmigration,
      caseId: caseRenewal,
      detectedCallType: "Relocation document check",
      summary:
        "The immigration office confirmed the renewal case is missing updated bank statements and proof of accommodation. If both are uploaded by May 6, the May 14 appointment window can stay in place.",
      outcome: "Documents missing; deadline and appointment window identified.",
      confidence: 0.91,
      requiredDocuments: ["Updated 3-month bank statements", "Current proof of accommodation"],
      highlights: ["Reference number captured", "Two missing documents identified", "Follow-up date suggested"],
      reviewStatus: "accepted",
    });

    const memoryUniversity = await ctx.db.insert("aiMemories", {
      workspaceId,
      callId: callUniversity,
      caseId: caseBackground,
      detectedCallType: "Education verification",
      summary:
        "The registry located Aminah Clarke's MSc record and did not flag an award-title discrepancy. Official attendance dates require a signed consent form.",
      outcome: "Record located; consent required for official verification release.",
      confidence: 0.88,
      requiredDocuments: ["Signed candidate consent form"],
      highlights: ["Candidate record found", "Consent form required", "No award-title discrepancy"],
      reviewStatus: "accepted",
    });

    const memoryInsurance = await ctx.db.insert("aiMemories", {
      workspaceId,
      callId: callInsurance,
      caseId: caseSponsor,
      detectedCallType: "Sponsorship qualification",
      summary:
        "Northstar Insurance is interested in a mid-tier sponsorship if audience demographics and panel opportunities are compelling. Lena Ortiz is the decision maker and asked for a sponsor pack before May 3.",
      outcome: "Qualified sponsor lead with a clear follow-up package.",
      confidence: 0.84,
      requiredDocuments: ["Sponsor pack", "Audience demographics"],
      highlights: ["Decision maker found", "Budget mentioned", "Follow-up action is clear"],
      reviewStatus: "accepted",
    });

    const memoryInvoice = await ctx.db.insert("aiMemories", {
      workspaceId,
      callId: callInvoice,
      caseId: caseInvoice,
      detectedCallType: "Invoice dispute",
      summary:
        "Alpine Components confirmed invoice AC-77821 has a disputed balance of EUR 4,850. Petra Klein will recheck the payment path after receiving purchase order proof.",
      outcome: "Payment remains paused until purchase order proof is sent.",
      confidence: 0.9,
      requiredDocuments: ["Purchase order proof"],
      highlights: ["Invoice captured", "Amount captured", "Responsible person identified"],
      reviewStatus: "accepted",
    });

    // Update calls with transcript and memory IDs
    await ctx.db.patch(callImmigration, { transcriptId: transcriptImmigration, memoryId: memoryImmigration });
    await ctx.db.patch(callUniversity, { transcriptId: transcriptUniversity, memoryId: memoryUniversity });
    await ctx.db.patch(callInsurance, { transcriptId: transcriptInsurance, memoryId: memoryInsurance });
    await ctx.db.patch(callInvoice, { transcriptId: transcriptInvoice, memoryId: memoryInvoice });

    // Create extracted entities
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callImmigration, caseId: caseRenewal,
      type: "reference_number", label: "Reference number", value: "SEF-REN-48392", confidence: 0.96,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callImmigration, caseId: caseRenewal,
      type: "required_document", label: "Required document", value: "Updated 3-month bank statements", confidence: 0.93,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callImmigration, caseId: caseRenewal,
      type: "required_document", label: "Required document", value: "Current proof of accommodation", confidence: 0.9,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callImmigration, caseId: caseRenewal,
      type: "appointment_date", label: "Appointment window", value: "May 14, 2026", confidence: 0.85,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callImmigration, caseId: caseRenewal,
      type: "due_date", label: "Document deadline", value: "May 6, 2026", confidence: 0.92,
    });

    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callUniversity, caseId: caseBackground,
      type: "person_name", label: "Candidate", value: "Aminah Clarke", confidence: 0.97,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callUniversity, caseId: caseBackground,
      type: "verification_outcome", label: "Degree record", value: "MSc record located", confidence: 0.9,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callUniversity, caseId: caseBackground,
      type: "next_step", label: "Official dates", value: "Release after consent form", confidence: 0.87,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callUniversity, caseId: caseBackground,
      type: "discrepancy", label: "Discrepancy", value: "No award-title discrepancy", confidence: 0.82,
    });

    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callInsurance, caseId: caseSponsor,
      type: "decision_maker", label: "Decision maker", value: "Lena Ortiz", confidence: 0.91,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callInsurance, caseId: caseSponsor,
      type: "amount", label: "Budget mentioned", value: "$18,000", confidence: 0.86,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callInsurance, caseId: caseSponsor,
      type: "interest_level", label: "Interest level", value: "Warm, conditional interest", confidence: 0.78,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callInsurance, caseId: caseSponsor,
      type: "next_step", label: "Next step", value: "Email sponsor pack with demographics and panel options", confidence: 0.93,
    });

    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callInvoice, caseId: caseInvoice,
      type: "invoice_number", label: "Invoice number", value: "AC-77821", confidence: 0.95,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callInvoice, caseId: caseInvoice,
      type: "amount", label: "Disputed amount", value: "EUR 4,850", confidence: 0.92,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callInvoice, caseId: caseInvoice,
      type: "person_name", label: "Responsible person", value: "Petra Klein", confidence: 0.89,
    });
    await ctx.db.insert("extractedEntities", {
      workspaceId, callId: callInvoice, caseId: caseInvoice,
      type: "next_step", label: "Next payment step", value: "Send purchase order proof", confidence: 0.9,
    });

    // Create action items
    const actionImmigration = await ctx.db.insert("actionItems", {
      workspaceId,
      callId: callImmigration,
      caseId: caseRenewal,
      title: "Upload updated bank statements",
      description: "Upload the latest three months of statements before the May 6 document deadline.",
      dueAt: "2026-05-06T09:00:00+01:00",
      status: "open",
      source: "ai_suggested",
    });

    const actionUniversity = await ctx.db.insert("actionItems", {
      workspaceId,
      callId: callUniversity,
      caseId: caseBackground,
      title: "Send signed candidate consent form",
      description: "Email the signed consent form to the university registry for official date release.",
      dueAt: "2026-05-02T11:00:00+01:00",
      status: "open",
      source: "ai_suggested",
    });

    const actionInsurance = await ctx.db.insert("actionItems", {
      workspaceId,
      callId: callInsurance,
      caseId: caseSponsor,
      title: "Send sponsor pack to Lena Ortiz",
      description: "Include audience demographics, panel options, and mid-tier package pricing.",
      dueAt: "2026-05-03T16:30:00+01:00",
      status: "in_progress",
      source: "ai_suggested",
    });

    const actionInvoice = await ctx.db.insert("actionItems", {
      workspaceId,
      callId: callInvoice,
      caseId: caseInvoice,
      title: "Send purchase order proof",
      description: "Send PO proof to Petra Klein so Alpine can release the payment next step.",
      dueAt: "2026-05-01T12:00:00+01:00",
      status: "open",
      source: "ai_suggested",
    });

    // Patch cases and contacts with relationships
    await ctx.db.patch(caseRenewal, {
      callIds: [callImmigration],
      contactIds: [contactImmigration],
      unresolvedActionItemIds: [actionImmigration],
    });
    await ctx.db.patch(caseBackground, {
      callIds: [callUniversity],
      contactIds: [contactUniversity],
      unresolvedActionItemIds: [actionUniversity],
    });
    await ctx.db.patch(caseSponsor, {
      callIds: [callInsurance],
      contactIds: [contactInsurance],
      unresolvedActionItemIds: [actionInsurance],
    });
    await ctx.db.patch(caseInvoice, {
      callIds: [callInvoice],
      contactIds: [contactSupplier],
      unresolvedActionItemIds: [actionInvoice],
    });

    await ctx.db.patch(contactImmigration, { relatedCaseIds: [caseRenewal] });
    await ctx.db.patch(contactUniversity, { relatedCaseIds: [caseBackground] });
    await ctx.db.patch(contactInsurance, { relatedCaseIds: [caseSponsor] });
    await ctx.db.patch(contactSupplier, { relatedCaseIds: [caseInvoice] });

    // Create reminders
    await ctx.db.insert("reminders", {
      workspaceId,
      callId: callImmigration,
      caseId: caseRenewal,
      contactId: contactImmigration,
      title: "Confirm D7 renewal documents were accepted",
      remindAt: "2026-05-06T09:00:00+01:00",
      status: "upcoming",
      source: "ai_suggested",
    });

    await ctx.db.insert("reminders", {
      workspaceId,
      callId: callUniversity,
      caseId: caseBackground,
      contactId: contactUniversity,
      title: "Follow up with university registry",
      remindAt: "2026-05-02T11:00:00+01:00",
      status: "upcoming",
      source: "ai_suggested",
    });

    await ctx.db.insert("reminders", {
      workspaceId,
      callId: callInsurance,
      caseId: caseSponsor,
      contactId: contactInsurance,
      title: "Send Northstar sponsor follow-up",
      remindAt: "2026-05-03T16:30:00+01:00",
      status: "upcoming",
      source: "ai_suggested",
    });

    await ctx.db.insert("reminders", {
      workspaceId,
      callId: callInvoice,
      caseId: caseInvoice,
      contactId: contactSupplier,
      title: "Chase Alpine invoice payment path",
      remindAt: "2026-05-01T12:00:00+01:00",
      status: "overdue",
      source: "ai_suggested",
    });

    await ctx.db.insert("reminders", {
      workspaceId,
      callId: callInsurance,
      caseId: caseSponsor,
      contactId: contactInsurance,
      title: "Completed sponsor prep note",
      remindAt: "2026-04-26T10:00:00+01:00",
      status: "completed",
      source: "mock",
    });

    // Create review suggestions
    await ctx.db.insert("reviewSuggestions", {
      workspaceId,
      callId: callImmigration,
      detectedCallType: "Relocation document check",
      summary:
        "The immigration office confirmed the renewal case is missing updated bank statements and proof of accommodation. If both are uploaded by May 6, the May 14 appointment window can stay in place.",
      confidence: 0.91,
      status: "accepted",
      suggestedExistingCaseId: caseRenewal,
      suggestedExistingContactId: contactImmigration,
      reminderTitle: "Confirm D7 renewal documents were accepted",
      reminderDueAt: "2026-05-06T09:00:00+01:00",
      entitySuggestions: [
        { type: "reference_number", label: "Reference number", value: "SEF-REN-48392", confidence: 0.96 },
        { type: "required_document", label: "Required document", value: "Updated 3-month bank statements", confidence: 0.93 },
        { type: "required_document", label: "Required document", value: "Current proof of accommodation", confidence: 0.9 },
        { type: "appointment_date", label: "Appointment window", value: "May 14, 2026", confidence: 0.85 },
        { type: "due_date", label: "Document deadline", value: "May 6, 2026", confidence: 0.92 },
      ],
      actionItemSuggestions: [
        { title: "Upload updated bank statements", description: "Upload the latest three months of statements before the May 6 document deadline.", dueAt: "2026-05-06T09:00:00+01:00" },
      ],
    });

    await ctx.db.insert("reviewSuggestions", {
      workspaceId,
      callId: callUniversity,
      detectedCallType: "Education verification",
      summary:
        "The registry located Aminah Clarke's MSc record and did not flag an award-title discrepancy. Official attendance dates require a signed consent form.",
      confidence: 0.88,
      status: "accepted",
      suggestedExistingCaseId: caseBackground,
      suggestedExistingContactId: contactUniversity,
      reminderTitle: "Follow up with university registry",
      reminderDueAt: "2026-05-02T11:00:00+01:00",
      entitySuggestions: [
        { type: "person_name", label: "Candidate", value: "Aminah Clarke", confidence: 0.97 },
        { type: "verification_outcome", label: "Degree record", value: "MSc record located", confidence: 0.9 },
        { type: "next_step", label: "Official dates", value: "Release after consent form", confidence: 0.87 },
        { type: "discrepancy", label: "Discrepancy", value: "No award-title discrepancy", confidence: 0.82 },
      ],
      actionItemSuggestions: [
        { title: "Send signed candidate consent form", description: "Email the signed consent form to the university registry for official date release.", dueAt: "2026-05-02T11:00:00+01:00" },
      ],
    });

    await ctx.db.insert("reviewSuggestions", {
      workspaceId,
      callId: callInsurance,
      detectedCallType: "Sponsorship qualification",
      summary:
        "Northstar Insurance is interested in a mid-tier sponsorship if audience demographics and panel opportunities are compelling. Lena Ortiz is the decision maker and asked for a sponsor pack before May 3.",
      confidence: 0.84,
      status: "accepted",
      suggestedExistingCaseId: caseSponsor,
      suggestedExistingContactId: contactInsurance,
      reminderTitle: "Send Northstar sponsor follow-up",
      reminderDueAt: "2026-05-03T16:30:00+01:00",
      entitySuggestions: [
        { type: "decision_maker", label: "Decision maker", value: "Lena Ortiz", confidence: 0.91 },
        { type: "amount", label: "Budget mentioned", value: "$18,000", confidence: 0.86 },
        { type: "interest_level", label: "Interest level", value: "Warm, conditional interest", confidence: 0.78 },
        { type: "next_step", label: "Next step", value: "Email sponsor pack with demographics and panel options", confidence: 0.93 },
      ],
      actionItemSuggestions: [
        { title: "Send sponsor pack to Lena Ortiz", description: "Include audience demographics, panel options, and mid-tier package pricing.", dueAt: "2026-05-03T16:30:00+01:00" },
      ],
    });

    await ctx.db.insert("reviewSuggestions", {
      workspaceId,
      callId: callInvoice,
      detectedCallType: "Invoice dispute",
      summary:
        "Alpine Components confirmed invoice AC-77821 has a disputed balance of EUR 4,850. Petra Klein will recheck the payment path after receiving purchase order proof.",
      confidence: 0.9,
      status: "accepted",
      suggestedExistingCaseId: caseInvoice,
      suggestedExistingContactId: contactSupplier,
      reminderTitle: "Chase Alpine invoice payment path",
      reminderDueAt: "2026-05-01T12:00:00+01:00",
      entitySuggestions: [
        { type: "invoice_number", label: "Invoice number", value: "AC-77821", confidence: 0.95 },
        { type: "amount", label: "Disputed amount", value: "EUR 4,850", confidence: 0.92 },
        { type: "person_name", label: "Responsible person", value: "Petra Klein", confidence: 0.89 },
        { type: "next_step", label: "Next payment step", value: "Send purchase order proof", confidence: 0.9 },
      ],
      actionItemSuggestions: [
        { title: "Send purchase order proof", description: "Send PO proof to Petra Klein so Alpine can release the payment next step.", dueAt: "2026-05-01T12:00:00+01:00" },
      ],
    });

    // Create wallet summary
    await ctx.db.insert("walletSummaries", {
      workspaceId,
      creditBalance: 124,
      currency: "USD",
      usageThisMonth: 38,
      includedMinutes: 120,
      subscriptionStatus: "placeholder",
      planId: "team",
      includedCreditBalanceCents: 7400,
      includedCreditGrantedCents: 10000,
      topUpCreditBalanceCents: 5000,
      reservedCreditCents: 0,
      lifetimeCreditSpendCents: 2600,
      topUpCreditExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      businessInvoiceRequested: false,
      autoTopUpEnabled: false,
      autoTopUpThresholdCents: 1000,
      autoTopUpAmountCents: 2500,
      freeCallUsed: false,
      aiFeaturesEnabled: true,
    });

    // Create demo settings
    await ctx.db.insert("demoSettings", {
      workspaceId,
      showDemoHints: true,
    });

    return { workspaceId, alreadySeeded: false };
  },
});

export const resetDemoData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const workspaceId = await requireWorkspace(ctx);

    const contacts = await ctx.db.query("contacts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const r of contacts) await ctx.db.delete(r._id);

    const cases = await ctx.db.query("cases").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const r of cases) await ctx.db.delete(r._id);

    const calls = await ctx.db.query("calls").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const r of calls) await ctx.db.delete(r._id);

    const transcripts = await ctx.db.query("transcripts").collect();
    const callsWithTranscript = calls.map(c => c._id);
    for (const r of transcripts) {
      if (callsWithTranscript.includes(r.callId)) await ctx.db.delete(r._id);
    }

    const aiMemories = await ctx.db.query("aiMemories").collect();
    for (const r of aiMemories) {
      if (callsWithTranscript.includes(r.callId)) await ctx.db.delete(r._id);
    }

    const extractedEntities = await ctx.db.query("extractedEntities").collect();
    for (const r of extractedEntities) {
      if (callsWithTranscript.includes(r.callId)) await ctx.db.delete(r._id);
    }

    const actionItems = await ctx.db.query("actionItems").withIndex("by_status", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const r of actionItems) await ctx.db.delete(r._id);

    const reminders = await ctx.db.query("reminders").withIndex("by_status", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const r of reminders) await ctx.db.delete(r._id);

    const reviewSuggestions = await ctx.db.query("reviewSuggestions").collect();
    for (const r of reviewSuggestions) {
      if (callsWithTranscript.includes(r.callId)) await ctx.db.delete(r._id);
    }

    const walletSummaries = await ctx.db.query("walletSummaries").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const r of walletSummaries) await ctx.db.delete(r._id);

    const demoSettings = await ctx.db.query("demoSettings").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).collect();
    for (const r of demoSettings) await ctx.db.delete(r._id);

    return { reset: true, workspaceId };
  },
});
