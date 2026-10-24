import { getPublicVoiceTranslationLanguageNames } from "@/lib/live-translation-languages";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { MARKDOWN_NEGOTIATION_VARY_HEADER } from "@/lib/http/markdown-negotiation";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";

// Reached only via the middleware rewrite for "/" when Accept: text/markdown
// wins content negotiation (src/proxy.ts). Reuses public/llms.txt as the
// single source of truth for the homepage's agent-facing summary instead of
// maintaining a second copy.
export async function GET() {
  const content = readFileSync(path.join(process.cwd(), "public", "llms.txt"), "utf8").replace("{{VOICE_TRANSLATION_LANGUAGES}}", getPublicVoiceTranslationLanguageNames() + ".");
  const rendered = publicTranslatedTrialEnabled() ? content.replace(
    "The sign-in-only translated trial remains release-gated pending live acceptance; no SMS verification or separate daily trial budget is required.",
    "Eligible signed-in workspaces can try one free 90-second translated call without SMS verification, a card or a subscription. The limit includes setup and the spoken introduction. Normal supported calling destinations and calling safeguards apply; Live Guidance is not included in the trial."
  ) : content;
  return new NextResponse(rendered, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: MARKDOWN_NEGOTIATION_VARY_HEADER,
    },
  });
}
