// Live Audio Translation (internal-only, single-workspace test — see
// AGENTIC_FUTURE.md). Plays translated speech audio streamed from the
// realtime worker's /browser/audio-stream WebSocket (Spoken Translation
// Phase 1) during a live call. No UI of its own — a plain client class the
// call provider connects/disconnects around the call lifecycle.
//
// Playback logic ported from scripts/browser-audio-stream-harness.html
// (proven manually during Phase 1/3), not reinvented: decode base64 PCM16
// mono frames and schedule them back-to-back via AudioContext so consecutive
// chunks play contiguously instead of overlapping or gapping.

type TranslationAudioFrame =
  | { type: "translation_audio_ready"; callId: string; targetLanguage?: string }
  | { type: "translation_audio_delta"; callId: string; sequence: number; payload: string }
  | { type: "translation_audio_end"; callId: string }
  | { type: "translation_audio_error"; reason: string };

const SAMPLE_RATE = 24000; // PCM s16le, mono — confirmed by scripts/probe-palabra-translation.mjs.

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class TranslationAudioClient {
  private ws: WebSocket | undefined;
  private audioCtx: AudioContext | undefined;
  private nextPlayTime = 0;

  connect(wsBaseUrl: string, token: string, callId: string): void {
    this.disconnect();

    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;
    this.audioCtx = new AudioContextCtor();
    this.nextPlayTime = 0;

    const url = `${wsBaseUrl}?token=${encodeURIComponent(token)}&callId=${encodeURIComponent(callId)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("message", (event) => {
      let frame: TranslationAudioFrame;
      try {
        frame = JSON.parse(event.data as string) as TranslationAudioFrame;
      } catch {
        return;
      }
      if (frame.type === "translation_audio_delta") {
        this.playFrame(frame.payload);
      }
    });
    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = undefined;
    });
    // Never surfaced to the user — a dropped translation-audio channel
    // should never interrupt or alarm about the underlying call itself.
    ws.addEventListener("error", () => {});
  }

  private playFrame(base64Payload: string): void {
    if (!this.audioCtx) return;
    let bytes: Uint8Array;
    try {
      bytes = base64ToUint8(base64Payload);
    } catch {
      return;
    }
    const sampleCount = Math.floor(bytes.length / 2);
    if (sampleCount === 0) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const audioBuffer = this.audioCtx.createBuffer(1, sampleCount, SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioCtx.destination);
    const startAt = Math.max(this.audioCtx.currentTime, this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + audioBuffer.duration;
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = undefined;
    void this.audioCtx?.close();
    this.audioCtx = undefined;
    this.nextPlayTime = 0;
  }
}
