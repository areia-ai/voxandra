import { NextResponse } from "next/server";
import { getPostBySlug } from "@/content/blog/posts";
import { renderBlogBlocksToMarkdown } from "@/lib/markdown/render-blog-blocks";
import { MARKDOWN_NEGOTIATION_VARY_HEADER } from "@/lib/http/markdown-negotiation";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

// Reached only via the middleware rewrite for "/blog/[slug]" when Accept:
// text/markdown wins content negotiation (src/proxy.ts). Draft posts still
// render (mirrors src/app/blog/[slug]/page.tsx's dynamicParams behavior for
// local preview) but are never linked or listed anywhere.
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return new NextResponse("# Not Found\n\nThis post does not exist.", {
      status: 404,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Vary: MARKDOWN_NEGOTIATION_VARY_HEADER,
      },
    });
  }

  const lines = [
    `# ${post.title}`,
    "",
    `*By ${post.author} · Published ${post.publishedDate}${
      post.updatedDate ? ` · Updated ${post.updatedDate}` : ""
    }*`,
    "",
    renderBlogBlocksToMarkdown(post.body),
  ];

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: MARKDOWN_NEGOTIATION_VARY_HEADER,
    },
  });
}
