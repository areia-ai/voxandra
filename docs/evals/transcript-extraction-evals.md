# Transcript Extraction Evaluation Set

This is a developer-only evaluation set for testing and benchmarking Voxandra's AI extraction quality.

**Rules:**
- Do not use real personal data.
- Do not commit real customer transcripts.
- Update expected outputs when the prompt schema changes.
- Run evals against new prompt versions before declaring quality improvements.

---

## Eval 1: Relocation / Immigration

**Transcript:**
> Caller: Hi, I am calling about my visa renewal application. I submitted it three weeks ago and have not received any confirmation.
> Agent: Can I have your application reference?
> Caller: Yes, it is REF-2025-88421.
> Agent: Thank you. We are missing your financial proof and a renewed passport copy. Please email them to visa.docs@gov.example within 10 days.
> Caller: Okay. What is the deadline exactly?
> Agent: 15 May 2025. After that the application may be delayed.
> Caller: And do I need to schedule a biometrics appointment?
> Agent: No, we will send an SMS when it is ready.

**Expected outputs:**
- Detected call type: `relocation_immigration`
- Expected reference: `REF-2025-88421`
- Expected required documents: `financial proof`, `renewed passport copy`
- Expected action items:
  1. Email financial proof and passport copy to visa.docs@gov.example by 15 May 2025
- Expected reminder: Follow up on visa renewal if no SMS by late May 2025
- Expected "do not invent" checks:
  - Do not invent a case officer name (not provided)
  - Do not invent a fee amount (not mentioned)

---

## Eval 2: Background Verification

**Transcript:**
> Caller: This is Maria from VerifyFast. I am calling about candidate ID 7721-A. The education check is complete but the previous employer in Lisbon has not responded.
> Agent: I can confirm employment from Jan 2022 to March 2024. The role was Senior Analyst. Do you need a reference letter?
> Caller: Yes, please. Also, we noticed a discrepancy: the candidate listed a Masters degree but the university only confirms a Bachelors.
> Agent: I will note that. The reference letter will be sent within 48 hours.

**Expected outputs:**
- Detected call type: `background_verification`
- Expected reference: `7721-A`
- Expected required documents: `reference letter`
- Expected action items:
  1. Wait for reference letter within 48 hours
  2. Flag discrepancy: candidate listed Masters, university confirms Bachelors
- Expected reminder: Check for reference letter arrival in 48 hours
- Expected "do not invent" checks:
  - Do not invent candidate full name (only ID provided)
  - Do not invent university name (not provided)

---

## Eval 3: Supplier Invoice Dispute

**Transcript:**
> Caller: I am calling about invoice INV-4491. We were charged for 120 units but only received 90.
> Agent: Let me check. I see the delivery note says 120. Can you send photos of the received pallets?
> Caller: Yes. We also want a credit note for the 30 missing units.
> Agent: I will escalate to logistics. Please send the photos to disputes@supplier.example and reference invoice INV-4491.
> Caller: By when should we expect a response?
> Agent: Usually 3 to 5 business days.

**Expected outputs:**
- Detected call type: `supplier_invoice`
- Expected reference: `INV-4491`
- Expected required documents: `photos of received pallets`
- Expected action items:
  1. Send photos to disputes@supplier.example referencing INV-4491
  2. Wait for logistics escalation response in 3-5 business days
- Expected reminder: Follow up on credit note if no response by end of week
- Expected "do not invent" checks:
  - Do not invent a specific response date (range given: 3-5 business days)
  - Do not invent product name (not provided)

---

## Eval 4: Banking / Admin

**Transcript:**
> Caller: I need to confirm a large transfer to account ending 3391. The amount is 12,500 euros.
> Agent: For security, can you confirm your customer ID and the intended recipient name?
> Caller: Customer ID 998-44-2212. The recipient is Atlantic Logistics GmbH.
> Agent: Thank you. The transfer is flagged for manual review because of the amount. It should clear within 24 hours. You will receive an email confirmation.
> Caller: Is there anything else I need to do?
> Agent: No. If it does not clear by tomorrow 2 PM, call back and quote ticket TK-778122.

**Expected outputs:**
- Detected call type: `banking_finance`
- Expected references: `998-44-2212`, `TK-778122`, account ending `3391`
- Expected amount: `12,500 euros`
- Expected required documents: none explicitly requested
- Expected action items:
  1. Monitor transfer clearance within 24 hours
  2. Call back quoting TK-778122 if not cleared by tomorrow 2 PM
- Expected reminder: Check transfer status by tomorrow 2 PM
- Expected "do not invent" checks:
  - Do not invent recipient account full number (only ending digits provided)
  - Do not provide financial advice about exchange rates or fees

---

## Eval 5: B2B Sponsorship

**Transcript:**
> Caller: I am reaching out from TechMagazine about sponsorship for the Lisbon Dev Summit.
> Agent: We are interested. What packages do you have?
> Caller: Silver is 8,000 euros, Gold is 15,000. Gold includes a keynote slot and a booth.
> Agent: Can you send the contract and media kit?
> Caller: Yes, to partnerships@techmag.example. We need a decision by 30 June to lock in early-bird pricing.
> Agent: I will discuss with the team and get back to you by next Friday.

**Expected outputs:**
- Detected call type: `b2b_sales`
- Expected references: `Lisbon Dev Summit`
- Expected amounts: `Silver 8,000 euros`, `Gold 15,000 euros`
- Expected required documents: `contract`, `media kit`
- Expected action items:
  1. Send contract and media kit to partnerships@techmag.example
  2. Internal team discussion and decision by next Friday
  3. Final decision deadline: 30 June for early-bird pricing
