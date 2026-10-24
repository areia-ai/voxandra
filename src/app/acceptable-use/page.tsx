import type { Metadata } from "next";
import { PolicyPage } from "@/components/policies/policy-page";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description:
    "Rules for responsible use of Voxandra calling, voice translation, transcription, guidance, and workspace features.",
  alternates: {
    canonical: "/acceptable-use",
  },
};

const sections = [
  {
    title: "Purpose",
    paragraphs: [
      "This Acceptable Use Policy explains what is not allowed on Voxandra. It applies to all accounts, workspaces, calls, numbers, credits, transcripts, AI outputs, contacts, reminders, and related use of the service.",
    ],
  },
  {
    title: "Illegal, abusive, or deceptive use",
    items: [
      "Do not use Voxandra for illegal activity, fraud, scams, phishing, deception, impersonation, harassment, threats, exploitation, or abuse.",
      "Do not use Voxandra to send spam, make unlawful robocalls, conduct deceptive outreach, evade caller identity rules, or violate do-not-call, telemarketing, consent, or telecom requirements.",
      "Do not use Voxandra to record, transcribe, translate, monitor, or process calls without required notices, permissions, or legal authority.",
    ],
  },
  {
    title: "Sensitive and high-risk use",
    items: [
      "Do not use Voxandra for emergency calls, emergency dispatch, or urgent situations where a failed or delayed call could cause immediate harm.",
      "Do not use Voxandra to make automated or high-impact decisions about employment, credit, housing, insurance, healthcare, education, legal status, or access to essential services.",
      "Do not upload unnecessary highly sensitive data into notes, transcripts, contacts, reminders, or work threads, including credentials, secrets, government identifiers, health records, financial account details, or children's data.",
    ],
  },
  {
    title: "Security and platform integrity",
    items: [
      "Do not attempt to bypass authentication, authorization, workspace roles, billing, route controls, rate limits, feature limits, or security protections.",
      "Do not interfere with Voxandra, its providers, or other customers, including through scraping, load testing, reverse engineering, malware, credential stuffing, or unauthorized access attempts.",
      "Do not resell, sublicense, or provide shared access to Voxandra in a way that avoids plan limits or creates provider, security, or compliance risk.",
    ],
  },
  {
    title: "Responsible AI and call records",
    items: [
      "Review AI-generated notes, extracted details, reminders, contact suggestions, Live Translation, and live guidance before relying on them.",
      "Do not present AI output as verified fact when it has not been reviewed by an authorized person.",
      "Do not use Voxandra to mislead a call participant about who is calling, why the call is happening, or whether the call is being recorded, transcribed, translated, or processed with AI.",
    ],
  },
  {
    title: "Enforcement",
    paragraphs: [
      "Areia Labs may investigate suspected violations and may suspend, restrict, or terminate accounts, workspaces, calls, numbers, credits, or features when use creates legal, security, abuse, provider, or platform-integrity risk.",
      "We may also remove content, block destinations, require additional review, contact workspace admins, or cooperate with providers and authorities where appropriate.",
    ],
  },
  {
    title: "Reporting concerns",
    paragraphs: [
      "To report abuse, security concerns, or policy questions, contact Areia Labs at contact@voxandra.com.",
    ],
  },
];

export default function AcceptableUsePage() {
  return (
    <PolicyPage
      title="Acceptable Use Policy"
      description="These rules help keep Voxandra useful, lawful, and trustworthy for teams and call participants."
      sections={sections}
    />
  );
}
