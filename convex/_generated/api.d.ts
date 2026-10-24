/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actionItems from "../actionItems.js";
import type * as agentLearning from "../agentLearning.js";
import type * as aiExtraction from "../aiExtraction.js";
import type * as aiExtractionInternal from "../aiExtractionInternal.js";
import type * as aiExtractionRuns from "../aiExtractionRuns.js";
import type * as aiMemories from "../aiMemories.js";
import type * as apiKeys from "../apiKeys.js";
import type * as audioTranscriptionRuns from "../audioTranscriptionRuns.js";
import type * as auth from "../auth.js";
import type * as authHelpers from "../authHelpers.js";
import type * as billingHelpers from "../billingHelpers.js";
import type * as bridgeRecordings from "../bridgeRecordings.js";
import type * as bridgeTranscription from "../bridgeTranscription.js";
import type * as bridgeTranscriptionMutations from "../bridgeTranscriptionMutations.js";
import type * as browserAudioStream from "../browserAudioStream.js";
import type * as callGuidance from "../callGuidance.js";
import type * as callKeypad from "../callKeypad.js";
import type * as callMemorySearch from "../callMemorySearch.js";
import type * as callMemorySearchActions from "../callMemorySearchActions.js";
import type * as callPreparation from "../callPreparation.js";
import type * as callingNumbers from "../callingNumbers.js";
import type * as calls from "../calls.js";
import type * as cases from "../cases.js";
import type * as contacts from "../contacts.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as demoSettings from "../demoSettings.js";
import type * as emailCron from "../emailCron.js";
import type * as emailSender from "../emailSender.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as emails from "../emails.js";
import type * as extractedEntities from "../extractedEntities.js";
import type * as feedback from "../feedback.js";
import type * as http from "../http.js";
import type * as importedTranscripts from "../importedTranscripts.js";
import type * as launchInterest from "../launchInterest.js";
import type * as maintenance from "../maintenance.js";
import type * as maintenanceActions from "../maintenanceActions.js";
import type * as maintenanceShared from "../maintenanceShared.js";
import type * as mcp from "../mcp.js";
import type * as notes from "../notes.js";
import type * as profiles from "../profiles.js";
import type * as realtimeBilling from "../realtimeBilling.js";
import type * as realtimeRuntime from "../realtimeRuntime.js";
import type * as realtimeUsage from "../realtimeUsage.js";
import type * as reminders from "../reminders.js";
import type * as reviewSuggestions from "../reviewSuggestions.js";
import type * as seed from "../seed.js";
import type * as shadowAgent from "../shadowAgent.js";
import type * as shadowAgentRuns from "../shadowAgentRuns.js";
import type * as shadowAgentScoring from "../shadowAgentScoring.js";
import type * as stripeBilling from "../stripeBilling.js";
import type * as team from "../team.js";
import type * as threadIntelligence from "../threadIntelligence.js";
import type * as threads from "../threads.js";
import type * as transcription from "../transcription.js";
import type * as transcriptionMutations from "../transcriptionMutations.js";
import type * as transcripts from "../transcripts.js";
import type * as translationBridge from "../translationBridge.js";
import type * as trialAccess from "../trialAccess.js";
import type * as twilioCalls from "../twilioCalls.js";
import type * as twilioLifecycle from "../twilioLifecycle.js";
import type * as twilioProvider from "../twilioProvider.js";
import type * as twilioRecordings from "../twilioRecordings.js";
import type * as twilioShared from "../twilioShared.js";
import type * as walletSummaries from "../walletSummaries.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actionItems: typeof actionItems;
  agentLearning: typeof agentLearning;
  aiExtraction: typeof aiExtraction;
  aiExtractionInternal: typeof aiExtractionInternal;
  aiExtractionRuns: typeof aiExtractionRuns;
  aiMemories: typeof aiMemories;
  apiKeys: typeof apiKeys;
  audioTranscriptionRuns: typeof audioTranscriptionRuns;
  auth: typeof auth;
  authHelpers: typeof authHelpers;
  billingHelpers: typeof billingHelpers;
  bridgeRecordings: typeof bridgeRecordings;
  bridgeTranscription: typeof bridgeTranscription;
  bridgeTranscriptionMutations: typeof bridgeTranscriptionMutations;
  browserAudioStream: typeof browserAudioStream;
  callGuidance: typeof callGuidance;
  callKeypad: typeof callKeypad;
  callMemorySearch: typeof callMemorySearch;
  callMemorySearchActions: typeof callMemorySearchActions;
  callPreparation: typeof callPreparation;
  callingNumbers: typeof callingNumbers;
  calls: typeof calls;
  cases: typeof cases;
  contacts: typeof contacts;
  crons: typeof crons;
  dashboard: typeof dashboard;
  demoSettings: typeof demoSettings;
  emailCron: typeof emailCron;
  emailSender: typeof emailSender;
  emailTemplates: typeof emailTemplates;
  emails: typeof emails;
  extractedEntities: typeof extractedEntities;
  feedback: typeof feedback;
  http: typeof http;
  importedTranscripts: typeof importedTranscripts;
  launchInterest: typeof launchInterest;
  maintenance: typeof maintenance;
  maintenanceActions: typeof maintenanceActions;
  maintenanceShared: typeof maintenanceShared;
  mcp: typeof mcp;
  notes: typeof notes;
  profiles: typeof profiles;
  realtimeBilling: typeof realtimeBilling;
  realtimeRuntime: typeof realtimeRuntime;
  realtimeUsage: typeof realtimeUsage;
  reminders: typeof reminders;
  reviewSuggestions: typeof reviewSuggestions;
  seed: typeof seed;
  shadowAgent: typeof shadowAgent;
  shadowAgentRuns: typeof shadowAgentRuns;
  shadowAgentScoring: typeof shadowAgentScoring;
  stripeBilling: typeof stripeBilling;
  team: typeof team;
  threadIntelligence: typeof threadIntelligence;
  threads: typeof threads;
  transcription: typeof transcription;
  transcriptionMutations: typeof transcriptionMutations;
  transcripts: typeof transcripts;
  translationBridge: typeof translationBridge;
  trialAccess: typeof trialAccess;
  twilioCalls: typeof twilioCalls;
  twilioLifecycle: typeof twilioLifecycle;
  twilioProvider: typeof twilioProvider;
  twilioRecordings: typeof twilioRecordings;
  twilioShared: typeof twilioShared;
  walletSummaries: typeof walletSummaries;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
