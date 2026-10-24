import type { Doc } from "../../convex/_generated/dataModel";

export function mapDoc<T extends { _id: string }>(
  doc: T
): Omit<T, "_id" | "_creationTime"> & { id: string } {
  const { _id, _creationTime, ...rest } = doc as unknown as Record<
    string,
    unknown
  >;
  void _creationTime;
  return { ...rest, id: _id } as unknown as Omit<T, "_id" | "_creationTime"> & {
    id: string;
  };
}

export function mapDocs<T extends { _id: string }>(docs: T[]) {
  return docs.map(mapDoc);
}

export type MappedCall = ReturnType<typeof mapDoc<Doc<"calls">>>;
export type MappedCase = ReturnType<typeof mapDoc<Doc<"cases">>>;
export type MappedContact = ReturnType<typeof mapDoc<Doc<"contacts">>>;
export type MappedReminder = ReturnType<typeof mapDoc<Doc<"reminders">>>;
export type MappedActionItem = ReturnType<typeof mapDoc<Doc<"actionItems">>>;
export type MappedTranscript = ReturnType<typeof mapDoc<Doc<"transcripts">>>;
export type MappedAIMemory = ReturnType<typeof mapDoc<Doc<"aiMemories">>>;
export type MappedExtractedEntity = ReturnType<
  typeof mapDoc<Doc<"extractedEntities">>
>;
export type MappedReviewSuggestion = ReturnType<
  typeof mapDoc<Doc<"reviewSuggestions">>
>;
export type MappedWalletSummary = ReturnType<
  typeof mapDoc<Doc<"walletSummaries">>
>;
export type MappedWorkspace = ReturnType<typeof mapDoc<Doc<"workspaces">>>;
export type MappedProfile = ReturnType<typeof mapDoc<Doc<"profiles">>>;
