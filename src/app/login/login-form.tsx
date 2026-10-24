"use client";

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";

type AuthStep = "signIn" | "signUp" | "forgotPassword" | "resetPassword" | "verifyEmail";
type LastAuthProvider = "google" | "password";

const LAST_AUTH_PROVIDER_STORAGE_KEY = "voxandra:lastAuthProvider";
const LAST_AUTH_PROVIDER_CHANGE_EVENT = "voxandra:lastAuthProviderChanged";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

function customerAuthError(message: string | undefined) {
  if (!message) return "Authentication failed. Please try again.";

  if (message.includes("already exists")) {
    return "An account already exists for this email. Sign in instead, use Google, or reset your password.";
  }
  if (message === "Invalid credentials" || message.includes("InvalidSecret")) {
    return "That email and password do not match. Try Google if you signed up with Google, or reset your password.";
  }
  if (
    message.includes("InvalidAccountId") ||
    message.includes("Could not verify code") ||
    message.includes("Invalid code")
  ) {
    return "That code is invalid or expired. Request a new code and try again.";
  }
  if (message.includes("Invalid password")) {
    return "Use a password with at least 8 characters.";
  }
  if (message.includes("does not match that email address")) {
    return "That code does not match this email address.";
  }
  if (looksLikeTechnicalError(message)) {
    return "Something went wrong on our end. Please try again in a moment.";
  }
  return message;
}

