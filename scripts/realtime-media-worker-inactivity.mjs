import createVAD, { VADMode, VADEvent } from "@ozymandiasthegreat/vad";

export const INACTIVITY_WARNING_MS = 120_000;
export const INACTIVITY_TIMEOUT_MS = 180_000;
const VAD = await createVAD();

export function createBridgeSpeechDetector() {
  const vad = new VAD(VADMode.AGGRESSIVE, 8000);
  let pending = [];
  let recent = [];
  return {
    detect(pcm24Base64, suppressed = false) {
      if (suppressed) {
        pending = [];
        recent = [];
        return false;
      }
      const pcm = Buffer.from(pcm24Base64, "base64");
      for (let offset = 0; offset + 5 < pcm.length; offset += 6) pending.push(pcm.readInt16LE(offset));
      let speech = false;
      while (pending.length >= 160) {
        const result = vad.processFrame(Int16Array.from(pending.splice(0, 160)));
        if (result === VADEvent.ERROR) throw new Error("Speech detector rejected an audio frame");
        recent.push(result === VADEvent.VOICE ? 1 : 0);
        if (recent.length > 10) recent.shift();
        speech ||= recent.reduce((sum, frame) => sum + frame, 0) >= 6;
      }
      return speech;
    },
    destroy() { vad.destroy(); pending = []; recent = []; },
  };
}

export class BridgeInactivityClock {
  constructor() {
    this.lastActivityAt = undefined;
  }

  start(now) {
    if (this.lastActivityAt === undefined) this.lastActivityAt = now;
  }

  activity(now) {
    if (this.lastActivityAt !== undefined) this.lastActivityAt = Math.max(this.lastActivityAt, now);
  }

  state(now) {
    if (this.lastActivityAt === undefined) return "waiting";
    if (now - this.lastActivityAt >= INACTIVITY_TIMEOUT_MS) return "expired";
    if (now - this.lastActivityAt >= INACTIVITY_WARNING_MS) return "warning";
    return "active";
  }
}
