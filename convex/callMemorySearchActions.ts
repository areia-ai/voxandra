"use node";

import OpenAI from "openai";
import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_OPENAI_MODEL } from "../src/lib/ai/extraction-prompt";

const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_ASK_LIMIT = 8;

const sourceTypeValidator = v.union(
  v.literal("overview"),
  v.literal("transcript"),
  v.literal("details"),
  v.literal("follow_up"),
  v.literal("user_notes")
);

const askFiltersValidator = v.optional(
  v.object({
    contactId: v.optional(v.id("contacts")),
    caseId: v.optional(v.id("cases")),
    sourceTypes: v.optional(v.array(sourceTypeValidator)),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    hasReminder: v.optional(v.boolean()),
    processingStatus: v.optional(v.string()),
    reviewStatus: v.optional(v.string()),
  })
);

type RetrievedDoc = {
  _id: Id<"callMemorySearchDocs">;
  callId: Id<"calls">;
  title: string;
  body: string;
  snippet: string;
  sourceType: "overview" | "transcript" | "details" | "follow_up" | "user_notes";
  anchor: string;
  callStartedAt: string;
  keywordRank?: number;
  vectorScore?: number;
};

type PendingEmbeddingDoc = RetrievedDoc & {
  bodyHash: string;
};

function openAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function embeddingConfig() {
  const model = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const dimensions = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS || EMBEDDING_DIMENSIONS);
  if (dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(`OPENAI_EMBEDDING_DIMENSIONS must be ${EMBEDDING_DIMENSIONS} for the Convex vector index.`);
  }
  return { model, dimensions };
}

function getOutputText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  if ("output_text" in response && typeof response.output_text === "string") {
    return response.output_text;
  }
  const output = "output" in response ? response.output : null;
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || !("content" in item)) return [];
      const content = item.content;
      if (!Array.isArray(content)) return [];
      return content.map((part) => {
        if (!part || typeof part !== "object") return "";
        if ("text" in part && typeof part.text === "string") return part.text;
        return "";
      });
    })
    .join("");
}

function citationForDoc(doc: RetrievedDoc, index: number) {
  return {
    index,
    id: doc._id,
    callId: doc.callId,
    title: doc.title,
    snippet: doc.snippet,
    sourceType: doc.sourceType,
    href: `/app/calls/${doc.callId}${doc.anchor}`,
    callStartedAt: doc.callStartedAt,
  };
}

function mergeRetrievedDocs(keywordDocs: RetrievedDoc[], vectorDocs: RetrievedDoc[]) {
  const merged = new Map<string, RetrievedDoc & { retrievalScore: number }>();

  for (const doc of keywordDocs) {
    const key = String(doc._id);
    const rankScore = 1 / Math.max(doc.keywordRank ?? 1, 1);
    merged.set(key, { ...doc, retrievalScore: 0.6 + rankScore });
  }

  for (const doc of vectorDocs) {
    const key = String(doc._id);
    const current = merged.get(key);
    const vectorScore = doc.vectorScore ?? 0;
    if (current) {
      current.vectorScore = vectorScore;
      current.retrievalScore += vectorScore;
      continue;
    }
    merged.set(key, { ...doc, retrievalScore: vectorScore });
  }

  return Array.from(merged.values())
    .sort((a, b) => b.retrievalScore - a.retrievalScore)
    .slice(0, DEFAULT_ASK_LIMIT);
}

function fallbackNoEvidenceAnswer() {
  return "I could not find enough evidence in your Call Records to answer that. Try a narrower question with a contact, reference number, supplier, or follow-up topic.";
}

