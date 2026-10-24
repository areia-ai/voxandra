import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexHttpClient } from "@/lib/billing/server";

export const runtime = "nodejs";

// RFC 8058 one-click unsubscribe. Mail clients POST here directly from the
// List-Unsubscribe header without ever showing the recipient a page, so there is
// deliberately no confirmation step and no auth: the token IS the authorization,
// and the Convex mutation derives the profile from it server-side.
//
// This endpoint must never require a session. Someone who signed up, never came
// back, and wants the win-back sequence to stop is not going to log in to do it —
// they will hit "mark as spam" instead, which costs sender reputation on the same
// domain that delivers call records.

async function optOut(token: string | null, optOutValue: boolean) {
  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const secret = process.env.UNSUBSCRIBE_CONVEX_SECRET;
  if (!secret) {
    // Fail closed, and loudly in logs, but do not tell the caller why.
    console.error("UNSUBSCRIBE_CONVEX_SECRET is not configured");
    return NextResponse.json({ error: "Unavailable." }, { status: 503 });
  }

  let matched = false;
  try {
    const convex = getConvexHttpClient();
    const result = await convex.mutation(api.emails.unsubscribeByToken, {
      secret,
      token,
      optOut: optOutValue,
    });
    matched = result.ok;
  } catch {
    return NextResponse.json({ error: "Could not process request." }, { status: 500 });
  }

  // Always HTTP 200 so a mail client's one-click never renders an error, but the
  // body reports whether the token actually matched. That is technically an oracle
  // for token validity — accepted deliberately, because the token is a 108-char
  // triple-UUID that cannot be enumerated, and the alternative is worse: mail
  // clients do truncate long URLs, and telling someone "you're unsubscribed" when
  // they are not means they keep getting mail and reach for the spam button, which
  // is the exact outcome this whole feature exists to prevent.
  return NextResponse.json({ ok: true, matched });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get("token");
  // `resubscribe=1` is the undo on /unsubscribe, not something a mail client sends.
  const optOutValue = url.searchParams.get("resubscribe") !== "1";

  // Some clients send the List-Unsubscribe=One-Click body as a form post rather
  // than relying on the query string; accept either.
  if (!token) {
    const body = await request.formData().catch(() => null);
    const fromBody = body?.get("token");
    if (typeof fromBody === "string") token = fromBody;
  }

  return optOut(token, optOutValue);
}

// GET must have NO side effect. RFC 8058 exists precisely because mail clients,
// link scanners, and corporate security proxies fetch URLs found in email — an
// opt-out on GET would unsubscribe people who never clicked anything. Send humans
// to the page instead, which performs the opt-out from client-side JS that
// scanners do not execute.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const target = new URL("/unsubscribe", url.origin);
  if (token) target.searchParams.set("token", token);
  return NextResponse.redirect(target, 302);
}
