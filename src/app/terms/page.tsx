import type { Metadata } from "next";
import { PolicyPage } from "@/components/policies/policy-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using Voxandra, an AI platform for multilingual business calls operated by Areia Labs.",
  alternates: {
    canonical: "/terms",
  },
};

const sections = [
  {
    title: "Agreement",
    paragraphs: [
      "These Terms of Service are an agreement between you and Areia Labs for use of Voxandra. Voxandra is an AI platform for multilingual business calls that provides spoken translation, private live guidance, reviewed Call Records, and follow-up tools.",
      "By creating an account, joining a workspace, or using Voxandra, you agree to these Terms. If you use Voxandra for an organization, you confirm that you are authorized to accept these Terms for that organization.",
    ],
  },
  {
    title: "Accounts and workspaces",
    items: [
      "You are responsible for keeping account credentials secure and for activity in workspaces you administer or use.",
      "Workspace owners and admins are responsible for inviting the right users, assigning roles, managing access, and removing users who should no longer have access.",
      "You must provide accurate account, billing, and contact information and keep it current.",
    ],
  },
  {
    title: "Calling, credits, and paid features",
    paragraphs: [
      "Voxandra browser calls, calling credits, subscriptions, rented calling numbers, Voice Translation, Live Guidance, and route availability may vary by plan, destination, language pair, provider availability, and operational controls.",
      "Calling-credit prices and destination availability may change. Voxandra shows available route pricing before calling where practical. Paid features may require an active subscription, calling-credit balance, or metered credit balance.",
      "Purchased top-up credits do not expire and stay available on the workspace wallet until spent. Calling credits included with a subscription reset each billing cycle and do not roll over. A single credit balance covers call minutes and metered Live Guidance and Live Translation usage beyond the minutes included with a plan. Credits are not transferable between workspaces and are not redeemable for cash.",
      "Payments, invoices, subscriptions, top-ups, and cancellations are handled through Voxandra and its payment provider. Separate written agreements may override these public billing terms.",
    ],
  },
  {
    title: "Customer responsibilities",
    items: [
      "You are responsible for complying with call recording, transcription, telecom, privacy, workplace, consumer-protection, and consent laws that apply to your calls and use of Voxandra.",
      "You must provide any required notices and obtain any required permissions before recording, transcribing, translating, or using AI features on a call.",
      "A spoken AI-translation disclosure does not replace notices, consent, or permissions required by the laws that apply to you, the recipient, or the call destination.",
      "You may not use Voxandra for emergency calling, emergency dispatch, or any situation where failure, delay, or inaccuracy could create immediate harm.",
      "You may not use Voxandra as a substitute for legal, medical, financial, compliance, or other regulated professional advice.",
    ],
  },
  {
    title: "Customer content and AI output",
    paragraphs: [
      "You keep ownership of the content you and your workspace put into Voxandra, including original and translated transcripts, notes, extracted details, contacts, reminders, and user edits. You give Areia Labs the limited permission needed to host, process, translate, transmit, secure, support, and improve Voxandra.",
      "AI-generated notes, extracted details, reminders, contact suggestions, Live Translation, and live guidance may be incomplete, delayed, or inaccurate. A human review is required before relying on outputs or using them as official records.",
    ],
  },
  {
    title: "Acceptable use",
    paragraphs: [
      "Your use of Voxandra must follow the Acceptable Use Policy. We may suspend or restrict accounts, workspaces, calls, numbers, credits, or features when we believe there is legal, security, abuse, platform-integrity, or nonpayment risk.",
    ],
  },
  {
    title: "Service changes and availability",
    paragraphs: [
      "Voxandra is provided as a hosted service and may change over time. We may add, modify, limit, or discontinue features, destinations, plans, or providers. We work to keep Voxandra reliable, but we do not guarantee uninterrupted, error-free, or loss-free service.",
    ],
  },
  {
    title: "Disclaimers and limits",
    paragraphs: [
      "To the maximum extent allowed by law, Voxandra is provided as is and as available, without warranties of merchantability, fitness for a particular purpose, non-infringement, or uninterrupted operation.",
      "To the maximum extent allowed by law, Areia Labs will not be liable for indirect, incidental, special, consequential, exemplary, punitive, or lost-profit damages related to Voxandra. Separate written agreements may provide different liability terms.",
    ],
  },
  {
    title: "Termination",
    paragraphs: [
      "You may stop using Voxandra at any time. We may suspend or terminate access if you violate these Terms, fail to pay amounts owed, create legal or security risk, misuse telephony or AI features, or use Voxandra in a way that may harm customers, providers, or the service.",
    ],
  },
  {
    title: "Governing law",
    paragraphs: [
      "These Terms are governed by the laws of Portugal, unless a separate written agreement says otherwise. If a provision cannot be enforced, the remaining provisions will continue to apply.",
    ],
  },
];

export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of Service"
      description="These terms explain the baseline rules for using Voxandra."
      sections={sections}
    />
  );
}