export const embedPendingCallMemoryDocs: ReturnType<typeof internalAction> = internalAction({
  args: {
    callId: v.optional(v.id("calls")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const docs = (await ctx.runQuery(internal.callMemorySearch.listPendingEmbeddingDocs, {
      callId: args.callId,
      limit: args.limit,
    })) as PendingEmbeddingDoc[];
    if (docs.length === 0) return { embedded: 0 };

    const openai = openAIClient();
    if (!openai) {
      throw new Error("OpenAI API key is not configured.");
    }

    const { model, dimensions } = embeddingConfig();
    try {
      const response = await openai.embeddings.create({
        model,
        dimensions,
        input: docs.map((doc) => doc.body),
      });

      let embedded = 0;
      for (const [index, doc] of docs.entries()) {
        const embedding = response.data[index]?.embedding;
        if (!embedding) continue;
        await ctx.runMutation(internal.callMemorySearch.upsertCallMemoryEmbedding, {
          searchDocId: doc._id,
          model,
          dimensions,
          embedding,
          contentHash: doc.bodyHash,
        });
        embedded += 1;
      }
      return { embedded };
    } catch (error) {
      await ctx.runMutation(internal.callMemorySearch.markCallMemoryEmbeddingFailed, {
        searchDocIds: docs.map((doc) => doc._id),
        errorMessage: error instanceof Error ? error.message : "Embedding failed.",
      });
      throw error;
    }
  },
});

export const backfillCurrentWorkspaceCallMemorySearch: ReturnType<typeof action> = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const callIds = await ctx.runQuery(
      internal.callMemorySearch.listSearchableCallIdsForCurrentWorkspace,
      { limit: args.limit }
    );
    let refreshed = 0;
    let changed = 0;
    for (const callId of callIds) {
      const result = await ctx.runMutation(
        internal.callMemorySearch.refreshCallMemorySearchDocsForCallInternal,
        { callId }
      );
      refreshed += 1;
      if (result.changed) changed += 1;
    }
    return { refreshed, changed };
  },
});

export const askCallRecords: ReturnType<typeof action> = action({
  args: {
    question: v.string(),
    filters: askFiltersValidator,
  },
  handler: async (ctx, args) => {
    const question = args.question.replace(/\s+/g, " ").trim().slice(0, 500);
    if (question.length < 4) {
      return {
        answer: "Ask a more specific question about your Call Records.",
        citations: [],
        retrievalMode: "none",
      };
    }

    const workspaceId = await ctx.runQuery(
      internal.callMemorySearch.getCurrentWorkspaceForSearchAction,
      {}
    );
    const keywordDocs = await ctx.runQuery(internal.callMemorySearch.searchCallMemoryDocsInternal, {
      search: question,
      limit: 12,
      ...(args.filters ?? {}),
    });

    const openai = openAIClient();
    if (!openai) {
      return {
        answer: "Ask records is not configured because the OpenAI API key is missing.",
        citations: keywordDocs.slice(0, 3).map((doc, index) => citationForDoc(doc, index + 1)),
        retrievalMode: "keyword",
      };
    }

    const { model: embeddingModel, dimensions } = embeddingConfig();
    const embeddingResponse = await openai.embeddings.create({
      model: embeddingModel,
      dimensions,
      input: question,
    });
    const queryEmbedding = embeddingResponse.data[0]?.embedding;

    const vectorDocs = queryEmbedding
      ? await ctx.runQuery(internal.callMemorySearch.getSearchDocsForVectorResults, {
          results: (
            await ctx.vectorSearch("callMemoryEmbeddings", "by_embedding", {
              vector: queryEmbedding,
              limit: 16,
              filter: (q) => q.eq("workspaceId", workspaceId),
            })
          ).map((result) => ({
            embeddingId: result._id,
            score: result._score,
          })),
        })
      : [];

    const retrievedDocs = mergeRetrievedDocs(keywordDocs, vectorDocs);
    if (retrievedDocs.length === 0) {
      return {
        answer: fallbackNoEvidenceAnswer(),
        citations: [],
        retrievalMode: "hybrid",
      };
    }

    const evidence = retrievedDocs
      .map((doc, index) => {
        return [
          `[${index + 1}] ${doc.title}`,
          `Date: ${doc.callStartedAt}`,
          `Section: ${doc.sourceType}`,
          `Evidence: ${doc.body.slice(0, 1400)}`,
        ].join("\n");
      })
      .join("\n\n");

    const answerModel = process.env.OPENAI_CALL_MEMORY_ASK_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    const response = await openai.responses.create({
      model: answerModel,
      input: [
        {
          role: "system",
          content:
            "You answer questions about Voxandra Call Records. Use only the provided evidence. Cite every factual claim with bracketed source numbers like [1]. If the evidence is insufficient, say you could not find enough evidence. Do not infer beyond the evidence.",
        },
        {
          role: "user",
          content: `Question:\n${question}\n\nEvidence:\n${evidence}`,
        },
      ],
    });

    let answer = getOutputText(response).trim();
    if (!answer) answer = fallbackNoEvidenceAnswer();
    if (retrievedDocs.length > 0 && !/\[\d+\]/.test(answer) && !answer.toLowerCase().includes("not find enough evidence")) {
      answer = `${answer}\n\nSources: ${retrievedDocs
        .slice(0, 3)
        .map((_, index) => `[${index + 1}]`)
        .join(" ")}`;
    }

    return {
      answer,
      citations: retrievedDocs.map((doc, index) => citationForDoc(doc, index + 1)),
      retrievalMode: "hybrid",
    };
  },
});
