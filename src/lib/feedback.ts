import type { BillingPlanId } from "./billing/config";

export const FEEDBACK_PAID_PLAN_IDS = ["solo", "starter", "team", "operations"] as const;
export const FEEDBACK_ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;

export const FEEDBACK_CATEGORIES = [
  "Call Memory",
  "Calling",
  "Billing & credits",
  "Team workflows",
  "Live AI",
  "Other",
] as const;

export const FEEDBACK_STATUSES = ["open", "planned", "building", "shipped", "closed"] as const;
export const FEEDBACK_SORTS = ["top", "new", "my_votes"] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackSort = (typeof FEEDBACK_SORTS)[number];

const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  "Call Memory": "Call Records",
  Calling: "Calling",
  "Billing & credits": "Billing & credits",
  "Team workflows": "Team workflows",
  "Live AI": "Live Guidance",
  Other: "Other",
};

const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "Open",
  planned: "Planned",
  building: "Building",
  shipped: "Shipped",
  closed: "Closed",
};

export function isFeedbackPaidPlanId(planId: string | null | undefined): planId is BillingPlanId {
  return FEEDBACK_PAID_PLAN_IDS.includes(planId as (typeof FEEDBACK_PAID_PLAN_IDS)[number]);
}

export function canParticipateInFeedback(args: {
  planId: string | null | undefined;
  subscriptionStatus: string | null | undefined;
}) {
  return (
    isFeedbackPaidPlanId(args.planId) &&
    FEEDBACK_ACTIVE_SUBSCRIPTION_STATUSES.includes(
      args.subscriptionStatus as (typeof FEEDBACK_ACTIVE_SUBSCRIPTION_STATUSES)[number]
    )
  );
}

export function feedbackStatusLabel(status: FeedbackStatus) {
  return FEEDBACK_STATUS_LABELS[status] ?? "Open";
}

export function feedbackCategoryLabel(category: FeedbackCategory) {
  return FEEDBACK_CATEGORY_LABELS[category] ?? category;
}

export function feedbackCustomerMessage(message: string | null | undefined) {
  if (!message) return "";
  return message
    .replaceAll("Call Memory plan", "paid plan")
    .replaceAll("Call Memory subscription", "Copilot subscription")
    .replaceAll("Call Memory workspace", "Copilot workspace")
    .replaceAll("Call Memory", "Call Records")
    .replaceAll("Live AI", "Live Guidance");
}
