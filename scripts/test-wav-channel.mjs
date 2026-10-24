import { extractWavChannel } from "../src/lib/server/wav-channel.ts";

function stereoPcmWav() {
  const data = Buffer.from([
    0x01, 0x02, 0x11, 0x12,
    0x03, 0x04, 0x13, 0x14,
  ]);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

const input = stereoPcmWav();
const channelOne = extractWavChannel(input, 0);
const channelTwo = extractWavChannel(input, 1);

if (channelOne.readUInt16LE(22) !== 1 || channelTwo.readUInt16LE(22) !== 1) {
  throw new Error("Extracted WAV must be mono.");
}
if (channelOne.subarray(44).toString("hex") !== "01020304") {
  throw new Error("Channel 1 samples were not deinterleaved correctly.");
}
if (channelTwo.subarray(44).toString("hex") !== "11121314") {
  throw new Error("Channel 2 samples were not deinterleaved correctly.");
}

console.log("WAV channel deinterleave tests passed.");
