"use client";

import { useState, useEffect } from "react";

export function useAuthCookieSync() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Check for auth token in localStorage and sync to cookie
    const syncAuthToken = () => {
      try {
        // Convex Auth stores token in localStorage with key pattern
        const keys = Object.keys(localStorage);
        const authKey = keys.find(k => k.includes("convex") && k.includes("auth"));
        
        if (authKey) {
          const token = localStorage.getItem(authKey);
          if (token) {
            // Sync to cookie for middleware access
            document.cookie = `__convexAuthJWT=${encodeURIComponent(token)}; path=/; max-age=2592000; SameSite=Lax; Secure`;
          }
        }
      } catch {
        // Ignore local cookie-sync failures; Convex Auth will still manage the session.
      }
      setIsReady(true);
    };

    syncAuthToken();
    
    // Listen for storage changes
    window.addEventListener("storage", syncAuthToken);
    return () => window.removeEventListener("storage", syncAuthToken);
  }, []);

  return { isReady };
}
