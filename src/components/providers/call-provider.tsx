"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { captureProductEvent } from "@/lib/analytics";
import { TranslationAudioClient } from "@/lib/realtime/translation-audio-client";
import type { Id } from "@convex/_generated/dataModel";

export type CallPhase =
  | "idle"
  | "connecting"
  | "ringing"
  | "in_call"
  | "processing"
  | "completed"
  | "failed";

type TwilioDevice = InstanceType<typeof import("@twilio/voice-sdk").Device>;
type TwilioCall = import("@twilio/voice-sdk").Call;
type TwilioDisconnectConnection = { error?: { message?: string; code?: number | string } };
type TwilioCallError = Error & {
  code?: number;
  callSid?: string;
  connection?: { parameters?: unknown };
};

export type NetworkQuality = "unknown" | "good" | "fair" | "poor";
export type AudioDeviceOption = { deviceId: string; label: string };

export type GlobalCallState = {
  phase: CallPhase;
  displayName: string;
  phoneNumber: string;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  muted: boolean;
  isFreeCall: boolean;
  twilioError: string;
  micPermission: "unknown" | "granted" | "denied";
  currentCallId: Id<"calls"> | null;
  currentCallMaxSeconds: number | null;
  networkQuality: NetworkQuality;
  inputDevices: AudioDeviceOption[];
  outputDevices: AudioDeviceOption[];
  selectedInputDeviceId: string | null;
  selectedOutputDeviceId: string | null;
};

export type StartCallParams = {
  phoneNumber: string;
  displayName: string;
  contactId?: Id<"contacts">;
  objective?: string;
  checklistItems?: string[];
  workflowTemplateKey: string;
  callRecordLanguagePreference: string;
  enableLiveCopilot: boolean;
  enableTranslatedCaptions: boolean;
  enableSpokenTranslation?: boolean;
  /** Real two-leg translation bridge (internal-only, single-workspace test,
   * sub-phase 5b — see AGENTIC_FUTURE.md). */
  enableBridgeMode?: boolean;
  callerTranslatedVoice?: "male" | "female";
  calledPersonTranslatedVoice?: "male" | "female";
  translatedCaptionsSourceLanguage?: string;
  translatedCaptionsTargetLanguage?: string;
  callerIdId?: Id<"callingNumbers">;
  isFreeCall?: boolean;
  /** Called on disconnect while the caller that started this call is still mounted. Falls back to routing to the call record. */
  onCallEnd?: (callId: string) => void;
};

const idleState: GlobalCallState = {
  phase: "idle",
  displayName: "",
  phoneNumber: "",
  elapsedSeconds: 0,
  remainingSeconds: null,
  muted: false,
  isFreeCall: false,
  twilioError: "",
  micPermission: "unknown",
  currentCallId: null,
  currentCallMaxSeconds: null,
  networkQuality: "unknown",
  inputDevices: [],
  outputDevices: [],
  selectedInputDeviceId: null,
  selectedOutputDeviceId: null,
};

const friendlyMessages: Record<number, string> = {
  13227: "This destination is not enabled for Voxandra calling.",
  21210: "This workspace does not have permission to call this number.",
  21215: "The destination phone number is invalid. Please check the number and try again.",
  21217: "The caller ID is invalid. Please choose another calling number.",
};

/** Twilio Call warning names that most directly indicate a degraded connection for the user. */
const CRITICAL_WARNINGS = new Set(["high-packet-loss", "low-mos", "high-jitter", "high-rtt"]);
const TERMINAL_CALL_STATUSES = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

