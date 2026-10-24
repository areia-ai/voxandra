import { NextResponse } from "next/server";
import { getPublishedPosts } from "@/content/blog/posts";
import { MARKDOWN_NEGOTIATION_VARY_HEADER } from "@/lib/http/markdown-negotiation";

const BASE_URL = "https://voxandra.com";

// Reached only via the middleware rewrite for "/blog" when Accept:
// text/markdown wins content negotiation (src/proxy.ts).
function buildBlogIndexMarkdown(): string {
  const posts = getPublishedPosts();
  const lines: string[] = ["# Voxandra Blog", ""];

  for (const post of posts) {
    lines.push(
      `## [${post.title}](${BASE_URL}/blog/${post.slug})`,
      "",
      post.excerpt,
      "",
      `Published ${post.publishedDate}${post.updatedDate ? ` · Updated ${post.updatedDate}` : ""}`,
      ""
    );
  }

  return lines.join("\n");
}

export async function GET() {
  return new NextResponse(buildBlogIndexMarkdown(), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: MARKDOWN_NEGOTIATION_VARY_HEADER,
    },
  });
}
