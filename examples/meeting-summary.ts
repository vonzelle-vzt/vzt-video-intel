// Real-world: meeting recording → action items.

import { transcribe } from "../src/backends/whisperx.js";
import { generateChapters } from "../src/backends/qwen-vl.js";

const source = process.argv[2] ?? "./meeting.mp4";

const [transcript, chapters] = await Promise.all([
  transcribe({ source, diarize: true }),
  generateChapters({ source, targetChapterCount: 6, style: "meeting" }),
]);

console.log("📅 Meeting summary");
console.log(`   ${transcript.segments.length} utterances, ${chapters.chapters.length} chapters`);
console.log("");
for (const ch of chapters.chapters) {
  console.log(`• ${(ch.start_ms / 1000).toFixed(0)}s — ${ch.title}`);
  if (ch.summary) console.log(`    ${ch.summary}`);
}
