"use client";

export type SessionIdentity = {
  profileId: string;
  workspaceId: string;
  planId: string;
  subscriptionStatus: string;
};

export type SessionState = {
  authenticated: boolean;
  identity: SessionIdentity | null;
};

// The auth session lives in httpOnly cookies JS cannot read. The Next auth
// client also mirrors the JWT into localStorage under
// `__convexAuthJWT_<NEXT_PUBLIC_CONVEX_URL stripped of non-alphanumerics>`,
// which we use only as a hint to skip the request for visitors who never
// signed in. `/api/session` is the source of truth, and a wrong hint just
// degrades to the signed-out header — `/login` redirects live sessions to
// `/app` anyway.
export function hasSignedInHint(): boolean {
  const namespace = (process.env.NEXT_PUBLIC_CONVEX_URL ?? "").replace(
    /[^a-zA-Z0-9]/g,
    ""
  );
  try {
    return Boolean(window.localStorage.getItem(`__convexAuthJWT_${namespace}`));
  } catch {
    return false;
  }
}

const SESSION_CACHE_MS = 30_000;
let sessionPromise: Promise<SessionState | null> | null = null;
let sessionFetchedAt = 0;

// Shared by the landing header and the identity bridge so one page load makes
// one request; the short cache keeps a client-side navigation back to the
// landing after signing in from reading a stale signed-out answer.
export function fetchSessionState(): Promise<SessionState | null> {
  const now = Date.now();
  if (!sessionPromise || now - sessionFetchedAt > SESSION_CACHE_MS) {
    sessionFetchedAt = now;
    sessionPromise = fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? (res.json() as Promise<SessionState>) : null))
      .catch(() => null);
  }
  return sessionPromise;
}
