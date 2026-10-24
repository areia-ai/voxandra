import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspaceMembership } from "./authHelpers";

const MAX_LABEL_LENGTH = 60;
const MAX_ACTIVE_KEYS_PER_PROFILE = 5;
const MAX_ACTIVE_KEYS_PER_WORKSPACE = 25;
const KEY_PREFIX_LENGTH = 12;

const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function generateApiKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let encoded = "";
  for (const byte of bytes) {
    encoded += BASE62_ALPHABET[byte % BASE62_ALPHABET.length];
  }
  return `vx_${encoded}`;
}

function canManageOthersKeys(role: string) {
  return role === "owner" || role === "admin";
}

export const createApiKey = mutation({
  args: {
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireWorkspaceMembership(ctx);

    const label = args.label.trim().slice(0, MAX_LABEL_LENGTH);
    if (!label) {
      throw new Error("Enter a name for this key.");
    }

    const workspaceKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", access.workspaceId)
      )
      .collect();
    const activeWorkspaceKeys = workspaceKeys.filter((key) => !key.revokedAt);
    if (activeWorkspaceKeys.length >= MAX_ACTIVE_KEYS_PER_WORKSPACE) {
      throw new Error(
        "This workspace has reached its API key limit. Revoke unused keys first."
      );
    }
    const activeOwnKeys = activeWorkspaceKeys.filter(
      (key) => key.profileId === access.profile._id
    );
    if (activeOwnKeys.length >= MAX_ACTIVE_KEYS_PER_PROFILE) {
      throw new Error(
        "You have reached your API key limit. Revoke unused keys first."
      );
    }

    const plaintextKey = generateApiKey();
    const keyHash = await sha256(plaintextKey);
    const keyPrefix = plaintextKey.slice(0, KEY_PREFIX_LENGTH);
    const createdAt = Date.now();

    const keyId = await ctx.db.insert("apiKeys", {
      workspaceId: access.workspaceId,
      profileId: access.profile._id,
      userId: access.userId,
      label,
      keyHash,
      keyPrefix,
      scopes: ["read"],
      createdAt,
    });

    // The only moment the plaintext key exists outside the caller's clipboard.
    return { keyId, plaintextKey, keyPrefix, label, createdAt };
  },
});

export const listWorkspaceApiKeys = query({
  args: {},
  handler: async (ctx) => {
    const access = await requireWorkspaceMembership(ctx);
    const seeAll = canManageOthersKeys(access.membership.role);

    const keys = seeAll
      ? await ctx.db
          .query("apiKeys")
          .withIndex("by_workspace", (q) =>
            q.eq("workspaceId", access.workspaceId)
          )
          .collect()
      : await ctx.db
          .query("apiKeys")
          .withIndex("by_profile", (q) => q.eq("profileId", access.profile._id))
          .collect();

    const rows = await Promise.all(
      keys
        .filter((key) => key.workspaceId === access.workspaceId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (key) => {
          const mine = key.profileId === access.profile._id;
          let createdByEmail: string | undefined;
          if (seeAll && !mine) {
            const profile = await ctx.db.get(key.profileId);
            createdByEmail = profile?.email;
          }
          return {
            keyId: key._id,
            label: key.label,
            keyPrefix: key.keyPrefix,
            createdAt: key.createdAt,
            lastUsedAt: key.lastUsedAt,
            revoked: Boolean(key.revokedAt),
            mine,
            createdByEmail,
          };
        })
    );
    return rows;
  },
});

export const revokeApiKey = mutation({
  args: {
    keyId: v.id("apiKeys"),
  },
  handler: async (ctx, args) => {
    const access = await requireWorkspaceMembership(ctx);
    const key = await ctx.db.get(args.keyId);
    if (!key || key.workspaceId !== access.workspaceId) {
      throw new Error("API key not found.");
    }
    const mine = key.profileId === access.profile._id;
    if (!mine && !canManageOthersKeys(access.membership.role)) {
      throw new Error("You can only revoke your own API keys.");
    }
    if (key.revokedAt) {
      return { ok: true };
    }
    await ctx.db.patch(args.keyId, { revokedAt: Date.now() });
    return { ok: true };
  },
});
