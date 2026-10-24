"use client";

import { useEffect } from "react";
import { captureProductEvent } from "@/lib/analytics";

export function TranslationLandingAnalytics() {
  useEffect(() => {
    captureProductEvent("translation_landing_view", {
      route: "/live-voice-translation",
      source: "product_pillar",
    });
  }, []);

  return null;
}
