import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConvexError } from "convex/values";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { MCP_SERVER_VERSION, SERVER_INSTRUCTIONS } from "./tools-list";

export { MCP_SERVER_VERSION, SERVER_INSTRUCTIONS };

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function hashApiKey(plaintextKey: string) {
  return createHash("sha256").update(plaintextKey, "utf8").digest("hex");
}

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "This request could not be authorized.",
  invalid_key: "This API key is invalid or was revoked.",
  rate_limited: "Rate limit exceeded — retry in a moment.",
  not_found: "Not found in this workspace.",
};

export function sanitizeMcpError(caught: unknown): string {
  if (caught instanceof ConvexError) {
    const code =
      typeof caught.data === "object" && caught.data !== null
        ? (caught.data as { code?: string }).code
        : undefined;
    if (code && KNOWN_ERROR_MESSAGES[code]) {
      return KNOWN_ERROR_MESSAGES[code];
    }
  }
  const raw = caught instanceof Error ? caught.message : "";
  if (!raw) return "Voxandra request failed.";
  const sanitized = raw
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "[secret]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\b[A-Z][A-Z0-9_]{8,}\b/g, "[redacted]")
    .slice(0, 300);
  return sanitized || "Voxandra request failed.";
}

type McpAuth = {
  convex: ConvexHttpClient;
  secret: string;
  keyHash: string;
};

export function buildVoxandraMcpServer({ convex, secret, keyHash }: McpAuth) {
  const server = new McpServer(
    {
      name: "voxandra",
      title: "Voxandra Call Records",
      version: MCP_SERVER_VERSION,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  const guard = { secret, keyHash };

  function toToolResult(result: unknown) {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  }

  function toToolError(caught: unknown) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: sanitizeMcpError(caught) }],
    };
  }

  server.registerTool(
    "search_call_records",
    {
      title: "Search call records",
      description:
        "Full-text search across call record notes, transcripts, extracted details, follow-ups, and user notes. " +
        "Returns snippets with callIds — use get_call_record for full content. " +
        "Omit search to list the most recent records instead.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        search: z.string().optional().describe("Full-text search query"),
        contactId: z.string().optional().describe("Only records for this contact"),
        threadId: z.string().optional().describe("Only records in this work thread"),
        sourceTypes: z
          .array(
            z.enum(["overview", "transcript", "details", "follow_up", "user_notes"])
          )
          .optional()
          .describe("Restrict which parts of a record are searched"),
        dateFrom: z.string().optional().describe("ISO date lower bound"),
        dateTo: z.string().optional().describe("ISO date upper bound"),
        hasReminder: z.boolean().optional(),
        limit: z.number().int().min(1).max(60).optional(),
      },
    },
    async (args) => {
      try {
        const result = await convex.query(api.mcp.mcpSearchCallRecords, {
          ...guard,
          ...args,
        });
        return toToolResult(result);
      } catch (caught) {
        return toToolError(caught);
      }
    }
  );

  server.registerTool(
    "get_call_record",
    {
      title: "Get a call record",
      description:
        "Fetch one complete call record: AI note, full transcript, extracted details, action items, reminders, contact, and work thread.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        callId: z.string().describe("The call record id"),
      },
    },
    async (args) => {
      try {
        const result = await convex.query(api.mcp.mcpGetCallRecord, {
          ...guard,
          callId: args.callId,
        });
        return toToolResult(result);
      } catch (caught) {
        return toToolError(caught);
      }
    }
  );

  server.registerTool(
    "list_call_records",
    {
      title: "List call records",
      description:
        "List recent call records newest-first with summary snippets. Supports a text filter and with_reminders / processing filters.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        search: z.string().optional(),
        filter: z.enum(["all", "with_reminders", "processing"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => {
      try {
        const result = await convex.query(api.mcp.mcpListCallRecords, {
          ...guard,
          ...args,
        });
        return toToolResult(result);
      } catch (caught) {
        return toToolError(caught);
      }
    }
  );

  server.registerTool(
    "list_reminders",
    {
      title: "List reminders",
      description:
        "List workspace reminders, optionally filtered by status, sorted by remind-at time.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        status: z
          .enum(["upcoming", "overdue", "in_progress", "completed"])
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => {
      try {
        const result = await convex.query(api.mcp.mcpListReminders, {
          ...guard,
          ...args,
        });
        return toToolResult(result);
      } catch (caught) {
        return toToolError(caught);
      }
    }
  );

  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description: "List or search workspace contacts by name or phone number.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        search: z.string().optional().describe("Name or phone number"),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => {
      try {
        const result = await convex.query(api.mcp.mcpListContacts, {
          ...guard,
          ...args,
        });
        return toToolResult(result);
      } catch (caught) {
        return toToolError(caught);
      }
    }
  );

  server.registerTool(
    "list_threads",
    {
      title: "List work threads",
      description:
        "List active work threads (ongoing multi-call workstreams) with open follow-up counts.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => {
      try {
        const result = await convex.query(api.mcp.mcpListThreads, {
          ...guard,
          ...args,
        });
        return toToolResult(result);
      } catch (caught) {
        return toToolError(caught);
      }
    }
  );

  server.registerTool(
    "get_thread",
    {
      title: "Get a work thread",
      description:
        "Full intelligence for one work thread: open and overdue commitments, key facts, repeated blockers, and a suggested next objective.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        threadId: z.string().describe("The work thread id"),
      },
    },
    async (args) => {
      try {
        const result = await convex.query(api.mcp.mcpGetThread, {
          ...guard,
          threadId: args.threadId,
        });
        return toToolResult(result);
      } catch (caught) {
        return toToolError(caught);
      }
    }
  );

  server.registerTool(
    "pre_call_brief",
    {
      title: "Pre-call brief",
      description:
        "Prepare for a call: recent related calls, open follow-ups, key extracted facts, and lessons from similar reviewed calls for a phone number, contact, or thread.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        phoneNumber: z.string().optional(),
        contactId: z.string().optional(),
        threadId: z.string().optional(),
        objective: z.string().optional().describe("What the call should achieve"),
      },
    },
    async (args) => {
      try {
        const result = await convex.query(api.mcp.mcpPreCallBrief, {
          ...guard,
          ...args,
        });
        return toToolResult(result);
      } catch (caught) {
        return toToolError(caught);
      }
    }
  );

  return server;
}
