import Google from "@auth/core/providers/google";
import { Email } from "@convex-dev/auth/providers/Email";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { escapeHtml, sendTransactionalEmail } from "./emailSender";

function normalizePasswordEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

function passwordProfile(params: Record<string, unknown>) {
  const email = normalizePasswordEmail(params.email);
  const displayName = typeof params.displayName === "string" ? params.displayName.trim() : "";
  return {
    email,
    name: displayName || email,
  };
}

function authCodeEmail(purpose: "verify" | "reset") {
  return Email({
    id: purpose === "reset" ? "password-reset" : "password-verification",
    maxAge: 60 * 60,
    authorize: async (params, account) => {
      const email = normalizePasswordEmail(params.email);
      if (account.providerAccountId !== email) {
        throw new Error("This code does not match that email address.");
      }
    },
    sendVerificationRequest: async ({ identifier, token, expires, provider }) => {
      const escapedCode = escapeHtml(token);
      const escapedExpiry = escapeHtml(expires.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }));
      const subject =
        purpose === "reset"
          ? "Reset your Voxandra password"
          : "Verify your Voxandra email";
      const intro =
        purpose === "reset"
          ? "Use this code to reset your Voxandra password."
          : "Use this code to finish signing in to Voxandra.";

      const result = await sendTransactionalEmail({
        to: identifier,
        subject,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;background:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="margin-bottom:24px;font-size:24px;font-weight:700;color:#3b1676;">Voxandra</div>
    <div style="border:1px solid #e7e5e4;background:#ffffff;border-radius:12px;padding:28px;">
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#1c1917;">${escapeHtml(subject)}</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#57534e;">${escapeHtml(intro)}</p>
      <div style="margin:0 0 18px;border-radius:10px;background:#f5f3ff;padding:18px;text-align:center;">
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:0.08em;color:#3b1676;word-break:break-all;">${escapedCode}</div>
      </div>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#78716c;">
        This code expires at ${escapedExpiry} UTC. If you did not request it, you can ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`,
      });

      if (!result) {
        console.log("Resend not configured, skipping auth email", {
          provider: provider.id,
        });
      }
    },
  });
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google,
    Password({
      profile: passwordProfile,
      reset: authCodeEmail("reset"),
      verify: authCodeEmail("verify"),
    }),
  ],
});
