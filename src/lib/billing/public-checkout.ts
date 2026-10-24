import { createHash, randomBytes } from "crypto";

export const PUBLIC_CHECKOUT_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

export function createPublicCheckoutClaimToken() {
  return randomBytes(32).toString("hex");
}

export function hashPublicCheckoutClaimToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function publicCheckoutSuccessUrl(appUrl: string, claimToken: string) {
  const redirect = `/app/wallet?claimCheckout={CHECKOUT_SESSION_ID}&claimToken=${encodeURIComponent(claimToken)}`;
  const encodedRedirect = encodeURIComponent(redirect).replace(
    "%7BCHECKOUT_SESSION_ID%7D",
    "{CHECKOUT_SESSION_ID}"
  );
  return `${appUrl}/login?redirect=${encodedRedirect}`;
}

export function publicCheckoutCancelUrl(appUrl: string) {
  return `${appUrl}/?checkout=cancelled#pricing`;
}
