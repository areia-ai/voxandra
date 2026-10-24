// Tests the dual-channel transcription merge in isolation, with a fake OpenAI
// client. What this protects: speaker labels must come from the telephony
// channel (not model diarization), the two channels must interleave in
// timestamp order, and the operator channel must flip with call direction.
// Getting the direction mapping backwards would silently attribute every
// commitment to the wrong party.
import assert from "node:assert/strict";
import {
  OPERATOR_SPEAKER_LABEL,
  OTHER_PARTY_SPEAKER_LABEL,
  transcribeDualChannel,
} from "../src/lib/server/openai-transcription.ts";

// Keys the fake responses off the filename transcribeDualChannel builds, so the
// test can tell which physical channel each request carried.
function fakeOpenAi(byChannel) {
  const seen = [];
  return {
    seen,
    client: {
      audio: {
        transcriptions: {
          create: async (request) => {
            const name = request.file?.name ?? "";
            const channel = name.startsWith("operator") ? 0 : 1;
            seen.push({ channel, model: request.model, format: request.response_format });
            return byChannel[channel];
          },
        },
      },
    },
  };
}

const diarized = (segments) => ({
  text: segments.map((s) => s.text).join(" "),
  language: "en",
  duration: 12,
  segments,
});

// 1. Outbound call: operator is channel 0. Interleave must be by timestamp.
{
  const { client, seen } = fakeOpenAi({
    0: diarized([
      { speaker: "spk_0", text: "Calling about PO-8842.", start: 0.0, end: 2.0 },
      { speaker: "spk_0", text: "Can you confirm the date?", start: 5.0, end: 6.5 },
    ]),
    1: diarized([
      { speaker: "spk_0", text: "Payment is approved.", start: 2.5, end: 4.0 },
      { speaker: "spk_0", text: "Release is Friday.", start: 7.0, end: 8.0 },
    ]),
  });

  const result = await transcribeDualChannel({
    openai: client,
    operatorAudio: Buffer.from("operator-audio"),
    otherPartyAudio: Buffer.from("other-audio"),
  });

  assert.ok(result, "outbound dual-channel transcription should succeed");
  assert.deepEqual(
    result.segments.map((s) => [s.speaker, s.start]),
    [
      [OPERATOR_SPEAKER_LABEL, 0.0],
      [OTHER_PARTY_SPEAKER_LABEL, 2.5],
      [OPERATOR_SPEAKER_LABEL, 5.0],
      [OTHER_PARTY_SPEAKER_LABEL, 7.0],
    ],
    "segments interleave by timestamp with channel-derived speakers"
  );
  assert.equal(
    result.text,
    "Calling about PO-8842. Payment is approved. Can you confirm the date? Release is Friday.",
    "merged text follows conversation order, not channel order"
  );
  assert.ok(
    result.segments.every((s) => s.speaker !== "spk_0"),
    "model-reported diarization labels must be replaced by channel labels"
  );
  assert.equal(seen.length, 2, "each channel is transcribed exactly once");
  assert.ok(
    seen.every((r) => r.model === "gpt-4o-transcribe-diarize" && r.format === "diarized_json"),
    "per-channel passes must use the only model that returns timestamps"
  );
}

// 2. The label follows which buffer was passed as the operator, never the order
//    the speech happens to occur in. Here the operator speaks second.
{
  const { client } = fakeOpenAi({
    0: diarized([{ speaker: "spk_0", text: "Operator second.", start: 3.0, end: 4.0 }]),
    1: diarized([{ speaker: "spk_0", text: "Other party first.", start: 1.0, end: 2.0 }]),
  });

  const result = await transcribeDualChannel({
    openai: client,
    operatorAudio: Buffer.from("operator-audio"),
    otherPartyAudio: Buffer.from("other-audio"),
  });

  assert.deepEqual(
    result.segments.map((s) => [s.speaker, s.text]),
    [
      [OTHER_PARTY_SPEAKER_LABEL, "Other party first."],
      [OPERATOR_SPEAKER_LABEL, "Operator second."],
    ],
    "operator label follows the operatorAudio argument, not speech order"
  );
}

// 3. Whitespace-only segments inside an otherwise non-empty channel are dropped,
//    so they cannot introduce blank turns or double spaces into the transcript.
{
  const { client } = fakeOpenAi({
    0: diarized([{ speaker: "spk_0", text: "Operator speaks.", start: 0.5, end: 1.5 }]),
    1: {
      text: "Other party speaks.",
      language: "en",
      duration: 4,
      segments: [
        { speaker: "spk_0", text: "   ", start: 2.0, end: 2.1 },
        { speaker: "spk_0", text: "Other party speaks.", start: 3.0, end: 4.0 },
      ],
    },
  });

  const result = await transcribeDualChannel({
    openai: client,
    operatorAudio: Buffer.from("operator-audio"),
    otherPartyAudio: Buffer.from("other-audio"),
  });

  assert.equal(result.segments.length, 2, "whitespace-only segments are dropped");
  assert.equal(result.text, "Operator speaks. Other party speaks.");
}

// 3b. A fully silent channel is indistinguishable from a failed one, because
//     transcribeWithFallbacks rejects an empty transcript. Both fall back to the
//     single pass, which handles one-sided audio correctly anyway.
{
  const { client } = fakeOpenAi({
    0: diarized([{ speaker: "spk_0", text: "Only one side spoke.", start: 0.5, end: 1.5 }]),
    1: { text: "", language: undefined, duration: 0, segments: [] },
  });

  const result = await transcribeDualChannel({
    openai: client,
    operatorAudio: Buffer.from("operator-audio"),
    otherPartyAudio: Buffer.from("other-audio"),
  });

  assert.equal(result, null, "a silent channel falls back to the single pass");
}

// 4. Missing timestamps must return null so the caller falls back to the
//    single-pass diarized path rather than emitting arbitrary ordering.
{
  const { client } = fakeOpenAi({
    0: diarized([{ speaker: "spk_0", text: "No timing here.", end: 1.0 }]),
    1: diarized([{ speaker: "spk_0", text: "Nor here.", end: 2.0 }]),
  });

  const result = await transcribeDualChannel({
    openai: client,
    operatorAudio: Buffer.from("operator-audio"),
    otherPartyAudio: Buffer.from("other-audio"),
  });

  assert.equal(result, null, "untimestamped channels must not be merged");
}

// 5. Both channels empty returns null rather than throwing or emitting an empty
//    transcript. Uses allSettled internally, so a second failing channel cannot
//    become an unhandled rejection.
{
  const { client } = fakeOpenAi({
    0: { text: "", segments: [] },
    1: { text: "", segments: [] },
  });

  const result = await transcribeDualChannel({
    openai: client,
    operatorAudio: Buffer.from("operator-audio"),
    otherPartyAudio: Buffer.from("other-audio"),
  });

  assert.equal(result, null, "empty channels fall back to the single pass");
}

// 6. One failing channel must fall back rather than emit a transcript missing a
//    whole side of the conversation.
{
  const { client } = fakeOpenAi({
    0: diarized([{ speaker: "spk_0", text: "Only the operator survived.", start: 0.5, end: 1.5 }]),
    1: null, // triggers a throw inside transcribeWithFallbacks
  });

  const result = await transcribeDualChannel({
    openai: client,
    operatorAudio: Buffer.from("operator-audio"),
    otherPartyAudio: Buffer.from("other-audio"),
  });

  assert.equal(result, null, "a half-transcribed call must not be returned");
}

console.log("Dual-channel transcription tests passed.");
