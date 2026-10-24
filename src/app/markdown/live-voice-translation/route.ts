import { getPublicVoiceTranslationLanguageNames } from "@/lib/live-translation-languages";
import { NextResponse } from "next/server";
import { MARKDOWN_NEGOTIATION_VARY_HEADER } from "@/lib/http/markdown-negotiation";

const content = `# Live Voice Translation for Business Calls

Voxandra translates both sides of a live phone conversation aloud. You speak your language, the person you called hears theirs, and nobody has to switch apps or join a meeting link.

## How it works

1. Call the other person's normal phone number.
2. Choose the language you speak and the language they speak.
3. Voxandra plays a spoken AI-translation disclosure before conversation begins.
4. Each side speaks naturally and hears the other side translated.
5. Private Live Guidance can flag missing dates, commitments, identifiers, and next steps.
6. Voxandra creates a reviewed bilingual Call Record after the call.

## Call Record

The Call Record contains the original and translated transcript, AI note, extracted details, reminders, contacts, and work-thread context. Raw audio is used only for transient processing and is deleted; Voxandra exposes no customer audio player or download.

## Available languages

${getPublicVoiceTranslationLanguageNames()}.

[Start a translated call](https://voxandra.com/login?redirect=/app/dialer)
`;

export async function GET() {
  return new NextResponse(content, { headers: { "Content-Type": "text/markdown; charset=utf-8", Vary: MARKDOWN_NEGOTIATION_VARY_HEADER } });
}
