import {
  convexAuthNextjsMiddleware,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";
import {
  negotiateHtmlOrMarkdown,
  negotiateRepresentation,
  MARKDOWN_NEGOTIATION_VARY_HEADER,
} from "@/lib/http/markdown-negotiation";

// Public pages with a maintained Markdown counterpart under src/app/markdown/
// (see that directory + acceptmarkdown.com). "/" and "/mcp" map 1:1; "/blog"
// covers both the index and every "/blog/<slug>" post.
function markdownRewriteTarget(pathname: string): string | null {
  if (pathname === "/") return "/markdown/home";
  if (pathname === "/live-voice-translation") return "/markdown/live-voice-translation";
  if (pathname === "/mcp") return "/markdown/mcp";
  if (pathname === "/blog") return "/markdown/blog";
  const blogPostMatch = pathname.match(/^\/blog\/([^/]+)$/);
  if (blogPostMatch) return `/markdown/blog/${blogPostMatch[1]}`;
  return null;
}

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const pathname = request.nextUrl.pathname;

    // Machine-to-machine JSON-RPC alias: many MCP clients try the
    // conventional "/mcp" path by default. The real Streamable HTTP handler
    // lives at /api/mcp (see AGENTS.md); this transparently rewrites so both
    // URLs work without duplicating the handler or its API-key auth. GET
    // "/mcp" (and everything else) still renders the human docs page.
    if (pathname === "/mcp" && request.method === "POST") {
      return NextResponse.rewrite(new URL("/api/mcp", request.url));
    }

    // Agent tooling probes GET /mcp expecting JSON that describes the server.
    // Browsers (and anything asking for HTML) still get the docs page at the
    // same URL; JSON callers get the same SEP-1649 server card published at
    // /.well-known/mcp/server-card.json.
    if (pathname === "/mcp" && request.method === "GET") {
      const representation = negotiateRepresentation(request.headers.get("accept"), [
        "text/html",
        "text/markdown",
        "application/json",
      ]);
      if (representation === "application/json") {
        const rewritten = NextResponse.rewrite(new URL("/markdown/mcp-json", request.url));
        rewritten.headers.set("Vary", MARKDOWN_NEGOTIATION_VARY_HEADER);
        return rewritten;
      }
    }

    // acceptmarkdown.com content negotiation for the pages with a maintained
    // Markdown counterpart. Only GET is negotiated; non-GET requests to these
    // paths (there are none today) fall through untouched.
    const markdownTarget = markdownRewriteTarget(pathname);
    if (markdownTarget && request.method === "GET") {
      const negotiated = negotiateHtmlOrMarkdown(request.headers.get("accept"));
      if (negotiated === "unsupported") {
        return new NextResponse(null, {
          status: 406,
          headers: { Vary: MARKDOWN_NEGOTIATION_VARY_HEADER },
        });
      }
      if (negotiated === "markdown") {
        const rewritten = NextResponse.rewrite(new URL(markdownTarget, request.url));
        rewritten.headers.set("Vary", MARKDOWN_NEGOTIATION_VARY_HEADER);
        return rewritten;
      }
      // negotiated === "html": fall through to the normal page render below,
      // but the response still needs Vary: Accept so caches don't collapse
      // the html/markdown variants together.
    }

    const isAuthenticated = await convexAuth.isAuthenticated();

    // Only redirect authenticated users away from login page
    if (pathname === "/login" && isAuthenticated) {
      return nextjsMiddlewareRedirect(request, "/app");
    }

    // NOTE: We're NOT redirecting unauthenticated users from /app
    // Auth protection is handled client-side in AppShell

    if (markdownTarget) {
      const response = NextResponse.next();
      response.headers.set("Vary", MARKDOWN_NEGOTIATION_VARY_HEADER);
      return response;
    }
  },
  {
    cookieConfig: { maxAge: 60 * 60 * 24 * 30 }, // 30 days
    shouldHandleCode: (request) =>
      !request.nextUrl.pathname.startsWith("/api/auth/"),
  }
);

export const config = {
  // /api/mcp is excluded from BOTH patterns (the first also matches dotless
  // /api paths): MCP clients authenticate with API keys, not Convex Auth
  // cookies.
  matcher: [
    "/((?!api/mcp|.*\\..*|_next).*)",
    "/",
    "/(api|trpc)((?!/mcp).*)",
  ],
};
