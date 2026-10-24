import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signedInRequest = request.headers.get("Authorization")?.startsWith("Bearer ");
  return NextResponse.json({ error: signedInRequest
    ? "SMS verification is no longer required. Refresh the dialer to start your trial."
    : "Sign in to use the free trial." },
  { status: signedInRequest ? 410 : 401, headers: { "Cache-Control": "no-store" } });
}
