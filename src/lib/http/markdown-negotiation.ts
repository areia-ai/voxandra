// RFC 9110 content negotiation between text/html (this site's default
// representation) and text/markdown (the acceptmarkdown.com convention:
// https://acceptmarkdown.com — "serve clean Markdown content from identical
// URLs that provide HTML to browsers"). Pure logic, no framework imports, so
// it runs identically in edge middleware (src/proxy.ts) and Node route
// handlers, and is unit-testable without a DOM/edge runtime.

export type MarkdownNegotiationResult = "html" | "markdown" | "unsupported";

interface MediaRange {
  type: string;
  subtype: string;
  q: number;
  specificity: number;
  index: number;
}

function parseAcceptHeader(header: string): MediaRange[] {
  return header
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const segments = part.split(";").map((segment) => segment.trim());
      const [rawType, rawSubtype] = segments[0].split("/");
      const type = (rawType || "*").toLowerCase();
      const subtype = (rawSubtype || "*").toLowerCase();
      let q = 1;
      for (const param of segments.slice(1)) {
        const [key, value] = param.split("=").map((piece) => piece.trim());
        if (key === "q" && value) {
          const parsed = Number.parseFloat(value);
          if (!Number.isNaN(parsed)) q = parsed;
        }
      }
      const specificity = type === "*" ? 0 : subtype === "*" ? 1 : 2;
      return { type, subtype, q, specificity, index };
    });
}

function bestMatch(
  ranges: MediaRange[],
  target: { type: string; subtype: string }
): MediaRange | null {
  const candidates = ranges.filter(
    (range) =>
      range.q > 0 &&
      (range.type === "*" || range.type === target.type) &&
      (range.subtype === "*" || range.subtype === target.subtype)
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => b.q - a.q || b.specificity - a.specificity || a.index - b.index
  )[0];
}

function splitMediaType(mediaType: string) {
  const [type, subtype] = mediaType.toLowerCase().split("/");
  return { type, subtype: subtype ?? "*" };
}

/**
 * Negotiates a request's Accept header against an ordered list of offered
 * media types. `offers[0]` is the default representation: it wins ties, and
 * it is what a request with no Accept header (or a bare "*\/*") gets.
 *
 * Returns the winning media type, or "unsupported" when the header matches
 * none of the offers — callers should respond 406 in that case, per
 * acceptmarkdown.com's "rejects unsupported types with 406".
 */
export function negotiateRepresentation(
  acceptHeader: string | null | undefined,
  offers: string[]
): string | "unsupported" {
  if (offers.length === 0) return "unsupported";
  if (!acceptHeader || !acceptHeader.trim()) return offers[0];

  const ranges = parseAcceptHeader(acceptHeader);

  // Score every offer, keeping the offers' own order as the tiebreak so the
  // default representation wins a true tie (e.g. a bare "*/*").
  let best: { offer: string; match: MediaRange; order: number } | null = null;
  offers.forEach((offer, order) => {
    const match = bestMatch(ranges, splitMediaType(offer));
    if (!match) return;
    if (
      !best ||
      match.q > best.match.q ||
      (match.q === best.match.q && match.specificity > best.match.specificity)
    ) {
      best = { offer, match, order };
    }
  });

  return best ? (best as { offer: string }).offer : "unsupported";
}

const HTML_MEDIA_TYPE = "text/html";
const MARKDOWN_MEDIA_TYPE = "text/markdown";

/**
 * Negotiates between text/html (the default) and text/markdown. Thin wrapper
 * over negotiateRepresentation, kept as its own name because it is the
 * acceptmarkdown.com-specific case used across the public pages.
 */
export function negotiateHtmlOrMarkdown(
  acceptHeader: string | null | undefined
): MarkdownNegotiationResult {
  const winner = negotiateRepresentation(acceptHeader, [
    HTML_MEDIA_TYPE,
    MARKDOWN_MEDIA_TYPE,
  ]);
  if (winner === "unsupported") return "unsupported";
  return winner === MARKDOWN_MEDIA_TYPE ? "markdown" : "html";
}

export const MARKDOWN_NEGOTIATION_VARY_HEADER = "Accept, Accept-Encoding";