// Guards against surfacing raw parser/network errors (e.g. a JSON.parse
// failure on an HTML error page) as if they were meaningful auth copy.
function looksLikeTechnicalError(message: string) {
  const technicalPatterns = [
    "Unexpected token",
    "is not valid JSON",
    "<!DOCTYPE",
    "NetworkError",
    "Failed to fetch",
    "fetch failed",
    "500",
    "502",
    "503",
  ];
  return technicalPatterns.some((pattern) => message.includes(pattern));
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function parseLastAuthProvider(value: string | null): LastAuthProvider | null {
  return value === "google" || value === "password" ? value : null;
}

function getLastAuthProviderSnapshot() {
  if (typeof window === "undefined") return null;

  try {
    return parseLastAuthProvider(window.localStorage.getItem(LAST_AUTH_PROVIDER_STORAGE_KEY));
  } catch {
    return null;
  }
}

function getServerLastAuthProviderSnapshot() {
  return null;
}

function subscribeLastAuthProvider(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  function handleStorage(event: StorageEvent) {
    if (event.key === LAST_AUTH_PROVIDER_STORAGE_KEY) {
      onStoreChange();
    }
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(LAST_AUTH_PROVIDER_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LAST_AUTH_PROVIDER_CHANGE_EVENT, onStoreChange);
  };
}

function withPhoneNumber(url: string, phoneNumber: string) {
  if (!phoneNumber) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}number=${encodeURIComponent(phoneNumber)}`;
}

function submitLabel(step: AuthStep, loading: boolean, authenticating: boolean) {
  if (authenticating) return "Authenticating...";
  if (loading) {
    if (step === "forgotPassword") return "Sending code...";
    if (step === "resetPassword") return "Resetting password...";
    if (step === "verifyEmail") return "Verifying...";
    return step === "signUp" ? "Creating account..." : "Signing in...";
  }
  if (step === "forgotPassword") return "Send reset code";
  if (step === "resetPassword") return "Reset password";
  if (step === "verifyEmail") return "Verify email";
  return step === "signUp" ? "Sign up" : "Sign in";
}

export function LoginForm() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<AuthStep>(() => {
    const mode = searchParams.get("mode");
    if (mode === "reset") return "resetPassword";
    if (mode === "verify-email") return "verifyEmail";
    if (mode === "signIn") return "signIn";
    return "signUp";
  });
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [authStarted, setAuthStarted] = useState(false);
  const lastAuthProvider = useSyncExternalStore(
    subscribeLastAuthProvider,
    getLastAuthProviderSnapshot,
    getServerLastAuthProviderSnapshot
  );

  const redirectTo = searchParams.get("redirect") || "/app";
  const phoneNumber = searchParams.get("number") || "";
  const paidCheckoutPending =
    redirectTo.includes("claimCheckout=") && redirectTo.includes("claimToken=");
  const authenticating = authStarted && isLoading;

  // Watch for auth state changes
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      // Stay inside the Next.js router so dirty form fields don't trigger
      // the browser's full-page "Leave site?" confirmation. Workspace setup
      // happens in AppShell after Convex Auth identity is fully available.
      const redirectUrl = withPhoneNumber(redirectTo, phoneNumber);

      router.replace(redirectUrl);
    }
  }, [isAuthenticated, isLoading, authStarted, redirectTo, phoneNumber, router]);

  function rememberLastAuthProvider(provider: LastAuthProvider) {
    try {
      window.localStorage.setItem(LAST_AUTH_PROVIDER_STORAGE_KEY, provider);
      window.dispatchEvent(new Event(LAST_AUTH_PROVIDER_CHANGE_EVENT));
    } catch {
      // Storage is only a UI hint; authentication must not depend on it.
    }
  }

  function moveToStep(nextStep: AuthStep) {
    setStep(nextStep);
    setError(null);
    setNotice(null);
    setAuthStarted(false);
    setLoading(false);
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const normalizedEmail = normalizeEmail(email || String(formData.get("email") ?? ""));
    formData.set("email", normalizedEmail);
    setEmail(normalizedEmail);
    setError(null);
    setNotice(null);
    setLoading(true);
    setAuthStarted(step !== "forgotPassword");

    try {
      if (step === "forgotPassword") {
        formData.set("flow", "reset");
        await signIn("password", formData);
        setStep("resetPassword");
        setNotice(
          `If ${normalizedEmail} has a password login, a reset code was sent. If you used Google, continue with Google instead.`
        );
        setLoading(false);
        setAuthStarted(false);
        form.reset();
        return;
      }

      if (step === "resetPassword") {
        formData.set("flow", "reset-verification");
        await signIn("password", formData);
        rememberLastAuthProvider("password");
        return;
      }

      if (step === "verifyEmail") {
        formData.set("flow", "email-verification");
        await signIn("password", formData);
        rememberLastAuthProvider("password");
        return;
      }

      formData.set("flow", step);
      const result = await signIn("password", formData);
      if (result.signingIn) {
        rememberLastAuthProvider("password");
      }
      if (!result.signingIn) {
        setStep("verifyEmail");
        setNotice(`We sent a verification code to ${normalizedEmail}. Enter it to finish signing in.`);
        setLoading(false);
        setAuthStarted(false);
        form.reset();
      }
      // Don't redirect here - let the useEffect handle it when auth state updates
    } catch (err: unknown) {
      const rawMessage = getErrorMessage(err);
      if (step === "forgotPassword" && rawMessage?.includes("InvalidAccountId")) {
        setStep("resetPassword");
        setNotice(
          `If ${normalizedEmail} has a password login, a reset code was sent. If you used Google, continue with Google instead.`
        );
      } else {
        setError(customerAuthError(rawMessage));
      }
      setLoading(false);
      setAuthStarted(false);
    }
  };

  const benefits = paidCheckoutPending
    ? [
        "Connect your paid Stripe checkout",
        "Set up your workspace automatically",
        "Start browser calls with your plan or credits",
      ]
    : [
        publicTranslatedTrialEnabled() ? "Try one free 90-second translated call after signing in" : "Start with one free 90-second browser call",
        "AI captures summaries, details & follow-ups",
        "No credit card required to start",
      ];

  const pageTitle =
    step === "forgotPassword" || step === "resetPassword"
      ? "Reset your password"
      : step === "verifyEmail"
        ? "Verify your email"
        : paidCheckoutPending
          ? "Finish your Voxandra setup"
          : step === "signIn"
            ? "Sign in to Voxandra"
            : "Create your Voxandra workspace";
  const pageCopy =
    step === "forgotPassword"
      ? "Enter the email for your password login. We will send a reset code if that login exists."
      : step === "resetPassword"
        ? "Paste the reset code from your email, then choose a new password."
        : step === "verifyEmail"
          ? "Paste the verification code from your email to finish signing in."
          : paidCheckoutPending
            ? "Create your workspace and Voxandra will connect the paid checkout you just completed."
            : "Make your first call, then review the note, transcript, extracted details, and follow-ups before they become team records.";
  const showStandardAuth = step === "signIn" || step === "signUp";
  const showPassword = step === "signIn" || step === "signUp";
  const showCode = step === "resetPassword" || step === "verifyEmail";
  const showNewPassword = step === "resetPassword";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_0%,rgba(124,58,237,0.12),transparent_32%),#faf8f4] px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center space-y-2">
          <Image
            src="/brand/voxandra-logo.svg"
            alt="Voxandra"
            width={210}
            height={50}
            priority
            className="h-12 w-auto"
          />
        </div>

        <div className="space-y-3 text-center">
          <h1 className="text-2xl font-bold text-stone-950">{pageTitle}</h1>
          <p className="text-sm leading-6 text-stone-600">{pageCopy}</p>
          {showStandardAuth ? (
            <ul className="inline-block space-y-2 text-left">
              {benefits.map((benefit) => (
                <li key={benefit} className="flex items-center gap-2 text-sm text-stone-700">
                  <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-green-600" />
                  {benefit}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {showStandardAuth ? (
          <>
            {/* Google sign in */}
            <button
              type="button"
              onClick={() => {
                rememberLastAuthProvider("google");
                setAuthStarted(true);
                void signIn("google", { redirectTo: withPhoneNumber(redirectTo, phoneNumber) });
              }}
              disabled={loading}
              className="grid w-full grid-cols-[1fr_auto_1fr] items-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:opacity-50"
            >
              <span className="col-start-2 inline-flex min-w-0 items-center justify-center gap-2">
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span>Continue with Google</span>
              </span>
              {lastAuthProvider === "google" ? (
                <span className="col-start-3 justify-self-end rounded-full bg-violet-50 px-2 py-0.5 text-[0.68rem] font-bold leading-4 text-[#3b1676] ring-1 ring-violet-100">
                  Last used
                </span>
              ) : null}
            </button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-stone-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-[#faf8f4] px-2 text-stone-500">or</span>
              </div>
            </div>
          </>
        ) : null}

        {/* Email form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-stone-700">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-violet-100"
            />
          </div>

          {showPassword ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="password" className="text-sm font-medium text-stone-700">Password</label>
                {step === "signIn" ? (
                  <button
                    type="button"
                    onClick={() => moveToStep("forgotPassword")}
                    className="text-xs font-semibold text-[#3b1676] hover:text-[#2e1065]"
                  >
                    Forgot password?
                  </button>
                ) : null}
              </div>
              <input
                id="password"
                name="password"
                type="password"
                required
                placeholder="Minimum 8 characters"
                minLength={8}
                className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
            </div>
          ) : null}

          {showCode ? (
            <div className="space-y-2">
              <label htmlFor="code" className="text-sm font-medium text-stone-700">
                {step === "resetPassword" ? "Reset code" : "Verification code"}
              </label>
              <input
                id="code"
                name="code"
                type="text"
                required
                autoComplete="one-time-code"
                placeholder="Paste the code from your email"
                className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 font-mono text-sm text-stone-900 placeholder:font-sans placeholder:text-stone-400 focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
            </div>
          ) : null}

          {showNewPassword ? (
            <div className="space-y-2">
              <label htmlFor="newPassword" className="text-sm font-medium text-stone-700">New password</label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                placeholder="Minimum 8 characters"
                minLength={8}
                className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-[#7c3aed] focus:outline-none focus:ring-2 focus:ring-violet-100"
              />
            </div>
          ) : null}

          {notice ? (
            <div className="rounded-lg bg-violet-50 px-3 py-2 text-sm leading-5 text-violet-800">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="space-y-2 rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">
              <p>{error}</p>
              {step === "signIn" ? (
                <button
                  type="button"
                  onClick={() => moveToStep("forgotPassword")}
                  className="font-semibold text-red-800 underline decoration-red-300 underline-offset-2 hover:text-red-900"
                >
                  Reset password
                </button>
              ) : null}
            </div>
          ) : null}

          {authenticating ? (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
              <p className="font-semibold">Authenticating...</p>
              <p className="mt-1 text-xs">Please wait while we sign you in.</p>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading || authenticating}
            className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-950/10 transition hover:bg-brand-dark disabled:opacity-50"
          >
            {submitLabel(step, loading, authenticating)}
          </button>
        </form>

        {/* Toggle sign in/sign up */}
        <div className="space-y-3 text-center">
          {showStandardAuth ? (
            <button
              type="button"
              onClick={() => moveToStep(step === "signIn" ? "signUp" : "signIn")}
              className="text-sm text-stone-600 hover:text-stone-900"
            >
              {step === "signUp"
                ? "Already have an account? "
                : "Don't have an account? "}
              <span className="font-semibold text-[#3b1676] hover:text-[#2e1065]">
                {step === "signUp" ? "Sign in" : "Sign up"}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => moveToStep("signIn")}
              className="text-sm font-semibold text-[#3b1676] hover:text-[#2e1065]"
            >
              Back to sign in
            </button>
          )}

          <div>
            <Link href="/" className="text-sm text-stone-400 hover:text-stone-600">
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