- Expected reminder: Follow up by next Friday; final decision by 30 June
- Expected "do not invent" checks:
  - Do not invent attendee numbers or ROI estimates (not provided)
  - Do not invent agent name (not provided)

---

## Eval 6: Generic Unclear Call

**Transcript:**
> Caller: Hey, I called earlier about the thing. You said someone would call me back.
> Agent: I do not have a record of that. Can you tell me what department?
> Caller: I think it was about a delivery. Or maybe a refund. I am not sure.
> Agent: Do you have an order number or reference?
> Caller: No. I lost the email.
> Agent: If you can find the email or give us the phone number you used to place the order, we can look it up.

**Expected outputs:**
- Detected call type: `generic`
- Expected references: none
- Expected required documents: `original order email` or `phone number used to place order`
- Expected action items:
  1. Find original email or provide phone number used for order lookup
- Expected reminder: none specific
- Expected "do not invent" checks:
  - Do not invent an order number
  - Do not invent a delivery date
  - Do not invent a refund amount
  - Keep confidence low due to ambiguity

---

## Eval 7: Call Center / Customer Support (Participant Roles)

**Transcript:**
> Agent: Thank you for calling Nissan map update support. My name is Lauren. How may I help you today?
> Caller: Hi Lauren, this is John Smith. I ordered a map update for my Nissan last week and I have not received the activation code.
> Agent: I can look that up. Can I have your vehicle VIN and the order number?
> Caller: Sure. VIN is 1N4AL3AP7DC123456 and order number is NMUPD-77821.
> Agent: Thank you. I see the order is pending because the payment method on file was declined. I can retry the charge or you can update the card.
> Caller: Please retry the charge. It should go through now.
> Agent: I have retried it. You should receive the activation code by email within two hours. If you do not see it, check your spam folder and call us back.
> Caller: Okay. And if it does not arrive?
> Agent: Call back and quote reference NMUPD-77821. I will be here until 5 PM today.

**Expected outputs:**
- Detected call type: `generic` or `customer_support`
- Expected participant roles:
  - caller: John Smith (roleLabel: `customer` or `caller`)
  - representative: Lauren (roleLabel: `support_rep` or `agent`)
  - institution: Nissan map update support (type: `customer_support`)
  - subject: John Smith (subjectType: `customer`)
- Expected references: `NMUPD-77821`, VIN `1N4AL3AP7DC123456`
- Expected action items:
  1. Wait for activation code email within two hours
  2. Check spam folder if email not received
  3. Call back quoting NMUPD-77821 if still missing
- Expected reminder: Follow up on activation code if not received within two hours
- Expected case title should mention John Smith and map update
- Expected "do not invent" checks:
  - Do not suggest John Smith as the contact/institution (he is the caller/customer)
  - Do not suggest Lauren as the contact/institution (she is the representative)
  - Institution/contact should be "Nissan map update support"
  - Action items should NOT be assigned to Lauren by default
  - Action items should be phrased around the operational next step (e.g., "Wait for Nissan to send activation code" not "Follow up with Lauren")

---

## Eval 8: Same Thread vs New Thread

**Existing thread context:**
- Thread ID: `thread_visa_sofia`
- Title: `Residence permit renewal for Sofia Mendes`
- Client: `Sofia Mendes`
- Summary: `Renewal is waiting on bank statements and proof of accommodation before the appointment can be confirmed.`

**Transcript:**
> Caller: Hi, I am calling again about Sofia Mendes and renewal reference SEF-REN-48392.
> Agent: Yes, I can see the file. We received the bank statements yesterday, but the proof of accommodation is still missing.
> Caller: Does that change the May 14 appointment?
> Agent: We can still hold it if the accommodation proof arrives by May 6.

**Expected outputs:**
- Detected call type: `relocation_immigration`
- Expected suggested existing thread: `thread_visa_sofia`
- Expected new thread title: none
- Expected reference: `SEF-REN-48392`
- Expected required document: `proof of accommodation`
- Expected action item:
  1. Send proof of accommodation by May 6 to keep the May 14 appointment
- Expected "do not invent" checks:
  - Do not create a new thread when the reference and person match the existing renewal thread
  - Do not mark bank statements as still missing

---

## Eval 9: New Thread Needed

**Existing thread context:**
- Thread ID: `thread_visa_sofia`
- Title: `Residence permit renewal for Sofia Mendes`
- Client: `Sofia Mendes`
- Summary: `Renewal is waiting on bank statements and proof of accommodation before the appointment can be confirmed.`

**Transcript:**
> Caller: I am calling about a new citizenship appointment for Daniel Ramos.
> Agent: The appointment reference is CIT-99310. He needs a criminal record certificate and translated birth certificate before the appointment.
> Caller: Is this connected to Sofia Mendes's residence renewal?
> Agent: No, this is a separate citizenship file.

**Expected outputs:**
- Detected call type: `relocation_immigration`
- Expected suggested existing thread: none
- Expected new thread title: `Citizenship appointment for Daniel Ramos` or equivalent
- Expected references: `CIT-99310`
- Expected required documents: `criminal record certificate`, `translated birth certificate`
- Expected "do not invent" checks:
  - Do not attach this call to Sofia Mendes's renewal thread
  - Do not treat Daniel Ramos as the institution/contact

---

## Running Evals

### Option A: Manual review
1. Paste each transcript into `/app/import`.
2. Compare AI output against expected outputs above.
3. Record pass/fail per field in this document.

### Option B: Scripted (future)
If a local script or Convex action test runner is added:
- Read this markdown file.
- Extract transcript blocks.
- Call the extraction action or local prompt code.
- Assert presence/absence of expected fields.
- Print a summary report.
