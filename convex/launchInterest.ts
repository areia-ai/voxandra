import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function assertLaunchInterestSecret(secret: string) {
  const expected = process.env.LAUNCH_INTEREST_CONVEX_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized launch interest request");
  }
}

function normalizeOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
}

function csvCell(value: string | number | undefined) {
  const text = value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function isoTime(value: number | undefined) {
  return value ? new Date(value).toISOString() : "";
}

const optionalShortString = v.optional(v.string());

export const recordSignup = mutation({
  args: {
    secret: v.string(),
    email: v.string(),
    roleSegment: optionalShortString,
    roleSegmentOther: optionalShortString,
    companyType: optionalShortString,
    companyTypeOther: optionalShortString,
    useCase: optionalShortString,
    useCaseOther: optionalShortString,
    source: optionalShortString,
    utmSource: optionalShortString,
    utmMedium: optionalShortString,
    utmCampaign: optionalShortString,
    utmTerm: optionalShortString,
    utmContent: optionalShortString,
    consentTextVersion: v.string(),
    consentedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertLaunchInterestSecret(args.secret);

    const email = args.email.trim().toLowerCase();
    const now = Date.now();
    const existing = await ctx.db
      .query("launchInterestSignups")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    const patch = {
      roleSegment: normalizeOptional(args.roleSegment),
      roleSegmentOther: normalizeOptional(args.roleSegmentOther),
      companyType: normalizeOptional(args.companyType),
      companyTypeOther: normalizeOptional(args.companyTypeOther),
      useCase: normalizeOptional(args.useCase),
      useCaseOther: normalizeOptional(args.useCaseOther),
      source: normalizeOptional(args.source),
      utmSource: normalizeOptional(args.utmSource),
      utmMedium: normalizeOptional(args.utmMedium),
      utmCampaign: normalizeOptional(args.utmCampaign),
      utmTerm: normalizeOptional(args.utmTerm),
      utmContent: normalizeOptional(args.utmContent),
      consentTextVersion: args.consentTextVersion,
      consentedAt: args.consentedAt,
      status: "active" as const,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...patch,
        submissionCount: existing.submissionCount + 1,
      });
      return { status: "updated" as const };
    }

    await ctx.db.insert("launchInterestSignups", {
      email,
      ...patch,
      submissionCount: 1,
      createdAt: now,
    });

    return { status: "created" as const };
  },
});

export const exportCsv = query({
  args: {
    secret: v.string(),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("unsubscribed"),
      v.literal("blocked")
    )),
  },
  handler: async (ctx, args) => {
    assertLaunchInterestSecret(args.secret);

    const status = args.status ?? "active";
    const rows = await ctx.db
      .query("launchInterestSignups")
      .withIndex("by_status_created", (q) => q.eq("status", status))
      .collect();

    const header = [
      "email",
      "roleSegment",
      "roleSegmentOther",
      "companyType",
      "companyTypeOther",
      "useCase",
      "useCaseOther",
      "source",
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmTerm",
      "utmContent",
      "consentTextVersion",
      "consentedAt",
      "status",
      "submissionCount",
      "createdAt",
      "updatedAt",
    ];
    const lines = rows.map((row) =>
      [
        row.email,
        row.roleSegment,
        row.roleSegmentOther,
        row.companyType,
        row.companyTypeOther,
        row.useCase,
        row.useCaseOther,
        row.source,
        row.utmSource,
        row.utmMedium,
        row.utmCampaign,
        row.utmTerm,
        row.utmContent,
        row.consentTextVersion,
        isoTime(row.consentedAt),
        row.status,
        row.submissionCount,
        isoTime(row.createdAt),
        isoTime(row.updatedAt),
      ].map(csvCell).join(",")
    );

    return [header.map(csvCell).join(","), ...lines].join("\n");
  },
});
