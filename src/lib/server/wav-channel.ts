type ParsedPcmWav = {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
};

function parsePcmWav(input: Buffer): ParsedPcmWav {
  if (
    input.length < 44 ||
    input.toString("ascii", 0, 4) !== "RIFF" ||
    input.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Operator language detection requires a WAV recording.");
  }

  let offset = 12;
  let format: Omit<ParsedPcmWav, "dataOffset" | "dataSize"> | undefined;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= input.length) {
    const id = input.toString("ascii", offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;
    if (bodyOffset + size > input.length) break;
    if (id === "fmt " && size >= 16) {
      format = {
        audioFormat: input.readUInt16LE(bodyOffset),
        channels: input.readUInt16LE(bodyOffset + 2),
        sampleRate: input.readUInt32LE(bodyOffset + 4),
        bitsPerSample: input.readUInt16LE(bodyOffset + 14),
      };
    }
    if (id === "data") {
      dataOffset = bodyOffset;
      dataSize = size;
      break;
    }
    offset = bodyOffset + size + (size % 2);
  }

  if (!format || dataOffset < 0 || dataSize <= 0) {
    throw new Error("WAV recording is missing PCM format or audio data.");
  }
  if (format.audioFormat !== 1 || format.bitsPerSample % 8 !== 0) {
    throw new Error("Operator language detection supports PCM WAV recordings only.");
  }
  return { ...format, dataOffset, dataSize };
}

export function extractWavChannel(input: Buffer, channelIndex: number) {
  const wav = parsePcmWav(input);
  if (wav.channels < 2 || channelIndex < 0 || channelIndex >= wav.channels) {
    throw new Error("Requested operator channel is not present in this recording.");
  }

  const bytesPerSample = wav.bitsPerSample / 8;
  const inputFrameSize = bytesPerSample * wav.channels;
  const frameCount = Math.floor(wav.dataSize / inputFrameSize);
  const outputDataSize = frameCount * bytesPerSample;
  const output = Buffer.alloc(44 + outputDataSize);

  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + outputDataSize, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(wav.sampleRate, 24);
  output.writeUInt32LE(wav.sampleRate * bytesPerSample, 28);
  output.writeUInt16LE(bytesPerSample, 32);
  output.writeUInt16LE(wav.bitsPerSample, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(outputDataSize, 40);

  const channelByteOffset = channelIndex * bytesPerSample;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sourceOffset = wav.dataOffset + frame * inputFrameSize + channelByteOffset;
    const targetOffset = 44 + frame * bytesPerSample;
    input.copy(output, targetOffset, sourceOffset, sourceOffset + bytesPerSample);
  }
  return output;
}
