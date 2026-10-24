"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CircleDollarSign,
  Languages,
  PhoneForwarded,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { mapDoc } from "@/lib/convex-helpers";
import { titleCase } from "@/lib/format";
import type { CallingNumber } from "@/lib/types";
import {
  callsOnlyPlan,
  memoryPlans,
  soloMemoryPlan,
  topUpPlans,
  type PublicPricingPlan,
} from "@/lib/pricing";
import { formatRealtimeMinutes } from "@/lib/realtime-entitlements";
import {
  describeTopUpBuyingPower,
  type BuyingPowerRow,
  type FeatureRatesCentsPerMinute,
} from "@/lib/billing/buying-power";
import {
  AUTO_TOP_UP_AMOUNT_CENTS,
  AUTO_TOP_UP_THRESHOLD_CENTS,
  CALLING_NUMBER_RENTAL_PRICE_CENTS,
  CUSTOM_TOP_UP_MAX_CENTS,
  CUSTOM_TOP_UP_MIN_CENTS,
  TOP_UP_CREDIT_EXPIRY_LABEL,
  formatCents,
} from "@/lib/billing/config";
import { captureProductEvent } from "@/lib/analytics";
import { useToast } from "@/components/ui/toast";

const subscriptionPlans = [soloMemoryPlan, ...memoryPlans];

type AvailableRentalNumber = {
  phoneNumber: string;
  friendlyName?: string;
  isoCountry: string;
  region?: string;
  locality?: string;
  addressRequirements?: string;
};

type InboundSettingsForm = {
  inboundEnabled: boolean;
  inboundForwardingNumber: string;
  inboundRingTimeoutSeconds: string;
  inboundVoicemailEnabled: boolean;
  inboundVoicemailGreeting: string;
  inboundAiCaptureEnabled: boolean;
  inboundRecordingComplianceAttested: boolean;
};

function callingNumberSourceLabel(source: string) {
  if (source === "twilio_account") return "Voxandra number";
  if (source === "verified_external") return "Verified number";
  if (source === "rented") return "Rented number";
  return "Calling number";
}

function callingNumberStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function checkoutDestination(endpoint: string) {
  if (endpoint.includes("/subscription")) return "subscription";
  if (endpoint.includes("/top-up")) return "top_up";
  if (endpoint.includes("/calling-number")) return "calling_number";
  if (endpoint.includes("/auto-top-up")) return "auto_top_up";
  return "checkout";
}

function planPriceLabel(plan: PublicPricingPlan) {
  if (plan.price) return `${plan.price}${plan.period ?? ""}`;
  return plan.priceLabel ?? "No subscription";
}

function planActionLabel(args: {
  isCurrentPlan: boolean;
  isLoading: boolean;
  billingReady: boolean;
  canManageBilling: boolean;
  hasAuthToken: boolean;
}) {
  if (args.isLoading) return "Opening...";
  if (args.isCurrentPlan) return "Current plan";
  if (!args.billingReady) return "Checking billing";
  if (!args.canManageBilling) return "Owner manages billing";
  if (!args.hasAuthToken) return "Sign in to choose";
  return "Choose plan";
}

function formatWalletMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  if (minutes < 1) return "<1 min";
  return `${Math.round(minutes)} min`;
}

