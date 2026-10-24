import { NextResponse } from "next/server";
import { negotiateHtmlOrMarkdown, MARKDOWN_NEGOTIATION_VARY_HEADER } from "@/lib/http/markdown-negotiation";

// Catch-all for every path that matches no real route (page.tsx or route.ts)
// anywhere else in the tree — Next.js only reaches this when nothing more
// specific matched, so it never shadows a real page. This exists instead of
// relying on the default not-found flow so a genuinely nonexistent URL gets
// a real 404 status with a body agents can act on: for Accept: text/markdown
// (see acceptmarkdown.com and src/lib/http/markdown-negotiation.ts), a short
// Markdown body pointing at the sitemap, llms.txt, and docs; for everything
// else, a branded HTML page with the same links. notFound() calls from
// inside an actually-matched route (e.g. /blog/[slug] for an unknown slug)
// go to src/app/not-found.tsx instead, not here.
const BASE_URL = "https://voxandra.com";

const RECOVERY_LINKS = [
  { href: `${BASE_URL}/`, label: "Homepage" },
  { href: `${BASE_URL}/sitemap.xml`, label: "Sitemap" },
  { href: `${BASE_URL}/llms.txt`, label: "llms.txt (agent-readable site summary)" },
  { href: `${BASE_URL}/blog`, label: "Blog" },
  { href: `${BASE_URL}/mcp`, label: "MCP server docs" },
];

function buildMarkdownBody(pathname: string): string {
  const lines = [
    "# 404 — Page Not Found",
    "",
    `\`${pathname}\` does not exist on voxandra.com.`,
    "",
    "Try one of these instead:",
    "",
    ...RECOVERY_LINKS.map((link) => `- [${link.label}](${link.href})`),
    "",
  ];
  return lines.join("\n");
}

function buildHtmlBody(pathname: string): string {
  const linkItems = RECOVERY_LINKS.map(
    (link) => `<li><a href="${link.href}">${link.label}</a></li>`
  ).join("\n          ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>404 — Page Not Found | Voxandra</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #faf8f4;
        color: #1c1917;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      }
      main {
        max-width: 36rem;
        padding: 2.5rem;
        text-align: center;
      }
      h1 {
        font-size: 1.75rem;
        margin: 0 0 0.75rem;
      }
      p {
        color: #57534e;
        line-height: 1.6;
      }
      code {
        background: #f5f0e8;
        padding: 0.1rem 0.4rem;
        border-radius: 0.25rem;
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 1.75rem 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1.25rem;
        justify-content: center;
      }
      a {
        color: #6d28d9;
        text-decoration: none;
        font-weight: 600;
      }
      a:hover {
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>404 — Page Not Found</h1>
      <p><code>${pathname}</code> does not exist on voxandra.com.</p>
      <ul>
          ${linkItems}
      </ul>
    </main>
  </body>
</html>
`;
}

function respond(request: Request): NextResponse {
  const pathname = new URL(request.url).pathname;
  const negotiated = negotiateHtmlOrMarkdown(request.headers.get("accept"));

  if (negotiated === "unsupported") {
    return new NextResponse(null, {
      status: 406,
      headers: { Vary: MARKDOWN_NEGOTIATION_VARY_HEADER },
    });
  }

  if (negotiated === "markdown") {
    return new NextResponse(buildMarkdownBody(pathname), {
      status: 404,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        Vary: MARKDOWN_NEGOTIATION_VARY_HEADER,
      },
    });
  }

  return new NextResponse(buildHtmlBody(pathname), {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Vary: MARKDOWN_NEGOTIATION_VARY_HEADER,
    },
  });
}

export async function GET(request: Request) {
  return respond(request);
}

export async function HEAD(request: Request) {
  const response = respond(request);
  return new NextResponse(null, { status: response.status, headers: response.headers });
}

export async function POST(request: Request) {
  return respond(request);
}
