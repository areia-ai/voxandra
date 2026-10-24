import type { BlogPostData } from "../types";

// Seed/example post used to validate the blog template end-to-end. Kept as
// "draft" on purpose: it exists to prove the pipeline (rendering, metadata,
// JSON-LD, noindex, sitemap exclusion), not as a real published article.
// Flipping this to "published" is Carlos's call, not something to bundle
// into an unrelated change.
export const whatIsACallRecord: BlogPostData = {
  slug: "what-is-a-call-record",
  status: "draft",
  title: "What Is a Call Record, and Why Does It Matter?",
  excerpt:
    "A look at what turns a phone call into something a team can actually use afterward: notes, transcripts, extracted details, and follow-ups.",
  metaTitle: "What Is a Call Record?",
  metaDescription:
    "A call record is what's left after a business call ends: notes, a transcript, extracted details, and follow-ups your team can act on.",
  author: "Voxandra Team",
  publishedDate: "July 20, 2026",
  publishedDateISO: "2026-07-20",
  body: [
    {
      type: "paragraph",
      text: "Most business calls end the same way: the call disconnects, and whatever mattered in it now lives only in someone's memory. A decision was made, a customer mentioned a deadline, a number got quoted — and unless someone stopped to write it down in real time, it's gone the moment the call ends.",
    },
    {
      type: "heading",
      text: "The problem with calls as a format",
    },
    {
      type: "paragraph",
      text: "Email and chat are naturally reviewable — you can scroll back up. A phone call isn't. It's synchronous, spoken, and by default leaves no trace once it's over. That's fine for a quick check-in, but it's a real gap for calls where details, commitments, or numbers get discussed and someone downstream needs to act on them.",
    },
    {
      type: "heading",
      text: "What a call record actually is",
    },
    {
      type: "paragraph",
      text: "A call record is the reviewed output of a call: a transcript of what was said, a summary of what mattered, the specific details that were mentioned, and the follow-ups that came out of it. Instead of a call disappearing into memory, it becomes something a team can search, reference, and hand off.",
    },
    {
      type: "list",
      items: [
        "A transcript — what was actually said, not a paraphrase",
        "Notes — the parts of the call that mattered, surfaced without re-listening",
        "Extracted details — names, dates, numbers, and commitments pulled out of the conversation",
        "Reminders and follow-ups — the next steps a call implied",
        "Contacts and work threads — who was involved and where the conversation continues",
      ],
    },
    {
      type: "heading",
      text: "Where this fits",
    },
    {
      type: "paragraph",
      text: "Voxandra is an AI platform for multilingual business calls. It translates both sides of live phone conversations, provides private guidance while people talk, and turns each call into a reviewed Call Record.",
    },
    {
      type: "paragraph",
      text: "The idea isn't to replace the call — it's to make sure the call isn't the last time anyone can access what was said in it.",
    },
  ],
};
