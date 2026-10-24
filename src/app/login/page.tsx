import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";

export const metadata: Metadata = {
  title: "Log in",
  description:
    publicTranslatedTrialEnabled() ? "Sign in to Voxandra to try one free 90-second translated call. No credit card or subscription required." : "Log in to Voxandra for multilingual business calls, or start with a free 90-second standard trial call — no credit card required.",
  alternates: {
    canonical: "/login",
  },
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-[#3b1676]" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
