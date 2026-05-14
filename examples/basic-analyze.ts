// Basic full-pipeline example. Run with:
//   npm run build && node --import tsx examples/basic-analyze.ts ./demo.mp4

import { analyzeVideo } from "../src/pipeline/orchestrator.js";

const source = process.argv[2] ?? "./demo.mp4";

const graph = await analyzeVideo({
  source,
  includeKeyframes: true,
  trackEntities: true,
  recognizeActions: true,
});

console.log(`📹 ${graph.source}`);
console.log(`⏱  duration: ${graph.duration_ms ? (graph.duration_ms / 1000).toFixed(1) : "?"}s`);
console.log(`🎬 scenes: ${graph.scenes.length}`);
console.log(`🗣  transcript segments: ${graph.transcript.length}`);
console.log(`👤 entities: ${graph.entities.length}`);
console.log(`🎯 actions: ${graph.actions.length}`);
console.log(`📝 OCR regions: ${graph.ocr.length}`);
console.log(`🖼  keyframes: ${graph.keyframes?.length ?? 0}`);
