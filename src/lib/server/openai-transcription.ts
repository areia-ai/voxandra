import OpenAI from "openai";

// The primary stays gpt-4o-transcribe-diarize: it is the only model OpenAI lists
// for speaker-labeled transcripts, and knowing who committed to what is the
// product. gpt-transcribe is both cheaper ($0.0045/min vs ~$0.006) and more
// accurate (8.98% vs 15.21% error on OpenAI's nine-language real-world
// benchmark, and 19.27% vs 40.37% on Common Voice) but does not diarize, so it
// takes whisper-1's place at the tail of the chain rather than the head.
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize";
export const DEFAULT_TRANSCRIPTION_FALLBACK_MODELS = "gpt-4o-transcribe,gpt-transcribe";

export const SUPPORTED_TRANSCRIPTION_MODELS = [
  "gpt-4o-transcribe-diarize",
  "gpt-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  // Legacy. Kept selectable via OPENAI_TRANSCRIPTION_MODEL for word timestamps
  // and subtitles, but no longer in any default chain.
  "whisper-1",
] as const;

export type SupportedTranscriptionModel = (typeof SUPPORTED_TRANSCRIPTION_MODELS)[number];

export type TranscriptSegment = {
  speaker: string;
  text: string;
  start?: number;
  end?: number;
};

export type TranscriptionResult = {
  text: string;
  language?: string;
  duration?: number;
  segments: TranscriptSegment[];
  model: SupportedTranscriptionModel;
  fallbackFrom?: string;
  attemptCount: number;
};

const ENGLISH_LANGUAGE_MARKERS = new Set([
  "a", "about", "and", "are", "because", "but", "can", "could", "for", "from",
  "have", "hello", "here", "how", "i", "if", "in", "invoice", "is", "it", "need",
  "of", "on", "our", "payment", "should", "that", "the", "this", "to", "we", "what",
  "when", "which", "will", "with", "you", "your",
]);

const SPANISH_LANGUAGE_MARKERS = new Set([
  "a", "aquí", "como", "con", "cuando", "de", "del", "el", "en", "es", "esta", "factura",
  "gracias", "hola", "la", "las", "lo", "los", "necesito", "no", "para", "pago", "pero",
  "por", "puede", "que", "qué", "se", "si", "sí", "su", "te", "un", "una", "y", "ya", "yo",
]);

/**
 * The diarized transcription response does not currently include a language.
 * Use a deliberately conservative English/Spanish fallback and leave genuinely
 * mixed or other-language calls to the extraction model.
 */
export function inferTranscriptLanguage(text: string): "en" | "es" | undefined {
  const tokens = text.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
  if (tokens.length < 4) return undefined;

  let englishScore = 0;
  let spanishScore = 0;
  for (const token of tokens) {
    if (ENGLISH_LANGUAGE_MARKERS.has(token)) englishScore += 1;
    if (SPANISH_LANGUAGE_MARKERS.has(token)) spanishScore += 1;
  }
  spanishScore += (text.match(/[áéíóúüñ¿¡]/gi) ?? []).length;

  if (englishScore >= 4 && englishScore >= spanishScore * 1.5) return "en";
  if (spanishScore >= 4 && spanishScore >= englishScore * 1.5) return "es";
  return undefined;
}

export function resolveTranscriptLanguage(providerLanguage: string | undefined, text: string) {
  const normalized = providerLanguage?.trim().toLocaleLowerCase();
  if (normalized && !["unknown", "und", "auto"].includes(normalized)) {
    return normalized;
  }
  return inferTranscriptLanguage(text) ?? "unknown";
}

function isSupportedModel(model: string): model is SupportedTranscriptionModel {
  return SUPPORTED_TRANSCRIPTION_MODELS.includes(model as SupportedTranscriptionModel);
}

function normalizeModel(model: string | undefined): SupportedTranscriptionModel {
  if (model && isSupportedModel(model)) return model;
  return DEFAULT_TRANSCRIPTION_MODEL;
}

export function getTranscriptionModelSequence(
  primaryModel = process.env.OPENAI_TRANSCRIPTION_MODEL,
  fallbackModels = process.env.OPENAI_TRANSCRIPTION_FALLBACK_MODELS
): SupportedTranscriptionModel[] {
  const models = [
    normalizeModel(primaryModel),
    ...(fallbackModels ?? DEFAULT_TRANSCRIPTION_FALLBACK_MODELS)
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean)
      .filter(isSupportedModel),
  ];

  return models.filter((model, index) => models.indexOf(model) === index);
}

export function buildTranscriptionRequest(
  file: File,
  model: SupportedTranscriptionModel,
  language?: string
) {
  const request: Record<string, unknown> = {
    file,
    model,
  };

  if (language && /^[a-z]{2}$/i.test(language.trim())) {
    request.language = language.trim().toLowerCase();
  }

  if (model === "gpt-4o-transcribe-diarize") {
    request.response_format = "diarized_json";
    request.chunking_strategy = "auto";
    return request;
  }

  if (model === "whisper-1") {
    request.response_format = "verbose_json";
    return request;
  }

  request.response_format = "json";
  return request;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseDiarizedSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((segment) => {
      if (!segment || typeof segment !== "object") return [];
      const record = segment as Record<string, unknown>;
      const text = getString(record.text);
      if (!text) return [];
      const parsed: TranscriptSegment = {
        speaker: getString(record.speaker) ?? "combined",
        text,
      };
      const start = getNumber(record.start);
      const end = getNumber(record.end);
      if (start !== undefined) parsed.start = start;
      if (end !== undefined) parsed.end = end;
      return [parsed];
    });
}

