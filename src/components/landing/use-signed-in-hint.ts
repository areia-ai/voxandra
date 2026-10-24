"use client";

import { useEffect, useState } from "react";
import { fetchSessionState, hasSignedInHint } from "@/lib/session-state";

export function useSignedInHint(): boolean {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!hasSignedInHint()) return;
    fetchSessionState().then((session) => {
      if (!cancelled && session) setSignedIn(session.authenticated);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return signedIn;
}
