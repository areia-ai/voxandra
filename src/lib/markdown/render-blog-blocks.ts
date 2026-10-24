import type { BlogBlock } from "@/content/blog/types";

const BASE_URL = "https://voxandra.com";

// Converts a post's typed body blocks straight to Markdown. Blog posts are
// already structured data (src/content/blog/types.ts), not HTML, so this is
// a direct mapping rather than an HTML-to-Markdown conversion.
export function renderBlogBlocksToMarkdown(blocks: BlogBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `## ${block.text}`;
        case "paragraph":
          return block.text;
        case "list":
          return block.items.map((item) => `- ${item}`).join("\n");
        case "quote":
          return block.attribution
            ? `> ${block.text}\n>\n> — ${block.attribution}`
            : `> ${block.text}`;
        case "image":
          return `![${block.alt}](${BASE_URL}${block.src})${
            block.caption ? `\n\n*${block.caption}*` : ""
          }`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n\n");
}
