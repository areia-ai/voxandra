import type { Metadata } from "next";
import { PolicyPage } from "@/components/policies/policy-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Areia Labs handles personal information for Voxandra, including call records, billing, support, and security data.",
  alternates: {
    canonical: "/privacy",
  },
};

const sections = [
  {
    title: "Who we are",
    paragraphs: [
      "Voxandra is an AI platform for multilingual business calls operated by Areia Labs. It provides browser calling, spoken translation, private live guidance, transcription, reviewed Call Records, and follow-up tools.",
      "For privacy questions, requests, or concerns, contact Areia Labs at contact@voxandra.com.",
    ],
  },
  {
    title: "Information we collect",
    items: [
      "Account and workspace information, such as names, email addresses, workspace names, roles, invitations, authentication records, and preferences.",
      "Calling information, such as phone numbers, caller IDs, destination numbers, call status, duration, route information, timestamps, and calling-credit activity.",
      "Call record content, such as transcripts, AI notes, extracted details, action items, reminders, contacts, work threads, user edits, and review status.",
      "Billing and plan information, such as subscription status, credit purchases, invoices, payment processor identifiers, and billing events. We do not store full payment card numbers.",
      "Support and communications, such as messages you send to us, feedback, issue reports, and related contact information.",
      "Product analytics, technical, and security information, such as device, browser, IP address, page and feature usage, log, diagnostic, fraud-prevention, and abuse-prevention data.",
    ],
  },
  {
    title: "How we use information",
    items: [
      "To provide Voxandra, including browser calling, spoken translation, private live guidance, transcription, AI notes, extracted details, reminders, contacts, and work threads.",
      "To authenticate users, manage workspaces, enforce roles and permissions, and keep customer settings current.",
      "To process subscriptions, calling credits, metered features, invoices, refunds, and billing support.",
      "To provide customer support, respond to requests, troubleshoot product issues, and communicate important service updates.",
      "To secure Voxandra, prevent abuse, investigate suspicious activity, enforce policies, and comply with legal obligations.",
      "To improve reliability, usability, and product quality using operational, diagnostic, and product analytics information.",
    ],
  },
  {
    title: "AI, translation, call recording, and transcription",
    paragraphs: [
      "Voxandra is designed for sensitive operational calls. Voice Translation sends live speech to translation providers so each side can hear the selected language. The recipient hears a spoken AI-translation disclosure before translated delivery begins.",
      "Completed calls may be recorded, transcribed, summarized, and processed with AI features so your team can review and keep useful Call Records. For translated calls, Voxandra may create separate transient recordings of the two call legs, then deletes them after transcription. Voxandra does not provide customer playback or download controls for those recordings.",
      "You are responsible for giving any required notices and obtaining any required consents before recording, transcribing, or processing a call. Recording and transcription rules vary by location, call type, and relationship between the parties.",
      "AI-generated notes, extracted details, reminders, and suggestions may be incomplete or inaccurate. Voxandra presents them for human review before your team relies on them as operational records.",
    ],
  },
  {
    title: "Service providers",
    paragraphs: [
      "We use service providers to run Voxandra. These may include hosting and infrastructure providers, authentication and database providers, telephony providers, live speech-translation providers, AI transcription and extraction providers, payment processors, email and support tools, security tools, product analytics tools, and logging or diagnostics providers.",
      "These providers process information only as needed to provide, secure, support, bill, and improve Voxandra, or as required by law.",
    ],
  },
  {
    title: "Selling, sharing, and advertising",
    paragraphs: [
      "Voxandra does not sell personal information. Voxandra does not share personal information for cross-context behavioral advertising. We do not use customer call record content to build advertising profiles.",
    ],
  },
  {
    title: "Retention and deletion",
    paragraphs: [
      "Voxandra stores call metadata, original and translated transcript text, AI notes, extracted details, action items, reminders, contacts, user notes, and related workspace records so your team can use Call Records. Raw audio is not retained by default; transient recordings used for Call Record processing are deleted after transcription.",
      "We retain workspace and call records while they are needed to provide the service, unless they are deleted, the workspace is closed, or a longer period is required for legal, billing, tax, security, dispute, or abuse-prevention purposes.",
    ],
  },
  {
    title: "Your choices and rights",
    paragraphs: [
      "Depending on your location, you may have rights to access, correct, delete, export, restrict, or object to certain processing of your personal information. You may also have the right to withdraw consent where processing is based on consent, and to lodge a complaint with a privacy authority.",
      "California residents may have rights to know, delete, correct, opt out of sale or sharing, limit certain sensitive personal information uses, and avoid discrimination for exercising privacy rights. Voxandra does not sell or share personal information for cross-context behavioral advertising.",
      "To make a request, contact contact@voxandra.com. We may need information to verify your identity and workspace authority before fulfilling a request.",
    ],
  },
  {
    title: "International processing and changes",
    paragraphs: [
      "Voxandra and its service providers may process information in countries where they operate. When required, we use appropriate safeguards for international transfers.",
      "We may update this Privacy Policy as Voxandra changes. If an update materially changes how we handle personal information, we will take reasonable steps to notify customers through the product, by email, or by updating this page.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy Policy"
      description="This policy explains how Areia Labs handles personal information for Voxandra."
      sections={sections}
    />
  );
}
