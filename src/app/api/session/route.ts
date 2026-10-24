import { convexAuthNextjsToken, isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

// Lets static public pages ask whether the visitor has a live session, and
// hand the PostHog identity bridge the same coarse, internal-ID-only payload
// the in-app bridge derives, without rendering them through the auth provider.
export async function GET() {
  if (!(await isAuthenticatedNextjs())) return Response.json({ authenticated: false }, NO_STORE);
  const token = await convexAuthNextjsToken();
  try {
    const profile = await fetchQuery(api.profiles.getMyProfile, {}, { token });
    if (!profile) return Response.json({ authenticated: true, identity: null }, NO_STORE);
    const [workspace, wallet] = await Promise.all([
      fetchQuery(api.profiles.getMyWorkspace, {}, { token }),
      fetchQuery(api.walletSummaries.getWalletSummary, {}, { token }),
    ]);
    if (!workspace) return Response.json({ authenticated: true, identity: null }, NO_STORE);
    return Response.json(
      {
        authenticated: true,
        identity: {
          profileId: profile._id,
          workspaceId: workspace._id,
          planId: wallet?.planId ?? workspace.plan ?? "free",
          subscriptionStatus: wallet?.subscriptionStatus ?? "free",
        },
      },
      NO_STORE
    );
  } catch {
    return Response.json({ authenticated: true, identity: null }, NO_STORE);
  }
}