function parseTranscriptionResponse(
  response: unknown,
  model: SupportedTranscriptionModel
): Pick<TranscriptionResult, "text" | "language" | "duration" | "segments"> {
  const record = response && typeof response === "object" ? response as Record<string, unknown> : {};
  const text = getString(record.text) ?? "";
  const language = getString(record.language);
  const duration = getNumber(record.duration);
  const diarizedSegments = model === "gpt-4o-transcribe-diarize"
    ? parseDiarizedSegments(record.segments)
    : [];

  return {
    text,
    language,
    duration,
    segments: diarizedSegments.length > 0 ? diarizedSegments : [{ speaker: "combined", text }],
  };
}

// Speaker labels for the dual-channel path. Deliberately the same single-letter
// vocabulary the diarized single-pass path and the seeded fixtures already use,
// so speakerMappings, the extraction prompt, and the review-time speaker
// correction flow all keep working unchanged — only the label-to-side assignment
// becomes deterministic instead of inferred.
export const OPERATOR_SPEAKER_LABEL = "A";
export const OTHER_PARTY_SPEAKER_LABEL = "B";

/**
 * Transcribe a stereo recording one channel at a time and attribute speakers
 * from the telephony channel rather than from model diarization.
 *
 * Twilio keeps the two call legs on separate channels, so which side spoke is
 * already known: it is a property of the recording, not something to infer.
 * Model diarization can merge two similar-sounding speakers into one label or
 * split one speaker across two, and on codec-compressed telephone audio with
 * crosstalk it sometimes does. Channel attribution cannot.
 *
 * Uses the diarizing model per channel because it is the only model that returns
 * segment timestamps, which the merge needs; gpt-transcribe supports only `json`
 * and `text` (verified against the API) and so cannot be ordered against another
 * channel. Two diarized passes cost ~1.2c/min, exactly the existing
 * OPENAI_TRANSCRIPTION_COST_CENTS_PER_MINUTE budget, so retail rates and the
 * call-pricing margin guard are unaffected.
 *
 * Takes already-extracted mono channels rather than the stereo buffer, so WAV
 * parsing stays with the caller that already owns it and this stays unit
 * testable without synthesising audio.
 *
 * Returns null when the recording is not usable per-channel, so the caller can
 * fall back to the single-pass diarized path.
 */
export async function transcribeDualChannel({
  openai,
  operatorAudio,
  otherPartyAudio,
  language,
}: {
  openai: OpenAI;
  operatorAudio: Buffer;
  otherPartyAudio: Buffer;
  language?: string;
}): Promise<TranscriptionResult | null> {
  // allSettled, not all: with Promise.all a second failing channel becomes an
  // unhandled rejection, and a single failure would discard the channel that did
  // succeed. If either channel fails we want the single-pass fallback, because a
  // transcript missing one whole side of the conversation is worse than one with
  // inferred speaker labels.
  const settled = await Promise.allSettled(
    [
      { audio: operatorAudio, name: "operator" },
      { audio: otherPartyAudio, name: "other-party" },
    ].map(async ({ audio, name }) =>
      transcribeWithFallbacks({
        openai,
        file: new File([new Uint8Array(audio)], `${name}.wav`, { type: "audio/wav" }),
        language,
        // Timestamps are required to interleave the two channels, and only the
        // diarizing model returns them.
        models: ["gpt-4o-transcribe-diarize"],
      })
    )
  );

  if (settled.some((outcome) => outcome.status === "rejected")) return null;
  const [operator, otherParty] = settled.map(
    (outcome) => (outcome as PromiseFulfilledResult<TranscriptionResult>).value
  );

  const labelled = [
    { result: operator, label: OPERATOR_SPEAKER_LABEL },
    { result: otherParty, label: OTHER_PARTY_SPEAKER_LABEL },
  ].flatMap(({ result, label }) =>
    result.segments
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment) => ({ ...segment, speaker: label }))
  );

  // Without timestamps on both sides the interleave order would be arbitrary,
  // which is worse than inferred diarization on a single pass.
  if (labelled.length === 0 || labelled.some((segment) => segment.start === undefined)) {
    return null;
  }

  const segments = labelled.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const text = segments.map((segment) => segment.text.trim()).join(" ").trim();
  if (!text) return null;

  const longest = operator.text.length >= otherParty.text.length ? operator : otherParty;

  return {
    text,
    language: longest.language,
    duration: Math.max(operator.duration ?? 0, otherParty.duration ?? 0) || undefined,
    segments,
    model: "gpt-4o-transcribe-diarize",
    attemptCount: operator.attemptCount + otherParty.attemptCount,
  };
}

export async function transcribeWithFallbacks({
  openai,
  file,
  language,
  models = getTranscriptionModelSequence(),
}: {
  openai: OpenAI;
  file: File;
  language?: string;
  models?: SupportedTranscriptionModel[];
}): Promise<TranscriptionResult> {
  let lastError: unknown;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      const request = buildTranscriptionRequest(file, model, language);
      const response = await openai.audio.transcriptions.create(request as never);
      const parsed = parseTranscriptionResponse(response, model);

      if (!parsed.text.trim() || parsed.text.trim().length < 2) {
        throw new Error("Transcript is empty or too short.");
      }

      return {
        ...parsed,
        model,
        fallbackFrom: index > 0 ? models[0] : undefined,
        attemptCount: index + 1,
      };
    } catch (error) {
      lastError = error;
      console.error("[Transcription] Model attempt failed", {
        model,
        message: error instanceof Error ? error.message : "Unknown transcription error",
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Transcription failed.");
}
