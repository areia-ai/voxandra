import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getServerConvexClient, getServerEnv } from "@/lib/server/convex-http";

export const runtime = "nodejs";

function bearerToken(request: Request) {
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

export async function GET(request: Request) {
  const secret = getServerEnv("LAUNCH_INTEREST_CONVEX_SECRET");
  if (bearerToken(request) !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status");
  const status =
    requestedStatus === "unsubscribed" || requestedStatus === "blocked"
      ? requestedStatus
      : "active";

  const convex = getServerConvexClient();
  const csv = await convex.query(api.launchInterest.exportCsv, {
    secret,
    status,
  });

  return new Response(csv, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="voxandra-launch-interest-${status}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