function formatCallDuration(seconds?: number) {
  if (seconds === undefined || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatActivityDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function activityAmountLabel(amountCents: number, tone: string) {
  if (tone === "pending") return `${formatCents(Math.abs(amountCents))} reserved`;
  if (amountCents > 0) return `+${formatCents(amountCents)}`;
  return formatCents(amountCents);
}

function activityAmountClasses(tone: string) {
  if (tone === "pending") return "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300";
  if (tone === "credit") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
  if (tone === "charge") return "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300";
  return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
}

function billingStatusLabel(status: string | undefined) {
  if (!status || status === "free") return "Free trial";
  if (status === "active") return "Active";
  if (status === "trialing") return "Trialing";
  if (status === "past_due") return "Past due";
  if (status === "canceled") return "Canceled";
  return titleCase(status);
}

const WALLET_TABS = [
  { id: "overview", label: "Overview" },
  { id: "plans", label: "Plans & credits" },
  { id: "numbers", label: "Numbers" },
  { id: "usage", label: "Usage" },
] as const;

type WalletTab = (typeof WALLET_TABS)[number]["id"];

function inboundFormFromNumber(number: CallingNumber): InboundSettingsForm {
  return {
    inboundEnabled: Boolean(number.inboundEnabled),
    inboundForwardingNumber: number.inboundForwardingNumber ?? "",
    inboundRingTimeoutSeconds: String(number.inboundRingTimeoutSeconds ?? 25),
    inboundVoicemailEnabled: number.inboundVoicemailEnabled !== false,
    inboundVoicemailGreeting:
      number.inboundVoicemailGreeting ??
      "Please leave a message after the tone. The team will follow up.",
    inboundAiCaptureEnabled: Boolean(number.inboundAiCaptureEnabled),
    inboundRecordingComplianceAttested: Boolean(
      number.inboundRecordingComplianceAttested
    ),
  };
}

function WalletPlanCard({
  plan,
  isCurrentPlan,
  isLoading,
  billingReady,
  canManageBilling,
  hasAuthToken,
  onChoosePlan,
}: {
  plan: PublicPricingPlan;
  isCurrentPlan: boolean;
  isLoading: boolean;
  billingReady: boolean;
  canManageBilling: boolean;
  hasAuthToken: boolean;
  onChoosePlan: () => void;
}) {
  const featured = Boolean(plan.featured);
  const disabled = isCurrentPlan || isLoading || !billingReady || !canManageBilling || !hasAuthToken;
  const cardClasses = isCurrentPlan
    ? "border-emerald-300 bg-emerald-50/25 shadow-md shadow-emerald-950/5 ring-1 ring-emerald-200 dark:border-emerald-800 dark:bg-emerald-950/20 dark:ring-emerald-900/60"
    : featured
      ? "border-[#6d28d9] bg-white shadow-md shadow-violet-950/10 ring-1 ring-[#6d28d9]/20 dark:border-violet-500 dark:bg-stone-900 dark:ring-violet-500/20"
      : "border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900";
  const actionClasses = isCurrentPlan
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    : featured
      ? "bg-brand text-white hover:bg-brand-dark"
      : "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800";

  return (
    <article className={`flex min-h-full flex-col rounded-lg border p-5 ${cardClasses}`}>
      <div className="flex min-h-8 flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {plan.badge ? (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                featured ? "bg-brand text-white" : "bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
              }`}
            >
              {plan.badge}
            </span>
          ) : null}
          {isCurrentPlan ? (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              Current plan
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <h3 className="text-lg font-semibold text-stone-950 dark:text-stone-50">{plan.name}</h3>
        <p className="mt-2 min-h-12 text-sm leading-6 text-stone-600 dark:text-stone-400">{plan.description}</p>
      </div>

      <div className="mt-4">
        <p className="text-3xl font-semibold tracking-normal text-stone-950 dark:text-stone-50">
          {planPriceLabel(plan)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {plan.seats ? (
            <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
              {plan.seats}
            </span>
          ) : null}
          {plan.credits ? (
            <span className="rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300">
              {plan.credits}
            </span>
          ) : null}
        </div>
      </div>

      {plan.liveFeatureCallouts?.length ? (
        <div className="mt-4 grid gap-2">
          {plan.liveFeatureCallouts.map((callout) => (
            <div
              key={`${plan.name}-${callout.title}`}
              className={`rounded-lg border px-3 py-2 ${
                callout.tone === "green"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300"
              }`}
            >
              <div className="flex items-start gap-2">
                {callout.tone === "green" ? (
                  <Languages aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-400" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase">{callout.title}</p>
                  <p className="mt-0.5 text-xs leading-5">{callout.usage}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <ul className="mt-5 flex-1 space-y-2.5">
        {plan.features.slice(0, featured ? 5 : 4).map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm leading-5 text-stone-700 dark:text-stone-300">
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#6d28d9] dark:text-violet-400" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={disabled}
        onClick={onChoosePlan}
        className={`mt-5 inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${actionClasses}`}
      >
        {planActionLabel({
          isCurrentPlan,
          isLoading,
          billingReady,
          canManageBilling,
          hasAuthToken,
        })}
      </button>
    </article>
  );
}

function TopUpBuyingPower({ rows }: { rows: BuyingPowerRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="mt-3 space-y-1.5 border-t border-stone-200/70 pt-3 text-xs dark:border-stone-800/70">
      {rows.map((row) => (
        <div key={row.key} className="flex items-baseline justify-between gap-3">
          <dt className="min-w-0 text-stone-500 dark:text-stone-400">{row.label}</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-stone-800 dark:text-stone-200">
            {row.approximate ? "~" : ""}
            {row.minutes.toLocaleString()} min
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function WalletPage() {
  const workspace = useQuery(api.profiles.getMyWorkspace);
  const convexWallet = useQuery(api.walletSummaries.getWalletSummary);
  const walletActivity = useQuery(api.walletSummaries.getCreditActivity);
  const realtimeUsage = useQuery(api.realtimeUsage.getRealtimeUsageSummary);
  const currentRole = useQuery(api.team.getMyWorkspaceRole);
  const callingNumbers = useQuery(api.callingNumbers.getCallingNumbers) as
    | CallingNumber[]
    | undefined;
  const requestWorkspaceCredits = useMutation(api.walletSummaries.requestWorkspaceCredits);
  const setDefaultCallingNumber = useMutation(api.callingNumbers.setDefaultCallingNumber);
  const updateInboundSettings = useMutation(api.callingNumbers.updateInboundSettings);
  const authToken = useAuthToken();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<WalletTab>("overview");
  const [billingError, setBillingError] = useState("");
  const [loadingAction, setLoadingAction] = useState("");
  const [customTopUpAmount, setCustomTopUpAmount] = useState("25");
  const [businessInvoiceOverride, setBusinessInvoiceOverride] = useState<boolean | null>(null);
  const [autoTopUpOverride, setAutoTopUpOverride] = useState<boolean | null>(null);
  const [verifyPhoneNumber, setVerifyPhoneNumber] = useState("");
  const [verifyLabel, setVerifyLabel] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [rentalCountry, setRentalCountry] = useState("US");
  const [rentalAreaCode, setRentalAreaCode] = useState("");
  const [rentalResults, setRentalResults] = useState<AvailableRentalNumber[]>([]);
  const [inboundForms, setInboundForms] = useState<Record<string, InboundSettingsForm>>({});
  const [cancelNumber, setCancelNumber] = useState<CallingNumber | null>(null);
  const handledInitialCheckout = useRef(false);
  const handledPublicCheckoutClaim = useRef(false);
  const handledSubscriptionSuccessGoal = useRef(false);
  const [checkoutClaimMessage, setCheckoutClaimMessage] = useState("");
  const [checkoutClaimError, setCheckoutClaimError] = useState("");
  const [creditRequestState, setCreditRequestState] = useState<
    "idle" | "sending" | "sent"
  >("idle");
  const wallet = convexWallet ? mapDoc(convexWallet) : null;
  const currentPlan = subscriptionPlans.find((plan) => plan.planId === wallet?.planId);
  const includedBalanceCents = wallet?.includedCreditBalanceCents ?? 0;
  const topUpBalanceCents = wallet?.topUpCreditBalanceCents ?? 0;
  const reservedBalanceCents = wallet?.reservedCreditCents ?? 0;
  const totalAvailableCents = includedBalanceCents + topUpBalanceCents;
  const walletActivitySummary = walletActivity?.summary;
  const availableNowCents = walletActivitySummary?.availableCents ?? totalAvailableCents;
  const currentCycleSpentCents = walletActivitySummary?.currentCycleSpentCents ?? 0;
  const currentCycleMinutes =
    walletActivitySummary?.currentCycleMinutes ?? wallet?.usageThisMonth ?? 0;
  const lifetimeSpentCents =
    walletActivitySummary?.lifetimeSpentCents ?? wallet?.lifetimeCreditSpendCents ?? 0;
  const resetDate = wallet?.stripeCurrentPeriodEnd
    ? new Date(wallet.stripeCurrentPeriodEnd).toLocaleDateString()
    : "After the next paid invoice";
  // Purchased credits never expire. Any legacy topUpCreditExpiresAt is stripped
  // by clearLegacyTopUpExpiry on the next wallet write, so it is not displayed.
  const topUpExpiry = TOP_UP_CREDIT_EXPIRY_LABEL;
  const businessInvoiceRequested =
    businessInvoiceOverride ?? Boolean(wallet?.businessInvoiceRequested);
  const autoTopUpEnabled = autoTopUpOverride ?? Boolean(wallet?.autoTopUpEnabled);
  const billingReady = currentRole !== undefined;
  const canManageBilling = currentRole === "owner";
  // Deliberately wider than canManageBilling. Adding money to the shared wallet is
  // not the same authority as changing what the workspace is committed to, and
  // owner-only purchasing meant a rep who ran out mid-afternoon could only wait.
  // Mirrored server-side by getTopUpBillingContext — this flag only hides UI.
  const canBuyCredits = currentRole === "owner" || currentRole === "admin";
  // The quiet "Cancel subscription" link only makes sense for the owner of a
  // workspace that actually has a live paid subscription to cancel.
  const hasCancelableSubscription =
    canManageBilling &&
    (wallet?.subscriptionStatus === "active" || wallet?.subscriptionStatus === "trialing");
  const canManageCallingNumbers = currentRole === "owner" || currentRole === "admin";
  const liveAiValue = !realtimeUsage
    ? "Loading"
    : realtimeUsage.liveCopilot.enabled
      ? formatRealtimeMinutes(realtimeUsage.liveCopilot.usedSeconds)
      : "No plan";
  const liveAiDetail = !realtimeUsage
    ? "Checking Live Guidance"
    : realtimeUsage.liveCopilot.enabled
      ? `${formatRealtimeMinutes(realtimeUsage.liveCopilot.remainingIncludedSeconds)} included left`
      : "Subscribe to unlock Live Guidance";

  // Rates for the "what does this buy" rows on each top-up card. Read from the
  // workspace's own entitlement, never hard-coded — the overage rate is tiered
  // per plan, so Solo and Operations must not see the same figure.
  //
  const topUpFeatureRates: FeatureRatesCentsPerMinute = {
    live_copilot: realtimeUsage?.liveCopilot.enabled
      ? realtimeUsage.liveCopilot.overageCentsPerMinute
      : null,
    translated_audio: realtimeUsage?.translatedAudio.enabled
      ? realtimeUsage.translatedAudio.overageCentsPerMinute
      : null,
  };
  // Only a valid, buyable amount gets a breakdown; an out-of-range or partial
  // entry shows nothing rather than minutes the customer cannot actually buy.
  const customTopUpCents = (() => {
    const amountDollars = Number(customTopUpAmount);
    if (!Number.isInteger(amountDollars)) return null;
    const cents = amountDollars * 100;
    if (cents < CUSTOM_TOP_UP_MIN_CENTS || cents > CUSTOM_TOP_UP_MAX_CENTS) return null;
    return cents;
  })();

  function inboundFormForNumber(number: CallingNumber) {
    return number.id
      ? inboundForms[number.id] ?? inboundFormFromNumber(number)
      : inboundFormFromNumber(number);
  }

  const postStripeAction = useCallback(async (
    endpoint: string,
    body: Record<string, string | number | boolean>,
    action: string,
    // Defaults to the stricter gate on purpose: a new billing action is
    // owner-only unless it explicitly opts into the wider credit-buying gate.
    permission: "manage_billing" | "buy_credits" = "manage_billing"
  ) => {
    if (!authToken) {
      setBillingError("Please sign in again before opening Stripe checkout.");
      return;
    }
    if (permission === "buy_credits" ? !canBuyCredits : !canManageBilling) {
      setBillingError(
        permission === "buy_credits"
          ? "Only workspace owners and admins can buy credits."
          : "Only the workspace owner can manage billing."
      );
      return;
    }
    setBillingError("");
    setLoadingAction(action);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { url?: string; saved?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Stripe request failed.");
      }
      if (result.url) {
        captureProductEvent("checkout_started", {
          destination: checkoutDestination(endpoint),
        });
        window.location.href = result.url;
        return;
      }
      setLoadingAction("");
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not open Stripe.");
      setLoadingAction("");
    }
  }, [authToken, canManageBilling, canBuyCredits]);

  async function openPortal() {
    await postStripeAction("/api/stripe/portal", {}, "portal");
  }

  async function cancelSubscription() {
    // Opens Stripe's billing portal deep-linked to the cancellation flow.
    await postStripeAction("/api/stripe/portal", { flow: "cancel" }, "cancel-subscription");
  }

  async function buyCustomTopUp() {
    const amountDollars = Number(customTopUpAmount);
    if (
      !Number.isInteger(amountDollars) ||
      amountDollars * 100 < CUSTOM_TOP_UP_MIN_CENTS ||
      amountDollars * 100 > CUSTOM_TOP_UP_MAX_CENTS
    ) {
      setBillingError(
        `Enter a whole-dollar amount from ${formatCents(CUSTOM_TOP_UP_MIN_CENTS)} to ${formatCents(CUSTOM_TOP_UP_MAX_CENTS)}.`
      );
      return;
    }

    await postStripeAction(
      "/api/stripe/checkout/top-up",
      {
        customAmountCents: amountDollars * 100,
        businessInvoiceRequested,
      },
      "topup:custom",
      "buy_credits"
    );
  }

  async function requestCredits() {
    setCreditRequestState("sending");
    try {
      const result = await requestWorkspaceCredits();
      // A cooldown hit is still success from here: someone has already been asked.
      // The one genuine dead end is a workspace with no reachable owner or admin.
      if (result.noRecipients) {
        showToast("No owner or admin has an email address on file.", "error");
        setCreditRequestState("idle");
        return;
      }
      setCreditRequestState("sent");
      showToast(
        result.alreadyRequested
          ? "Your team has already been asked in the last 24 hours."
          : "Asked your workspace owner and admins to add credits.",
        "success"
      );
    } catch {
      showToast("Could not send that request. Try again.", "error");
      setCreditRequestState("idle");
    }
  }

  async function toggleAutoTopUp(enabled: boolean) {
    setAutoTopUpOverride(enabled);
    await postStripeAction(
      "/api/stripe/auto-top-up/setup",
      {
        enabled,
        businessInvoiceRequested,
      },
      "auto-topup"
    );
  }

  async function startCallerIdVerification() {
    if (!authToken) {
      setBillingError("Please sign in again before verifying a caller ID.");
      return;
    }
    setBillingError("");
    setVerificationCode("");
    setLoadingAction("verify-caller-id");
    try {
      const response = await fetch("/api/twilio/caller-id/verify", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phoneNumber: verifyPhoneNumber,
          label: verifyLabel,
        }),
      });
      const result = (await response.json()) as {
        validationCode?: string;
        error?: string;
      };
      if (!response.ok || !result.validationCode) {
        throw new Error(result.error || "Could not start caller ID verification.");
      }
      setVerificationCode(result.validationCode);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not verify caller ID.");
    } finally {
      setLoadingAction("");
    }
  }

  async function searchRentalNumbers() {
    if (!authToken) {
      setBillingError("Please sign in again before searching numbers.");
      return;
    }
    setBillingError("");
    setLoadingAction("number-search");
    try {
      const params = new URLSearchParams({ country: rentalCountry });
      if (rentalAreaCode.trim()) params.set("areaCode", rentalAreaCode.trim());
      const response = await fetch(`/api/twilio/numbers/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const result = (await response.json()) as {
        numbers?: AvailableRentalNumber[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error || "Could not search numbers.");
      }
      setRentalResults(result.numbers ?? []);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not search numbers.");
    } finally {
      setLoadingAction("");
    }
  }

  async function chooseDefaultCallingNumber(callingNumberId: string | null) {
    setBillingError("");
    setLoadingAction(`default:${callingNumberId ?? "account"}`);
    try {
      await setDefaultCallingNumber({
        callingNumberId: callingNumberId
          ? (callingNumberId as Id<"callingNumbers">)
          : undefined,
      });
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not update default number.");
    } finally {
      setLoadingAction("");
    }
  }

  async function rentCallingNumber(number: AvailableRentalNumber) {
    await postStripeAction(
      "/api/stripe/checkout/calling-number",
      {
        phoneNumber: number.phoneNumber,
        label: number.friendlyName ?? number.phoneNumber,
        isoCountry: number.isoCountry,
        region: number.region ?? "",
        locality: number.locality ?? "",
        addressRequirements: number.addressRequirements ?? "none",
      },
      `rent:${number.phoneNumber}`
    );
  }

  async function cancelCallingNumber(callingNumberId: string) {
    if (!authToken) {
      setBillingError("Please sign in again before canceling a number.");
      return;
    }
    if (!canManageBilling) {
      setBillingError("Only the workspace owner can cancel rented numbers.");
      return;
    }
    setBillingError("");
    setLoadingAction(`cancel:${callingNumberId}`);
    try {
      const response = await fetch("/api/stripe/calling-number/cancel", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ callingNumberId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error || "Could not cancel number.");
      }
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not cancel number.");
    } finally {
      setLoadingAction("");
    }
  }

  function updateInboundForm(numberId: string, patch: Partial<InboundSettingsForm>) {
    setInboundForms((current) => ({
      ...current,
      [numberId]: {
        ...(current[numberId] ?? {
          inboundEnabled: false,
          inboundForwardingNumber: "",
          inboundRingTimeoutSeconds: "25",
          inboundVoicemailEnabled: true,
          inboundVoicemailGreeting: "Please leave a message after the tone. The team will follow up.",
          inboundAiCaptureEnabled: false,
          inboundRecordingComplianceAttested: false,
        }),
        ...patch,
      },
    }));
  }

  async function saveInboundSettings(number: CallingNumber) {
    if (!number.id) return;
    if (!canManageCallingNumbers) {
      setBillingError("Only workspace owners and admins can manage receive-call setup.");
      return;
    }
    const form = inboundForms[number.id] ?? inboundFormFromNumber(number);
    const ringTimeout = Number(form.inboundRingTimeoutSeconds);
    setBillingError("");
    setLoadingAction(`inbound:${number.id}`);
    try {
      await updateInboundSettings({
        callingNumberId: number.id as Id<"callingNumbers">,
        inboundEnabled: form.inboundEnabled,
        inboundForwardingNumber: form.inboundForwardingNumber.trim() || undefined,
        inboundRingTimeoutSeconds: Number.isFinite(ringTimeout) ? ringTimeout : 25,
        inboundVoicemailEnabled: form.inboundVoicemailEnabled,
        inboundVoicemailGreeting: form.inboundVoicemailGreeting.trim() || undefined,
        inboundAiCaptureEnabled: form.inboundAiCaptureEnabled,
        inboundRecordingComplianceAttested: form.inboundRecordingComplianceAttested,
      });
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "Could not save inbound settings.");
    } finally {
      setLoadingAction("");
    }
  }

  useEffect(() => {
    if (handledInitialCheckout.current || !authToken || currentRole === undefined) return;
    const params = new URLSearchParams(window.location.search);
    const checkoutPlan = params.get("checkoutPlan");
    const topUp = params.get("topUp");
    if (!checkoutPlan && !topUp) return;
    handledInitialCheckout.current = true;
    if (checkoutPlan) {
      window.setTimeout(() => {
        void postStripeAction(
          "/api/stripe/checkout/subscription",
          { planId: checkoutPlan },
          `plan:${checkoutPlan}`
        );
      }, 0);
    } else if (topUp) {
      window.setTimeout(() => {
        void postStripeAction(
          "/api/stripe/checkout/top-up",
          { topUpId: topUp },
          `topup:${topUp}`
        );
      }, 0);
    }
  }, [authToken, currentRole, postStripeAction]);

  useEffect(() => {
    if (handledSubscriptionSuccessGoal.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    const plan = params.get("plan");
    if (!plan) return;
    handledSubscriptionSuccessGoal.current = true;
    captureProductEvent("subscription_completed", { planId: plan });
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    url.searchParams.delete("plan");
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    if (
      handledPublicCheckoutClaim.current ||
      !authToken ||
      !workspace ||
      currentRole === undefined
    ) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const stripeCheckoutSessionId = params.get("claimCheckout");
    const claimToken = params.get("claimToken");
    if (!stripeCheckoutSessionId || !claimToken) return;

    handledPublicCheckoutClaim.current = true;
    window.setTimeout(() => {
      setCheckoutClaimMessage("");
      setCheckoutClaimError("");

      if (!canManageBilling) {
        setCheckoutClaimError("Only the workspace owner can claim this paid checkout.");
        return;
      }

      setLoadingAction("claim-public-checkout");
      void (async () => {
        try {
          const response = await fetch("/api/stripe/public-checkout/claim", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ stripeCheckoutSessionId, claimToken }),
          });
          const result = (await response.json()) as {
            checkoutType?: "subscription" | "top_up";
            planId?: string;
            topUpId?: string;
            alreadyClaimed?: boolean;
            error?: string;
          };
          if (!response.ok) {
            throw new Error(result.error || "Could not claim Stripe checkout.");
          }

          const description =
            result.checkoutType === "subscription"
              ? `Your ${result.planId ?? "Copilot"} plan is connected to this workspace.`
              : "Your calling credits are connected to this workspace.";
          setCheckoutClaimMessage(
            result.alreadyClaimed
              ? "This paid checkout was already connected to this workspace."
              : description
          );

          if (!result.alreadyClaimed && result.checkoutType === "subscription") {
            captureProductEvent("subscription_completed", {
              planId: result.planId ?? "unknown",
            });
          }

          const url = new URL(window.location.href);
          url.searchParams.delete("claimCheckout");
          url.searchParams.delete("claimToken");
          url.searchParams.set("checkout", "success");
          window.history.replaceState({}, "", url.toString());
        } catch (error) {
          setCheckoutClaimError(
            error instanceof Error ? error.message : "Could not claim Stripe checkout."
          );
        } finally {
          setLoadingAction("");
        }
      })();
    }, 0);
  }, [authToken, canManageBilling, currentRole, workspace]);

  useEffect(() => {
    if (
      !workspace ||
      (window.location.hash !== "#calling-numbers" &&
        window.location.hash !== "#receive-calls")
    ) {
      return;
    }
    // The target elements only exist once the "numbers" tab's content is
    // mounted, so switch tabs first and let that render land before scrolling.
    // This can't move to a lazy useState initializer instead: reading
    // location.hash there would run during SSR too (no window, wrong value)
    // and cause the exact hydration mismatch this pattern avoids by only
    // correcting the tab after mount, once hydration has already completed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab("numbers");
    window.setTimeout(() => {
      document
        .getElementById(window.location.hash.slice(1))
        ?.scrollIntoView({ block: "start" });
    }, 0);
  }, [workspace]);

  // This page is long enough that the inline error banner near the top can
  // scroll out of view of whatever action (top-up, number rental, etc.) the
  // user just took far below it, so mirror errors into a toast that stays
  // visible regardless of scroll position.
  useEffect(() => {
    if (billingError) showToast(billingError, "error");
  }, [billingError, showToast]);

  if (!workspace) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">Wallet</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">Plan and calling credits</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">
          Monthly included credits reset each billing cycle. Purchased top-up credits never
          expire. This one balance pays for call minutes and for Live Guidance and Live
          Translation past your plan&apos;s included minutes.
        </p>
        {currentRole && !canManageBilling ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            {canBuyCredits
              ? "You can use the shared workspace wallet and buy credits for it. Only the workspace owner can change plans or manage paid number rentals."
              : "You can use the shared workspace wallet. Only owners and admins can buy credits, and only the owner can change plans or manage paid number rentals."}
          </p>
        ) : null}
        {loadingAction === "claim-public-checkout" ? (
          <p className="mt-4 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-[#4c1d95] dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300">
            Connecting your paid Stripe checkout to this workspace...
          </p>
        ) : null}
        {checkoutClaimMessage ? (
          <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300">
            {checkoutClaimMessage}
          </p>
        ) : null}
        {checkoutClaimError ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            {checkoutClaimError}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Available now"
          value={formatCents(availableNowCents)}
          detail={`${formatCents(includedBalanceCents)} included · ${formatCents(topUpBalanceCents)} top-up · ${formatCents(reservedBalanceCents)} reserved`}
          icon={CircleDollarSign}
          tone="teal"
        />
        <StatCard
          label="Credits spent this cycle"
          value={formatCents(currentCycleSpentCents)}
          detail={`${formatWalletMinutes(currentCycleMinutes)} call usage · ${formatCents(lifetimeSpentCents)} lifetime`}
          icon={PhoneForwarded}
          tone="blue"
        />
        <StatCard
          label="Billing"
          value={billingStatusLabel(wallet?.subscriptionStatus)}
          detail={currentPlan ? currentPlan.name : callsOnlyPlan.name}
          icon={ShieldCheck}
          tone="amber"
        />
        <StatCard
          label="Live Guidance"
          value={liveAiValue}
          detail={liveAiDetail}
          icon={Sparkles}
          tone="blue"
        />
      </section>

      <div
        role="tablist"
        aria-label="Wallet sections"
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-stone-100/70 p-1 dark:bg-stone-800/70"
      >
        {WALLET_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition ${
                active
                  ? "bg-white text-brand shadow-[0_8px_20px_rgba(28,25,23,0.08)] dark:bg-stone-900 dark:text-violet-300"
                  : "text-stone-600 hover:bg-white/70 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-900/70 dark:hover:text-stone-100"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" ? (
      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Current plan</p>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
              {currentPlan?.name ?? (wallet?.planId === "calls_only" ? callsOnlyPlan.name : "Free trial")}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Included credits</p>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
              {formatCents(includedBalanceCents)} available · resets {resetDate}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">Top-up credits</p>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
              {formatCents(topUpBalanceCents)} available · expires {topUpExpiry}
            </p>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-500">
              Also covers Live Guidance and Live Translation past your included minutes.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void openPortal()}
            disabled={!authToken || !canManageBilling || loadingAction === "portal"}
            className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            {loadingAction === "portal" ? "Opening..." : "Manage billing"}
          </button>
        </div>
        {billingError ? (
          <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            {billingError}
          </p>
        ) : null}
      </section>
      ) : null}

      {activeTab === "usage" ? (
      <>
      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Recent credit activity</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-400">
              Reservations appear while calls are starting. Paid connected calls settle with a
              60-second minimum and started-minute billing; unused reserved credits are released back to the wallet.
            </p>
          </div>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {walletActivity ? `${walletActivity.recentEntries.length} latest` : "Loading"}
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {walletActivity === undefined ? (
            <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-800/60 dark:text-stone-400">
              Loading credit activity...
            </p>
          ) : walletActivity.recentEntries.length > 0 ? (
            walletActivity.recentEntries.map((entry) => {
              const duration = formatCallDuration(entry.callDurationSeconds);
              const metadata = [
                formatActivityDate(entry.createdAt),
                entry.bucket !== "none" ? entry.bucket.replaceAll("_", " ") : null,
                duration ? `${duration} call` : null,
                entry.rateCentsPerMinute
                  ? `${formatCents(entry.rateCentsPerMinute)}/min`
                  : null,
                entry.isPendingReservation ? "Pending final cost" : null,
              ].filter(Boolean);

              return (
                <div
                  key={entry.id}
                  className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1fr_auto] md:items-center dark:border-stone-800 dark:bg-stone-800/60"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-stone-950 dark:text-stone-50">{entry.label}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activityAmountClasses(entry.tone)}`}
                      >
                        {activityAmountLabel(entry.amountCents, entry.tone)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{metadata.join(" · ")}</p>
                  </div>
                  {entry.callHref ? (
                    <Link
                      href={entry.callHref}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                    >
                      Call record
                      <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-4 text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-800/60 dark:text-stone-400">
              No credit activity yet. After a paid call starts, reservations and final
              charges will appear here.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Live Guidance and Live Translation usage</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-400">
              Every paid plan includes monthly Live Guidance and Live Translation minutes. Once
              included minutes run out, both features keep working and are charged to the same
              credit balance your calls use — so more live minutes just means more credits, at
              the metered rate. There is no separate live-feature add-on to buy.
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              Credits available now:{" "}
              <span className="font-semibold text-stone-900 dark:text-stone-100">
                {formatCents(includedBalanceCents + topUpBalanceCents)}
              </span>
              {topUpBalanceCents > 0 ? " · purchased credits never expire" : null}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              {realtimeUsage?.liveCopilot.enabled || realtimeUsage?.translatedAudio.enabled
                ? "Available"
                : "Not included"}
            </span>
            <button
              type="button"
              onClick={() => setActiveTab("plans")}
              className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 transition hover:bg-violet-100 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50"
            >
              Buy more credits
            </button>
          </div>
        </div>

        {realtimeUsage?.liveCopilot.enabled || realtimeUsage?.translatedAudio.enabled ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
              <div className="flex items-center gap-2">
                <Sparkles aria-hidden="true" className="h-4 w-4 text-violet-700 dark:text-violet-400" />
                <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Live Guidance</h3>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Used</p>
                  <p className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                    {formatRealtimeMinutes(realtimeUsage.liveCopilot.usedSeconds)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Included left</p>
                  <p className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                    {formatRealtimeMinutes(realtimeUsage.liveCopilot.remainingIncludedSeconds)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Metered rate</p>
                  <p className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                    {`$${(realtimeUsage.liveCopilot.overageCentsPerMinute / 100).toFixed(2)}/min`}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
                {`Charged to credits this cycle: ${formatCents(realtimeUsage.liveCopilot.chargedCents)}. Unpaid overage: ${formatCents(realtimeUsage.liveCopilot.unpaidCents)}.`}
              </p>
              {!realtimeUsage.liveCopilot.canStart && realtimeUsage.liveCopilot.blockedReason ? (
                <p className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-400">
                  {realtimeUsage.liveCopilot.blockedReason}
                </p>
              ) : null}
            </div>

            <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex items-center gap-2">
                <Languages aria-hidden="true" className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Voice Translation</h3>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Used</p>
                  <p className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                    {formatRealtimeMinutes(realtimeUsage.translatedAudio.usedSeconds)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Included left</p>
                  <p className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                    {realtimeUsage.translatedAudio.enabled
                      ? formatRealtimeMinutes(realtimeUsage.translatedAudio.remainingIncludedSeconds)
                      : "No plan"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Metered rate</p>
                  <p className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
                    {realtimeUsage.translatedAudio.enabled
                      ? `$${(realtimeUsage.translatedAudio.overageCentsPerMinute / 100).toFixed(2)}/min`
                      : "No plan"}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
                {realtimeUsage.translatedAudio.enabled
                  ? `Charged to credits this cycle: ${formatCents(realtimeUsage.translatedAudio.chargedCents)}. Unpaid overage: ${formatCents(realtimeUsage.translatedAudio.unpaidCents)}.`
                  : "Voice Translation is included on every paid plan."}
              </p>
              {!realtimeUsage.translatedAudio.canStart &&
              realtimeUsage.translatedAudio.blockedReason ? (
                <p className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-400">
                  {realtimeUsage.translatedAudio.blockedReason}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-800/60">
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              Start any paid plan for monthly Live Guidance and Live Translation minutes.
            </p>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              Calls-only does not include either live feature. Solo starts at 30 Live Guidance minutes and 5 Voice Translation minutes per month, and higher plans include more.
            </p>
          </div>
        )}
      </section>
      </>
      ) : null}

      {activeTab === "numbers" ? (
      <section
        id="calling-numbers"
        className="scroll-mt-32 rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Calling numbers</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-400">
              Choose what recipients see when your team calls from Voxandra.{" "}
              The Voxandra default number and verified external numbers are outbound caller ID only.
            </p>
          </div>
          <p className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
            Rented numbers {formatCents(CALLING_NUMBER_RENTAL_PRICE_CENTS)}/mo
          </p>
        </div>

        <div
          id="receive-calls"
          className="mt-5 scroll-mt-32 rounded-lg border border-violet-100 bg-violet-50/70 p-4 dark:border-violet-900/60 dark:bg-violet-950/20"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div>
              <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Receive calls</h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-700 dark:text-stone-300">
                Receive calls requires a rented Voxandra number. Calls to that number
                ring your forwarding phone and can become Call Records afterward.
              </p>
              <p className="mt-2 max-w-3xl text-xs leading-5 text-stone-500 dark:text-stone-400">
                Verified external numbers and the Voxandra default number stay outbound-only.
                For rented numbers, add one human forwarding phone, choose the ring time,
                and enable voicemail or AI capture when the workspace is entitled.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
              Human forwarding V1
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {callingNumbers === undefined ? (
            <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-800/60 dark:text-stone-400">
              Loading calling numbers...
            </p>
          ) : callingNumbers.length > 0 ? (
            callingNumbers.map((number) => (
              <div
                key={number.id ?? "twilio-account"}
                className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1fr_auto] md:items-center dark:border-stone-800 dark:bg-stone-800/60"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-semibold text-stone-950 dark:text-stone-50">
                      {number.phoneNumber}
                    </p>
                    {number.isDefault ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
                        <Check aria-hidden="true" className="h-3 w-3" />
                        Default
                      </span>
                    ) : null}
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                      {callingNumberSourceLabel(number.source)}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                      {callingNumberStatusLabel(number.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                    {number.label}
                    {number.locality || number.region
                      ? ` · ${[number.locality, number.region].filter(Boolean).join(", ")}`
                      : ""}
                  </p>
                  {number.twilioValidationCode ? (
                    <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                      Answer the Twilio call and enter code{" "}
                      <span className="font-mono font-semibold">{number.twilioValidationCode}</span>.
                    </p>
                  ) : null}
                  {number.errorMessage ? (
                    <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{number.errorMessage}</p>
                  ) : null}
                  {number.source === "rented" && number.id && number.status === "active" ? (
                    <div className="mt-4 rounded-lg border border-white bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Receive calls</h3>
                          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-400">
                            Calls to this rented number ring one human forwarding phone first.
                            AI capture only runs after workspace recording/transcription compliance attestation.
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200">
                          <input
                            type="checkbox"
                            checked={Boolean(inboundFormForNumber(number).inboundEnabled)}
                            onChange={(event) =>
                              updateInboundForm(number.id as string, { inboundEnabled: event.target.checked })
                            }
                            disabled={!canManageCallingNumbers}
                            className="h-4 w-4 rounded border-stone-300 text-[#3b1676] focus:ring-violet-200 dark:border-stone-700"
                          />
                          Receive calls
                        </label>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem]">
                        <label className="grid gap-1.5">
                          <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">
                            Human forwarding number
                          </span>
                          <input
                            value={inboundFormForNumber(number).inboundForwardingNumber}
                            onChange={(event) =>
                              updateInboundForm(number.id as string, {
                                inboundForwardingNumber: event.target.value,
                              })
                            }
                            disabled={!canManageCallingNumbers}
                            className="h-10 rounded-md border border-stone-300 bg-white px-3 font-mono text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:disabled:bg-stone-800/60"
                            placeholder="+351 910 000 000"
                          />
                        </label>
                        <label className="grid gap-1.5">
                          <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Ring seconds</span>
                          <input
                            value={inboundFormForNumber(number).inboundRingTimeoutSeconds}
                            onChange={(event) =>
                              updateInboundForm(number.id as string, {
                                inboundRingTimeoutSeconds: event.target.value.replace(/[^0-9]/g, ""),
                              })
                            }
                            disabled={!canManageCallingNumbers}
                            inputMode="numeric"
                            className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:disabled:bg-stone-800/60"
                          />
                        </label>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="flex items-start gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                          <input
                            type="checkbox"
                            checked={inboundFormForNumber(number).inboundVoicemailEnabled !== false}
                            onChange={(event) =>
                              updateInboundForm(number.id as string, {
                                inboundVoicemailEnabled: event.target.checked,
                              })
                            }
                            disabled={!canManageCallingNumbers}
                            className="mt-1 h-4 w-4 rounded border-stone-300 text-[#3b1676] focus:ring-violet-200 dark:border-stone-600"
                          />
                          <span>
                            <span className="block font-semibold text-stone-900 dark:text-stone-100">Voicemail</span>
                            <span className="block text-stone-500 dark:text-stone-400">Record missed-call messages.</span>
                          </span>
                        </label>
                        <label className="flex items-start gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
                          <input
                            type="checkbox"
                            checked={Boolean(inboundFormForNumber(number).inboundAiCaptureEnabled)}
                            onChange={(event) =>
                              updateInboundForm(number.id as string, {
                                inboundAiCaptureEnabled: event.target.checked,
                              })
                            }
                            disabled={!canManageCallingNumbers}
                            className="mt-1 h-4 w-4 rounded border-stone-300 text-[#3b1676] focus:ring-violet-200 dark:border-stone-600"
                          />
                          <span>
                            <span className="block font-semibold text-stone-900 dark:text-stone-100">AI capture</span>
                            <span className="block text-stone-500 dark:text-stone-400">
                              Create transcripts and reviewed Call Records when entitled and attested.
                            </span>
                          </span>
                        </label>
                      </div>

                      <label className="mt-3 grid gap-1.5">
                        <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Voicemail greeting</span>
                        <textarea
                          value={inboundFormForNumber(number).inboundVoicemailGreeting}
                          onChange={(event) =>
                            updateInboundForm(number.id as string, {
                              inboundVoicemailGreeting: event.target.value,
                            })
                          }
                          disabled={!canManageCallingNumbers}
                          className="min-h-20 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 disabled:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:disabled:bg-stone-800/60"
                        />
                      </label>

                      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                        <label className="flex max-w-2xl items-start gap-3 text-sm text-stone-700 dark:text-stone-300">
                          <input
                            type="checkbox"
                            checked={Boolean(
                              inboundFormForNumber(number).inboundRecordingComplianceAttested
                            )}
                            onChange={(event) =>
                              updateInboundForm(number.id as string, {
                                inboundRecordingComplianceAttested: event.target.checked,
                              })
                            }
                            disabled={!canManageCallingNumbers}
                            className="mt-1 h-4 w-4 rounded border-stone-300 text-[#3b1676] focus:ring-violet-200 dark:border-stone-600"
                          />
                          <span>
                            I attest this workspace is responsible for required caller notice and
                            consent before enabling recording/transcription for this number.
                          </span>
                        </label>
                        <button
                          type="button"
                          disabled={!canManageCallingNumbers || loadingAction === `inbound:${number.id}`}
                          onClick={() => void saveInboundSettings(number)}
                          className="inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
                        >
                          {loadingAction === `inbound:${number.id}` ? "Saving..." : "Save receive setup"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <button
                    type="button"
                    disabled={
                      number.status !== "active" ||
                      number.isDefault ||
                      loadingAction === `default:${number.id ?? "account"}`
                    }
                    onClick={() => void chooseDefaultCallingNumber(number.id)}
                    className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
                  >
                    {loadingAction === `default:${number.id ?? "account"}` ? "Saving..." : "Make default"}
                  </button>
                  {number.source === "rented" && number.id && number.status === "active" ? (
                    <button
                      type="button"
                      disabled={!canManageBilling || loadingAction === `cancel:${number.id}`}
                      onClick={() => setCancelNumber(number)}
                      className="rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:bg-stone-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                    >
                      {loadingAction === `cancel:${number.id}` ? "Canceling..." : "Cancel rental"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-800/60 dark:text-stone-400">
              No calling numbers are configured yet.
            </p>
          )}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Verify my number</h3>
            <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
              Twilio will call this number and ask for a six-digit code before Voxandra can use it as outbound caller ID.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                value={verifyPhoneNumber}
                onChange={(event) => setVerifyPhoneNumber(event.target.value)}
                className="h-10 rounded-md border border-stone-300 px-3 font-mono text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="+351 910 000 000"
              />
              <input
                value={verifyLabel}
                onChange={(event) => setVerifyLabel(event.target.value)}
                className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="Label"
              />
            </div>
            <button
              type="button"
              disabled={!authToken || loadingAction === "verify-caller-id"}
              onClick={() => void startCallerIdVerification()}
              className="mt-3 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {loadingAction === "verify-caller-id" ? "Calling..." : "Start verification"}
            </button>
            {verificationCode ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                Enter <span className="font-mono font-semibold">{verificationCode}</span> when Twilio calls.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Rent US/Canada number</h3>
            <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
              Search voice-capable local numbers, then checkout through Stripe. Rented
              numbers can be used for outbound caller ID and receive-call forwarding.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[7rem_1fr_auto]">
              <select
                value={rentalCountry}
                onChange={(event) => setRentalCountry(event.target.value)}
                className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
              >
                <option value="US">US</option>
                <option value="CA">Canada</option>
              </select>
              <input
                value={rentalAreaCode}
                onChange={(event) => setRentalAreaCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="Area code"
                inputMode="numeric"
              />
              <button
                type="button"
                disabled={!authToken || loadingAction === "number-search"}
                onClick={() => void searchRentalNumbers()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                <Search aria-hidden="true" className="h-4 w-4" />
                {loadingAction === "number-search" ? "Searching..." : "Search"}
              </button>
            </div>
            {rentalResults.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {rentalResults.map((number) => (
                  <div
                    key={number.phoneNumber}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-800/60"
                  >
                    <div>
                      <p className="font-mono text-sm font-semibold text-stone-950 dark:text-stone-50">
                        {number.phoneNumber}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        {[number.locality, number.region, number.isoCountry].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!canManageBilling || loadingAction === `rent:${number.phoneNumber}`}
                      onClick={() => void rentCallingNumber(number)}
                      className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
                    >
                      {loadingAction === `rent:${number.phoneNumber}` ? "Opening..." : "Rent"}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>
      ) : null}

      {activeTab === "plans" ? (
      <>
      <section className="rounded-lg border border-violet-100 bg-white p-5 shadow-sm md:p-6 dark:border-violet-900/60 dark:bg-stone-900">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase text-violet-700 dark:text-violet-400">paid plans</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-stone-50">
              Choose the multilingual calling plan for this workspace
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-400">
              Plans bundle seats, monthly calling credits, reviewed call records, and the AI support level your team needs on live calls.
            </p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 lg:min-w-56 dark:border-stone-700 dark:bg-stone-800/60">
            <p className="text-xs font-semibold uppercase text-stone-500 dark:text-stone-400">Active plan</p>
            <p className="mt-1 text-sm font-semibold text-stone-950 dark:text-stone-50">
              {currentPlan?.name ??
                (wallet?.planId === "calls_only" ? callsOnlyPlan.name : "Free trial")}
            </p>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {wallet?.subscriptionStatus ?? "free"}
            </p>
          </div>
        </div>

        {billingReady && !canManageBilling ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            You can review the plan ladder here. Only the workspace owner can change the subscription.
          </p>
        ) : null}

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {subscriptionPlans.map((plan) => (
            <WalletPlanCard
              key={plan.name}
              plan={plan}
              isCurrentPlan={plan.planId === wallet?.planId}
              isLoading={loadingAction === `plan:${plan.planId}`}
              billingReady={billingReady}
              canManageBilling={canManageBilling}
              hasAuthToken={Boolean(authToken)}
              onChoosePlan={() =>
                void postStripeAction(
                  "/api/stripe/checkout/subscription",
                  { planId: plan.planId ?? "" },
                  `plan:${plan.planId}`
                )
              }
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-50">Top-up credits</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-400">
          Top-ups are separate from monthly plan credits, roll over, and never expire. They
          cover calls and any Live Guidance or Live Translation beyond your included minutes.
        </p>
        {billingReady && !canBuyCredits ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <p className="min-w-0">
              Buying credits is limited to owners and admins. You can ask them to top up
              the shared wallet.
            </p>
            <button
              type="button"
              onClick={() => void requestCredits()}
              disabled={creditRequestState !== "idle"}
              className="shrink-0 rounded-md bg-amber-900 px-3 py-1.5 text-sm font-semibold text-amber-50 transition hover:bg-amber-800 disabled:opacity-60 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
            >
              {creditRequestState === "sending"
                ? "Asking..."
                : creditRequestState === "sent"
                  ? "Request sent"
                  : "Request credits"}
            </button>
          </div>
        ) : null}
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
          <input
            type="checkbox"
            checked={businessInvoiceRequested}
            onChange={(event) => setBusinessInvoiceOverride(event.target.checked)}
            disabled={!canBuyCredits}
            className="mt-1 h-4 w-4 rounded border-stone-300 text-[#3b1676] focus:ring-violet-200 dark:border-stone-600"
          />
          <span>
            <span className="block font-semibold text-stone-900 dark:text-stone-100">
              Issue business invoice (billing address required)
            </span>
            <span className="block text-stone-500 dark:text-stone-400">
              Stripe will collect and store the billing address during checkout.
            </span>
          </span>
        </label>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {topUpPlans.map((topUp) => (
            <div key={topUp.id} className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <p className="text-2xl font-semibold text-stone-950 dark:text-stone-50">{topUp.label}</p>
              <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">Buys roughly</p>
              <TopUpBuyingPower
                rows={describeTopUpBuyingPower({
                  amountCents: topUp.amountCents,
                  featureRatesCentsPerMinute: topUpFeatureRates,
                })}
              />
              <button
                type="button"
                disabled={!authToken || !canBuyCredits || loadingAction === `topup:${topUp.id}`}
                onClick={() =>
                  void postStripeAction(
                    "/api/stripe/checkout/top-up",
                    { topUpId: topUp.id, businessInvoiceRequested },
                    `topup:${topUp.id}`,
                    "buy_credits"
                  )
                }
                className="mt-5 w-full rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                {loadingAction === `topup:${topUp.id}` ? "Opening..." : "Buy top-up"}
              </button>
            </div>
          ))}
        </div>
        {/* The rows above are one balance shown three ways, not three things
            being bought. Said explicitly because a list of features reads as
            separate wallets, and separate wallets is exactly what Voxandra does
            not do (see the one-credit-balance rule in AGENTS.md). */}
        <p className="mt-3 text-xs leading-5 text-stone-500 dark:text-stone-400">
          One balance, spent on whichever of these you actually use. Calling rates vary by
          destination; live-feature rates are set by your plan.
        </p>

        <div className="mt-4 grid gap-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_auto] md:items-end dark:border-stone-800 dark:bg-stone-900">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">Or enter custom amount</span>
            <span className="text-sm text-stone-500 dark:text-stone-400">
              Minimum {formatCents(CUSTOM_TOP_UP_MIN_CENTS)}. Maximum {formatCents(CUSTOM_TOP_UP_MAX_CENTS)} per checkout.
            </span>
            <span className="flex h-11 max-w-xs items-center rounded-md border border-stone-300 bg-white px-3 focus-within:border-violet-500 focus-within:ring-4 focus-within:ring-violet-100 dark:border-stone-700 dark:bg-stone-800">
              <span className="text-sm font-semibold text-stone-500 dark:text-stone-400">$</span>
              <input
                value={customTopUpAmount}
                onChange={(event) => setCustomTopUpAmount(event.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold text-stone-950 outline-none dark:text-stone-100"
                placeholder="25"
              />
            </span>
            {customTopUpCents === null ? null : (
              <div className="max-w-xs">
                <TopUpBuyingPower
                  rows={describeTopUpBuyingPower({
                    amountCents: customTopUpCents,
                    featureRatesCentsPerMinute: topUpFeatureRates,
                  })}
                />
              </div>
            )}
          </label>
          <button
            type="button"
            disabled={!authToken || !canBuyCredits || loadingAction === "topup:custom"}
            onClick={() => void buyCustomTopUp()}
            className="h-11 rounded-md bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            {loadingAction === "topup:custom" ? "Opening..." : "Buy custom credits"}
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Enable Auto Top-up</h3>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">Avoid interrupting an important call</p>
              <p className="mt-2 text-sm font-medium text-stone-900 dark:text-stone-100">
                Below {formatCents(wallet?.autoTopUpThresholdCents ?? AUTO_TOP_UP_THRESHOLD_CENTS)}, add{" "}
                {formatCents(wallet?.autoTopUpAmountCents ?? AUTO_TOP_UP_AMOUNT_CENTS)}
              </p>
            </div>
            <button
              type="button"
              disabled={!authToken || !canManageBilling || loadingAction === "auto-topup"}
              onClick={() => void toggleAutoTopUp(!autoTopUpEnabled)}
              className={`h-10 rounded-md px-4 text-sm font-semibold transition disabled:opacity-50 ${
                autoTopUpEnabled
                  ? "bg-teal-100 text-teal-800 hover:bg-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-950/60"
                  : "bg-stone-950 text-white hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
              }`}
            >
              {loadingAction === "auto-topup"
                ? "Saving..."
                : autoTopUpEnabled
                  ? "Auto Top-up on"
                  : "Enable Auto Top-up"}
            </button>
          </div>
        </div>
      </section>

      {hasCancelableSubscription ? (
        <div className="mt-2 border-t border-stone-200/70 pt-5 dark:border-stone-800/70">
          <button
            type="button"
            onClick={() => void cancelSubscription()}
            disabled={loadingAction === "cancel-subscription"}
            className="text-sm text-stone-400 underline-offset-4 transition hover:text-stone-600 hover:underline disabled:opacity-50 dark:text-stone-500 dark:hover:text-stone-300"
          >
            {loadingAction === "cancel-subscription" ? "Opening..." : "Cancel subscription"}
          </button>
          <p className="mt-1 text-xs text-stone-400 dark:text-stone-600">
            You&apos;ll keep full access until the end of your current billing period.
          </p>
        </div>
      ) : null}
      </>
      ) : null}

      {activeTab === "overview" ? (
      <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-base font-semibold text-stone-950 dark:text-stone-50">Credit policy</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
          Voxandra spends included monthly credits first, then purchased top-up credits. Calls are blocked before the balance can go negative, and paid connected calls have a 60-second minimum.
        </p>
      </section>
      ) : null}

      {cancelNumber?.id ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-number-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-stone-900">
            <h2 id="cancel-number-title" className="text-lg font-semibold text-stone-950 dark:text-stone-50">
              Cancel rented number?
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
              This will stop the monthly rental for{" "}
              <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">{cancelNumber.phoneNumber}</span>.
              Recipients will no longer see this number on future Voxandra calls.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setCancelNumber(null)}
                className="inline-flex h-10 items-center justify-center rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Keep number
              </button>
              <button
                type="button"
                disabled={loadingAction === `cancel:${cancelNumber.id}`}
                onClick={async () => {
                  await cancelCallingNumber(cancelNumber.id as string);
                  setCancelNumber(null);
                }}
                className="inline-flex h-10 items-center justify-center rounded-md bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 disabled:opacity-50"
              >
                {loadingAction === `cancel:${cancelNumber.id}` ? "Canceling..." : "Cancel rental"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
