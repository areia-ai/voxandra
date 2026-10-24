import type { ComparisonPageData } from "../types";

// Sourced from competitors/competitor-profiles.md and competitors/sources.md
// in the voxandra-marketing repo (Microsoft Teams Phone + Copilot section,
// added 2026-07-23). Do not add claims that aren't traceable to a source
// below. Recheck before publish and on the cadence stated here — Teams
// shipped new AI calling capabilities roughly monthly through 2026.
export const microsoftTeamsPhoneComparison: ComparisonPageData = {
  slug: "microsoft-teams-phone",
  competitorName: "Microsoft Teams Phone + Copilot",
  competitorShortName: "Teams Phone",
  lastVerified: "August 23, 2026",
  lastVerifiedISO: "2026-08-23",
  recheckCadence: "rechecked quarterly, sooner given Teams' pace of AI releases",
  metaTitle: "Voxandra vs Microsoft Teams Phone + Copilot",
  metaDescription:
    "How Voxandra compares to Microsoft Teams Phone + Copilot on voice translation, reviewed Call Records, licensing, and recipient requirements. Last verified August 23, 2026.",
  heroKicker: "Comparison",
  heroSubhead:
    "Microsoft's calling platform is deep, distributed, and IT-managed. Voxandra is a self-serve platform for multilingual business calls to normal phone numbers.",
  quickVerdict:
    "Microsoft Teams Phone + Copilot is a cloud calling system inside Microsoft 365, with AI recaps and Interpreter added through Microsoft licensing and administration. Voxandra is built for operational teams that want to call a normal phone number, translate both sides, receive private Guidance, and keep a reviewed bilingual Call Record without a Microsoft tenant rollout.",
  offerIntro:
    "Microsoft Teams Phone + Copilot is the calling spoke of Microsoft 365's collaboration hub, not a standalone AI phone product. Teams Phone provides the cloud PBX and PSTN calling; Microsoft 365 Copilot adds AI features on top — live in-call assistance, real-time translation, and after-call recaps — once an IT admin enables the required licensing and tenant policies.",
  offerItems: [
    {
      title: "Live in-call assistance",
      description:
        "Copilot listens to and transcribes VoIP and PSTN calls without a manual recording step. Users can ask Copilot live questions during the call — for example, \"remind me what the deadline is.\"",
    },
    {
      title: "Real-time voice translation (Interpreter)",
      description:
        "Live speech-to-speech translation on scheduled meetings and 1:1 calls, generating translated audio in the speaker's own cloned voice. Covers 10 languages, with about 20 hours per user per month included on a Copilot license.",
    },
    {
      title: "Intelligent Call Recap",
      description:
        "After the call, Copilot produces AI notes, recommended tasks, speakers, topics, and mentions — confirmed by Microsoft's own documentation to cover PSTN calls, not just Teams-to-Teams meetings.",
    },
    {
      title: "AI call delegation (early access)",
      description:
        "Announced April 2026 through Microsoft's \"Frontier\" early-access program: Copilot can answer incoming calls autonomously, question the caller, judge urgency, and transfer, take a message, or book a follow-up.",
    },
    {
      title: "Voice and face enrollment",
      description:
        "Optional enrollment improves Copilot's accuracy and audio quality in Teams Rooms.",
    },
  ],
  recordingPosture:
    "Intelligent Call Recap requires an IT admin to turn on tenant-wide transcription or recording before it works at all. Calls handled by the AI delegation feature may be recorded by default — flagged by one source as personal data under GDPR. Microsoft's documentation does not describe a human-review or correction step before AI notes become the call record.",
  strongerIntro:
    "Microsoft Teams Phone is stronger on distribution, collaboration breadth, and enterprise administration: it sits inside Microsoft 365 and connects calls with chat, files, calendar, and Planner. These are real advantages for large organizations already committed to Microsoft.",
  strongerPoints: [
    {
      title: "Distribution inside Microsoft 365",
      description:
        "Teams Phone reportedly serves around 26 million users, riding on Teams' existing footprint inside most enterprise Microsoft 365 tenants — no separate rollout needed.",
    },
    {
      title: "Collaboration-hub breadth",
      description:
        "Calls connect to the same chat, files, calendar, and Planner/To Do system your team already uses for everything else.",
    },
    {
      title: "Enterprise procurement and compliance maturity",
      description:
        "Teams ships inside a platform enterprises already vet, budget for, and manage centrally.",
    },
    {
      title: "Voice simulation inside Teams",
      description:
        "Interpreter can simulate the speaker's voice and supports speech interpretation inside Teams meetings and calls. Voxandra uses selectable translated voices and focuses on normal phone-number calling outside a shared meeting environment.",
    },
  ],
  advantageIntro:
    "Voxandra differentiates from Teams Phone on what happens around the call, not on matching its AI feature checklist. The gaps are structural: Teams ships an auto-published recap with no described review step, meeting-shaped notes stretched onto phone calls, and AI features locked behind IT-admin tenant policies. Voxandra is built self-serve, review-first, and phone-native for operational teams outside that buying motion.",
  voxandraAdvantages: [
    {
      title: "A reviewed record, not an auto-published recap",
      description:
        "Teams' Intelligent Call Recap ships straight from AI transcription to the call record, with no described human-review or correction step. Voxandra's draft → correction → trusted-record loop is built for exactly what Teams is weakest on: getting exact reference numbers, amounts, and dates right.",
    },
    {
      title: "Operational extraction, not generic meeting notes",
      description:
        "Teams outputs meeting-shaped artifacts — notes, tasks, topics, mentions, chapters — built for internal meetings and stretched to phone calls. Voxandra extracts workflow-specific facts: deadlines, required documents, commitments, owners, and claim, payment, or onboarding status.",
    },
    {
      title: "Work threads instead of a siloed recap",
      description:
        "Teams' recap lives per call or per chat. Voxandra's work threads carry a single case — a supplier payment, a claim, an onboarding — across every call related to it.",
    },
    {
      title: "A human makes every call, today",
      description:
        "Teams' new call-delegation feature answers and screens calls with a generic, un-trained Copilot. Voxandra's roadmap includes AI agents too — trained by the operator's own calls, learning that team's style from the calls a person already made — but today, a person makes the call and reviews every record before it's trusted.",
    },
    {
      title: "Normal phone-number translation",
      description:
        "Voxandra translates both directions of a call to a normal phone number. The recipient installs nothing, hears a spoken AI-translation disclosure, and receives translated speech in the selected language. Private Guidance and a reviewed bilingual Call Record stay part of the same workflow.",
    },
    {
      title: "Self-serve, no IT admin required",
      description:
        "Teams' AI features are gated behind an IT admin turning on tenant-wide policies, stacked on top of a Teams Phone license, a PSTN calling plan, and Teams Premium or a Copilot add-on. Voxandra is built for teams — supplier ops, claims, verification, relocation agencies — that are frequently running without an IT department managing a Teams admin center.",
    },
  ],
  comparisonRows: [
    {
      dimension: "Call record creation",
      competitor: "AI recap auto-published after the call; no described human-review step",
      voxandra: "AI drafts the record; a team member reviews and corrects it before it's trusted",
    },
    {
      dimension: "What gets extracted",
      competitor: "Meeting-shaped notes: topics, mentions, chapters, recommended tasks",
      voxandra: "Operational facts: deadlines, documents, commitments, owners, case status",
    },
    {
      dimension: "Case continuity",
      competitor: "Siloed per call or chat",
      voxandra: "Work threads carry a case across multiple calls",
    },
    {
      dimension: "Who makes the call",
      competitor: "A human, or (early access) an autonomous Copilot that answers and screens calls",
      voxandra: "A human makes the call today; roadmap includes agents trained by the operator's own calls",
    },
    {
      dimension: "Live translation",
      competitor:
        "Real-time voice dubbing in the speaker's own cloned voice (10 languages, ~20 hrs/user/mo on a Copilot license)",
      voxandra: "Two-way spoken live translation; both sides keep speaking normally",
    },
    {
      dimension: "How you get access",
      competitor: "IT admin enables a tenant-wide policy, on top of stacked licensing",
      voxandra: "Self-serve monthly subscription, no admin console",
    },
    {
      dimension: "Where it lives",
      competitor: "Inside Microsoft 365 — chat, files, calendar, Planner",
      voxandra: "Purpose-built for phone-based operational workflows",
    },
    {
      dimension: "Best fit",
      competitor: "Enterprises already standardized on Microsoft 365 with IT managing rollout",
      voxandra: "Operational teams — supplier ops, claims, onboarding, verification, relocation — without an IT-admin gate",
    },
  ],
  pricingCompetitor: {
    title: "Microsoft Teams Phone + Copilot",
    points: [
      "Requires a base Teams license, plus a Teams Phone license and a PSTN calling plan.",
      "AI features — recap, Interpreter, call delegation — require Teams Premium or a Microsoft 365 Copilot add-on on top of that.",
      "Every AI capability is gated behind an admin turning on a tenant policy; there's no self-serve path to just sign up.",
    ],
    caveat:
      "Third-party pricing round-ups estimate PSTN calling plans around $7–24/user/month and the Copilot add-on around $18–30/user/month, stacked on top of base licensing — not confirmed on Microsoft's own pricing pages.",
  },
  pricingVoxandra: {
    title: "Voxandra",
    points: [
      "Self-serve monthly plans: Solo, Starter, Team, Operations, and custom Enterprise.",
      "No IT admin, tenant policy, or license stacking required to get AI call notes.",
      "Rates vary by destination and are shown before you call.",
    ],
    href: "/#pricing",
    ctaText: "See current pricing",
  },
  missingIntro:
    "Based on Microsoft's own documentation and third-party reporting, three things are missing or unclear from Teams Phone + Copilot as of this page's last verification: cross-call case memory, a described human-review step before AI notes are trusted, and a stated no-raw-audio-retention-by-default posture.",
  missingItems: [
    "Cross-call case memory — no described way to carry context across separate calls the way Voxandra's work threads do.",
    "A described human-review or correction workflow before AI-generated notes become the call record.",
    "A stated no-raw-audio-retention-by-default posture — the opposite is implied, since recording or transcription must be enabled tenant-wide before any AI feature works.",
  ],
  sources: [
    {
      label: "Intelligent Call Recap for calls and meetings — Microsoft Learn (official, updated 2026-05-07)",
      url: "https://learn.microsoft.com/en-us/microsoftteams/intelligent-recap-calls-meetings",
      confidence: "High",
    },
    {
      label: "Interpreter in Microsoft Teams meetings and calls — Microsoft Support (official)",
      url: "https://support.microsoft.com/en-us/teams/copilot/interpreter-in-microsoft-teams-meetings-and-calls",
      confidence: "High",
    },
    {
      label: "Microsoft Teams Phone — official product page",
      url: "https://www.microsoft.com/en-us/microsoft-teams/microsoft-teams-phone",
      confidence: "High",
    },
    {
      label: "Microsoft revamps Teams Phone with AI call delegation — VoIP Review (third-party, early-access feature)",
      url: "https://voip.review/2026/05/06/microsoft-revamps-teams-phone-ai-call-delegation/",
      confidence: "Medium",
    },
    {
      label: "Teams Phone reaches 26 million users — Pure IP (third-party)",
      url: "https://www.pure-ip.com/blog/teams-phone-reaches-26-million-users-and-shows-no-signs-of-slowing",
      confidence: "Medium",
    },
    {
      label: "Microsoft Copilot cost per user — Copilot Experts (third-party pricing round-up)",
      url: "https://copilot-experts.com/microsoft-copilot-cost-per-user/",
      confidence: "Low",
    },
    {
      label: "Microsoft Teams pricing — Secumeet (third-party pricing round-up)",
      url: "https://secumeet.com/reviews/microsoft-teams-pricing",
      confidence: "Low",
    },
  ],
};
