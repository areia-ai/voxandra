import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import {
  getServerConvexClient,
  getServerEnv,
} from "@/lib/server/convex-http";
import { buildVoxandraMcpServer, hashApiKey } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function getBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Missing or invalid API key" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="Voxandra MCP", error="invalid_token"',
      },
    }
  );
}

function methodNotAllowedResponse() {
  return NextResponse.json(
    { error: "Method not allowed. The Voxandra MCP server accepts POST only." },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export async function POST(request: Request) {
  try {
    const token = getBearerToken(request);
    if (!token || !token.startsWith("vx_")) {
      return unauthorizedResponse();
    }
    const keyHash = hashApiKey(token);
    const secret = getServerEnv("MCP_CONVEX_SECRET");
    const convex = getServerConvexClient();

    try {
      const usage = await convex.mutation(api.mcp.touchApiKeyUsage, {
        secret,
        keyHash,
      });
      if (!usage.ok) {
        return NextResponse.json(
          { error: "Rate limit exceeded" },
          {
            status: 429,
            headers: { "Retry-After": String(usage.retryAfterSeconds ?? 60) },
          }
        );
      }
    } catch (caught) {
      if (caught instanceof ConvexError) {
        return unauthorizedResponse();
      }
      throw caught;
    }

    const server = buildVoxandraMcpServer({ convex, secret, keyHash });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET() {
  return methodNotAllowedResponse();
}

export async function DELETE() {
  return methodNotAllowedResponse();
}
