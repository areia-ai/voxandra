import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";
import { getPublicVoiceTranslationLanguageNames } from "@/lib/live-translation-languages";
import { OPEN_SOURCE_REPO_URL } from "@/lib/open-source";

const repoLabel = OPEN_SOURCE_REPO_URL.replace("https://", "");

export interface FAQItem { id: string; question: string; answer: string; }

// One source for server-rendered answers and FAQPage JSON-LD.
export const faqItems: FAQItem[] = [
  { id: "what-is-voxandra", question: "What is Voxandra?", answer: "Voxandra is an AI platform for multilingual business calls. It translates both sides of live phone conversations, provides private guidance while people talk, and turns each call into a reviewed Call Record." },
  { id: "recipient-experience", question: "Does the other person need an app?", answer: "No. You call from your browser; they answer a normal phone call. Both people hear a spoken notice before translation starts. Each hears the other person translated into their chosen language." },
  { id: "after-cta", question: "How does the free trial work?", answer: publicTranslatedTrialEnabled()
    ? "Sign in, choose both languages, and try one free 90-second translated call per eligible workspace. No card, subscription, or SMS verification. Setup and the spoken introduction count toward the limit. Starting the provider call uses the trial, including busy or unanswered calls. Live Guidance is not included."
    : "Sign in to try one free 90-second standard call. Choose a paid plan for translated calls and Live Guidance. The person you call needs no app." },
  { id: "live-translation", question: "Which languages can we speak?", answer: `Both sides hear spoken translation. Choose either language before calling: ${getPublicVoiceTranslationLanguageNames()}. Language selection is explicit; translated calls do not use automatic detection.` },
  { id: "live-guidance", question: "What does Live Guidance do?", answer: "It privately suggests questions and flags details to confirm while you talk, such as a missing date or reference number. Only you see the prompts. Monthly Guidance minutes are included on every paid plan." },
  { id: "mid-call-fallback", question: "What if translation has a problem?", answer: "If translation cannot start, the call ends. During a conversation, Voxandra can fall back to a plain call and mark the translation gaps in the record. Translated calls also have a workspace time limit of 30, 45, or 60 minutes; trials and available credits can shorten it." },
  { id: "ai-accuracy", question: "Can I correct the AI’s notes?", answer: "Yes. Review and correct the transcript, notes, extracted details, and follow-ups before accepting the Call Record. AI can mishear names and numbers; your review controls what becomes part of the team record." },
  { id: "billing", question: "How are translated calls billed?", answer: "The destination rate appears before you dial. Calls have a 60-second minimum and bill by started minute. Every paid plan includes monthly Translation and Guidance minutes. One credit balance covers calls and usage beyond those included minutes. Need more? Buy credits." },
  { id: "credit-expiry", question: "Do credits expire?", answer: "Purchased top-up credits never expire. The credits and minutes included with your plan reset each billing cycle." },
  { id: "subscription-or-credits", question: "Do I need a subscription?", answer: (publicTranslatedTrialEnabled() ? "The free translated trial needs no subscription. " : "The free standard trial needs no subscription. ") + "Afterward, translation, Guidance, and AI Call Records require a paid plan. Standard calls are also available with credits alone. Plans differ by seats and volume, not by which AI features they include." },
  { id: "data-privacy", question: "What happens to my call data?", answer: "Transcripts, notes, and reviewed details stay in your workspace. Transient recordings are deleted after processing; there is no retained audio player or download. You review the AI draft before it updates the shared record." },
  { id: "open-source", question: "Is Voxandra open source?", answer: `Yes. The full source, including the web app, the Convex backend, and the realtime media worker, is public at ${repoLabel} under the GNU Affero General Public License v3.0 (AGPL-3.0). Anyone can read how calls, translation, and Call Records are handled. voxandra.com is the hosted version, with paid plans and prepaid calling credits.` },
  { id: "self-host", question: "Can I run Voxandra myself?", answer: "Yes. You can self-host the whole stack: the Next.js app, the Convex backend, and the realtime media worker, using your own provider accounts. The README on GitHub covers setup. If you run a modified version as a network service, the AGPL requires you to offer its users the source code of your version. The license does not grant rights to the Voxandra name or the brand assets in public/brand." },
  { id: "commitment", question: "Can I cancel?", answer: "Yes. Plans are monthly, with no annual contract. Cancel through the billing portal and keep access until the billing period ends. Purchased top-up credits never expire." },
];
