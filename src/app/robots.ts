import type { MetadataRoute } from "next";

const BASE_URL = "https://voxandra.com";

// Authenticated / non-public surface. Everything else is crawlable.
// /markdown/ is the internal rewrite target for Accept: text/markdown
// content negotiation (src/proxy.ts) — the canonical URLs ("/", "/mcp",
// "/blog", "/blog/<slug>") already carry the Markdown variant, so the
// /markdown/* target paths would otherwise be indexable duplicate content.
const PRIVATE_PATHS = ["/app/", "/api/", "/join/", "/markdown/"];

// AI crawlers and agents explicitly allowed, by owner (per each vendor's
// official crawler docs, checked 2026-07):
// - OpenAI: GPTBot (training), OAI-SearchBot (ChatGPT search index — the one
//   that produces citations), ChatGPT-User (user-triggered fetch)
// - Anthropic: ClaudeBot (training), Claude-SearchBot (search index),
//   Claude-User (user-triggered fetch)
// - Perplexity: PerplexityBot (search index), Perplexity-User (user fetch)
// - Google: Google-Extended (Gemini training/grounding opt-in token),
//   GoogleOther (R&D). AI Overviews eligibility rides on plain Googlebot,
//   which the "*" rule already admits.
// - Apple: Applebot (Siri/Spotlight/Apple Intelligence), Applebot-Extended
//   (foundation-model training token)
// - Meta: meta-externalagent (training/index), meta-webindexer (Meta AI
//   search), meta-externalfetcher (user fetch)
// - Others: Amazonbot (Alexa/Nova), CCBot (Common Crawl — feeds many LLM
//   training sets), DuckAssistBot (DuckAssist answers), YouBot (You.com),
//   MistralAI-User (Le Chat user fetch), Bytespider (ByteDance/Doubao)
//
// A named robots group REPLACES the "*" group (no inheritance), so each named
// bot must restate the private-path disallows or it would crawl /app/ etc.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "GoogleOther",
  "Applebot",
  "Applebot-Extended",
  "meta-externalagent",
  "meta-webindexer",
  "meta-externalfetcher",
  "Amazonbot",
  "CCBot",
  "DuckAssistBot",
  "YouBot",
  "MistralAI-User",
  "Bytespider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: AI_CRAWLERS,
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
