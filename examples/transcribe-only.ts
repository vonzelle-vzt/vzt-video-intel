// Transcribe-only example. Useful when you don't need scenes/entities/etc.

import { transcribe } from "../src/backends/whisperx.js";

const source = process.argv[2] ?? "./demo.mp4";
const { segments, language } = await transcribe({ source, diarize: true });

console.log(`Detected language: ${language ?? "unknown"}`);
console.log("");
for (const seg of segments) {
  const t = `${(seg.start_ms / 1000).toFixed(2)}s`;
  const speaker = seg.speaker ?? "SPEAKER_??";
  console.log(`[${t}] ${speaker}: ${seg.text}`);
}