type CallContextValue = {
  call: GlobalCallState;
  startCall: (params: StartCallParams) => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
  setInputDevice: (deviceId: string) => Promise<void>;
  setOutputDevice: (deviceId: string) => Promise<void>;
  requestMicrophonePermission: () => Promise<void>;
  resetCallState: () => void;
};

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const authToken = useAuthToken();
  const createTwilioSession = useMutation(api.twilioCalls.createOutboundSession);
  const cancelOutboundSession = useMutation(api.twilioCalls.cancelOutboundSession);
  const recordKeypadPress = useMutation(api.callKeypad.recordKeypadPress);

  const [call, setCall] = useState<GlobalCallState>(idleState);
  const activeServerCall = useQuery(
    api.calls.getCallById,
    call.currentCallId ? { id: call.currentCallId } : "skip"
  );
  const twilioDevice = useRef<TwilioDevice | null>(null);
  const twilioCall = useRef<TwilioCall | null>(null);
  const startingCall = useRef(false);
  // Live Audio Translation (internal-only, single-workspace test — see
  // AGENTIC_FUTURE.md): plays translated speech alongside the normal call
  // audio. No ducking yet — a known first-cut rough edge, not a bug.
  const translationAudioClient = useRef<TranslationAudioClient | null>(null);
  const timers = useRef<number[]>([]);
  const onCallEndRef = useRef<((callId: string) => void) | undefined>(undefined);
  const activeWarnings = useRef<Set<string>>(new Set());
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    async function refreshDevices() {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCall((value) => ({
        ...value,
        inputDevices: devices
          .filter((device) => device.kind === "audioinput")
          .map((device) => ({ deviceId: device.deviceId, label: device.label || "Microphone" })),
        outputDevices: devices
          .filter((device) => device.kind === "audiooutput")
          .map((device) => ({ deviceId: device.deviceId, label: device.label || "Speaker" })),
      }));
    }

    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      twilioCall.current?.disconnect();
      twilioDevice.current?.destroy();
      translationAudioClient.current?.disconnect();
      translationAudioClient.current = null;
    },
    []
  );

  useEffect(() => {
    if (call.phase !== "in_call") return;
    const interval = window.setInterval(() => {
      setCall((value) => ({ ...value, elapsedSeconds: value.elapsedSeconds + 1 }));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [call.phase]);

  useEffect(() => {
    if (
      call.phase !== "processing" ||
      !activeServerCall ||
      !TERMINAL_CALL_STATUSES.has(activeServerCall.status)
    ) {
      return;
    }
    setCall((value) =>
      value.phase === "processing" && value.currentCallId === activeServerCall._id
        ? { ...value, phase: "completed", networkQuality: "unknown" }
        : value
    );
  }, [activeServerCall, call.phase]);

  const queue = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timers.current.push(timer);
  }, []);

  const requestMicrophonePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not expose microphone permissions.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    setCall((value) => ({ ...value, micPermission: "granted" }));
  }, []);

  const fetchTwilioToken = useCallback(
    async (session?: { callId: string; sessionToken: string }) => {
      if (!authToken) throw new Error("Not authenticated. Please sign in again.");
      const response = await fetch("/api/twilio/token", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(session ?? {}),
      });
      const body = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !body.token) {
        throw new Error(body.error || "Could not create a browser calling token.");
      }
      return body.token;
    },
    [authToken]
  );

  const attemptAutoTopUpBeforeCall = useCallback(async () => {
    if (!authToken) throw new Error("Not authenticated. Please sign in again.");
    const response = await fetch("/api/stripe/auto-top-up/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const body = (await response.json().catch(() => ({}))) as { charged?: boolean; error?: string };
    if (!response.ok) {
      throw new Error(body.error || "Auto Top-up failed. Add credits manually before calling.");
    }
    return body;
  }, [authToken]);

  function shouldTryAutoTopUp(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("Insufficient calling credits") ||
      message.includes("Add calling credits before placing calls")
    );
  }

  const clearPendingHandoff = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    onCallEndRef.current = undefined;
  }, []);

  const resetCallState = useCallback(() => {
    clearPendingHandoff();
    setCall(idleState);
  }, [clearPendingHandoff]);

  const finishCall = useCallback(
    (callId: string) => {
      // Only honor the page-local callback (e.g. the dashboard's inline handoff) if that page
      // is still mounted; otherwise route to the call record so the result is never lost.
      if (onCallEndRef.current && pathnameRef.current === "/app") {
        onCallEndRef.current(callId);
      } else {
        router.push(`/app/calls/${callId}`);
      }
    },
    [router]
  );

  const startCall = useCallback(
    async (params: StartCallParams) => {
      if (startingCall.current || (call.phase !== "idle" && call.phase !== "failed" && call.phase !== "completed")) return;
      startingCall.current = true;

      clearPendingHandoff();
      onCallEndRef.current = params.onCallEnd;
      activeWarnings.current = new Set();
      setCall({
        ...idleState,
        phase: "connecting",
        displayName: params.displayName,
        phoneNumber: params.phoneNumber,
        micPermission: call.micPermission,
        inputDevices: call.inputDevices,
        outputDevices: call.outputDevices,
        selectedInputDeviceId: call.selectedInputDeviceId,
        selectedOutputDeviceId: call.selectedOutputDeviceId,
      });

      let pendingSession:
        | { callId: Id<"calls">; sessionToken: string }
        | undefined;
      const releaseUnconnectedSession = () => {
        if (!pendingSession) return;
        void cancelOutboundSession(pendingSession).catch(() => {});
      };

      try {
        await requestMicrophonePermission();

        const isFreeCall = params.isFreeCall === true;
        const sessionArgs = {
          phoneNumber: params.phoneNumber,
          contactId: params.contactId,
          objective: params.objective || undefined,
          checklistItems:
            params.checklistItems && params.checklistItems.length > 0
              ? params.checklistItems
              : undefined,
          workflowTemplateKey: params.workflowTemplateKey,
          callRecordLanguagePreference: params.callRecordLanguagePreference,
          enableLiveCopilot: params.enableLiveCopilot,
          enableTranslatedCaptions: params.enableTranslatedCaptions,
          enableSpokenTranslation: params.enableTranslatedCaptions
            ? params.enableSpokenTranslation
            : undefined,
          enableBridgeMode: params.enableTranslatedCaptions
            ? params.enableBridgeMode
            : undefined,
          callerTranslatedVoice: params.enableBridgeMode
            ? params.callerTranslatedVoice
            : undefined,
          calledPersonTranslatedVoice: params.enableBridgeMode
            ? params.calledPersonTranslatedVoice
            : undefined,
          translatedCaptionsSourceLanguage: params.enableTranslatedCaptions
            ? params.translatedCaptionsSourceLanguage
            : undefined,
          translatedCaptionsTargetLanguage: params.enableTranslatedCaptions
            ? params.translatedCaptionsTargetLanguage
            : undefined,
          callerIdId: params.callerIdId,
          isFreeCall: isFreeCall ? true : undefined,
        };

        let session;
        try {
          session = await createTwilioSession(sessionArgs);
        } catch (error) {
          if (!shouldTryAutoTopUp(error)) throw error;
          await attemptAutoTopUpBeforeCall();
          session = await createTwilioSession(sessionArgs);
        }
        pendingSession = {
          callId: session.callId as Id<"calls">,
          sessionToken: session.sessionToken,
        };

        setCall((value) => ({
          ...value,
          currentCallId: session.callId as Id<"calls">,
          currentCallMaxSeconds: session.maxCallSeconds,
          isFreeCall,
        }));

        if (isFreeCall) {
          captureProductEvent("free_call_trial_started", {
            callMode: "browser",
            maxSeconds: session.maxCallSeconds,
            source: "dialer",
          });
        }
        captureProductEvent("call_started", {
          callMode: "browser",
          hasContact: Boolean(params.contactId),
          hasLiveCopilot: params.enableLiveCopilot,
          hasTranslatedCaptions: params.enableTranslatedCaptions,
          hasVoiceTranslation: params.enableBridgeMode,
          isFreeCall,
          source: isFreeCall ? "free_trial" : "credits",
          workflowTemplateKey: params.workflowTemplateKey,
        });
        if (params.enableBridgeMode) {
          captureProductEvent("translated_call_started", {
            callMode: "voice_translation",
            hasLiveCopilot: params.enableLiveCopilot,
            isFreeCall,
            sourceLanguage: params.translatedCaptionsTargetLanguage,
            targetLanguage: params.translatedCaptionsSourceLanguage,
            source: isFreeCall ? "free_trial" : "credits",
          });
        }

        const token = await fetchTwilioToken({
          callId: String(session.callId),
          sessionToken: session.sessionToken,
        });
        // A prior call attempt's Device (and its own signaling connection
        // and token-refresh timer) was previously only ever torn down on
        // component unmount, never between retries on the same page load.
        // Repeated attempts (e.g. redialing after a failure) could leave
        // multiple orphaned Devices running concurrently, any of which
        // firing its own "error" event still overwrites the shared call
        // state via setCall below — a plausible source of confusing,
        // seemingly-unrelated errors surfacing mid-call.
        twilioCall.current?.disconnect();
        twilioDevice.current?.destroy();
        const { Device } = await import("@twilio/voice-sdk");
        const device = new Device(token, { tokenRefreshMs: 30000 });
        twilioDevice.current = device;

        if (call.selectedInputDeviceId) {
          device.audio?.setInputDevice(call.selectedInputDeviceId).catch(() => {});
        }
        if (call.selectedOutputDeviceId) {
          device.audio?.speakerDevices.set(call.selectedOutputDeviceId).catch(() => {});
        }

        device.on("tokenWillExpire", async () => {
          const refreshedToken = await fetchTwilioToken();
          device.updateToken(refreshedToken);
        });
        device.on("error", (error) => {
          releaseUnconnectedSession();
          setCall((value) => ({ ...value, twilioError: error.message || "Browser calling error.", phase: "failed" }));
        });

        const twCall = await device.connect({
          params: {
            voxandraCallId: String(session.callId),
            voxandraSessionToken: session.sessionToken,
          },
        });
        twilioCall.current = twCall;

        twCall.on("ringing", () => setCall((value) => ({ ...value, phase: "ringing" })));
        twCall.on("accept", () => {
          pendingSession = undefined;
          activeWarnings.current = new Set();
          setCall((value) => ({ ...value, phase: "in_call", networkQuality: "good" }));
          if (session.browserAudioStreamToken) {
            const browserAudioStreamUrl =
              process.env.NEXT_PUBLIC_REALTIME_MEDIA_STREAM_BROWSER_URL;
            if (browserAudioStreamUrl) {
              const client = new TranslationAudioClient();
              client.connect(
                browserAudioStreamUrl,
                session.browserAudioStreamToken,
                String(session.callId)
              );
              translationAudioClient.current = client;
            }
          }
        });
        twCall.on("warning", (name: string) => {
          activeWarnings.current.add(name);
          const severity: NetworkQuality =
            activeWarnings.current.size === 0
              ? "good"
              : [...activeWarnings.current].some((warning) => CRITICAL_WARNINGS.has(warning))
                ? "poor"
                : "fair";
          setCall((value) => ({ ...value, networkQuality: severity }));
        });
        twCall.on("warning-cleared", (name: string) => {
          activeWarnings.current.delete(name);
          const severity: NetworkQuality =
            activeWarnings.current.size === 0
              ? "good"
              : [...activeWarnings.current].some((warning) => CRITICAL_WARNINGS.has(warning))
                ? "poor"
                : "fair";
          setCall((value) => ({ ...value, networkQuality: severity }));
        });
        twCall.on("disconnect", (connection) => {
          translationAudioClient.current?.disconnect();
          translationAudioClient.current = null;
          const error = (connection as TwilioDisconnectConnection)?.error;
          if (error) {
            console.error("[Browser Call] Disconnected with error:", { message: error.message, code: error.code });
            captureProductEvent("call_completed", {
              callMode: "browser",
              isFreeCall,
              status: "failed",
            });
            setCall((value) => ({ ...value, twilioError: error.message || "Call ended unexpectedly.", phase: "failed", networkQuality: "unknown" }));
          } else {
            captureProductEvent("call_completed", {
              callMode: "browser",
              isFreeCall,
              status: "completed",
            });
            setCall((value) => ({ ...value, phase: "completed", networkQuality: "unknown" }));
            queue(() => finishCall(String(session.callId)), 800);
          }
        });
        twCall.on("cancel", () => {
          releaseUnconnectedSession();
          translationAudioClient.current?.disconnect();
          translationAudioClient.current = null;
          console.error("[Browser Call] Call was cancelled");
          setCall((value) => ({ ...value, phase: "failed" }));
        });
        twCall.on("reject", () => {
          releaseUnconnectedSession();
          translationAudioClient.current?.disconnect();
          translationAudioClient.current = null;
          console.error("[Browser Call] Call was rejected");
          setCall((value) => ({ ...value, phase: "failed" }));
        });
        twCall.on("error", (error) => {
          releaseUnconnectedSession();
          translationAudioClient.current?.disconnect();
          translationAudioClient.current = null;
          const twilioError = error as TwilioCallError;
          const code = twilioError.code;
          console.error("[Browser Call] Error event:", {
            message: error.message,
            code,
            callsid: twilioError.callSid,
            connection: twilioError.connection?.parameters,
            stack: error.stack?.substring(0, 300),
          });
          const message = code && friendlyMessages[code] ? friendlyMessages[code] : error.message || "Browser call failed.";
          setCall((value) => ({ ...value, twilioError: message, phase: "failed" }));
        });
      } catch (error) {
        releaseUnconnectedSession();
        console.error("[Browser Call Error]", {
          type: typeof error,
          isError: error instanceof Error,
          isDomException: error instanceof DOMException,
          name: error instanceof Error ? error.name : "N/A",
          message: error instanceof Error ? error.message : String(error),
        });
        setCall((value) => ({
          ...value,
          micPermission:
            error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : value.micPermission,
          twilioError: error instanceof Error ? error.message : "Could not start the browser call.",
          currentCallMaxSeconds: null,
          isFreeCall: false,
          phase: "failed",
        }));
      } finally {
        startingCall.current = false;
      }
    },
    [
      call.phase,
      call.micPermission,
      call.inputDevices,
      call.outputDevices,
      call.selectedInputDeviceId,
      call.selectedOutputDeviceId,
      requestMicrophonePermission,
      createTwilioSession,
      cancelOutboundSession,
      attemptAutoTopUpBeforeCall,
      fetchTwilioToken,
      queue,
      finishCall,
      clearPendingHandoff,
    ]
  );

  const endCall = useCallback(() => {
    // Set the transitional state before disconnecting. Twilio may emit
    // `disconnect` synchronously; setting it afterwards can overwrite the
    // handler's completed state and leave the global bar stuck indefinitely.
    setCall((value) => ({ ...value, phase: "processing" }));
    twilioCall.current?.disconnect();
    twilioDevice.current?.disconnectAll();
  }, []);

  const toggleMute = useCallback(() => {
    setCall((value) => {
      const nextMuted = !value.muted;
      twilioCall.current?.mute(nextMuted);
      return { ...value, muted: nextMuted };
    });
  }, []);

  const sendDigits = useCallback(
    (digits: string) => {
      twilioCall.current?.sendDigits(digits);
      const callId = call.currentCallId;
      if (!callId) return;
      // Fire-and-forget keypad telemetry — must never break DTMF entry.
      for (const digit of digits) {
        void recordKeypadPress({ callId, digit }).catch(() => {});
      }
    },
    [call.currentCallId, recordKeypadPress]
  );

  const setInputDevice = useCallback(async (deviceId: string) => {
    setCall((value) => ({ ...value, selectedInputDeviceId: deviceId }));
    await twilioDevice.current?.audio?.setInputDevice(deviceId);
  }, []);

  const setOutputDevice = useCallback(async (deviceId: string) => {
    setCall((value) => ({ ...value, selectedOutputDeviceId: deviceId }));
    await twilioDevice.current?.audio?.speakerDevices.set(deviceId);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (call.currentCallMaxSeconds === null) return null;
    return Math.max(0, call.currentCallMaxSeconds - call.elapsedSeconds);
  }, [call.currentCallMaxSeconds, call.elapsedSeconds]);

  const value = useMemo<CallContextValue>(
    () => ({
      call: { ...call, remainingSeconds },
      startCall,
      endCall,
      toggleMute,
      sendDigits,
      setInputDevice,
      setOutputDevice,
      requestMicrophonePermission,
      resetCallState,
    }),
    [
      call,
      remainingSeconds,
      startCall,
      endCall,
      toggleMute,
      sendDigits,
      setInputDevice,
      setOutputDevice,
      requestMicrophonePermission,
      resetCallState,
    ]
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useGlobalCall() {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error("useGlobalCall must be used within a CallProvider");
  }
  return ctx;
}

export const ACTIVE_CALL_PHASES: CallPhase[] = ["connecting", "ringing", "in_call", "processing"];
