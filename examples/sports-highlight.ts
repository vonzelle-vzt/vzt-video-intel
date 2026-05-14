// Real-world: detect goals + extract highlight windows from a sports clip.

import { analyzeVideo } from "../src/pipeline/orchestrator.js";
import { semanticSearch } from "../src/backends/clip.js";

const source = process.argv[2] ?? "./game.mp4";

const graph = await analyzeVideo({ source, trackEntities: true, recognizeActions: true });
const goals = await semanticSearch({ source, query: "goal scored", topK: 5, minScore: 0.25 });

console.log("🏟  Highlight reel:");
for (const goal of goals.hits) {
  const scene = graph.scenes.find((s) => goal.t_ms >= s.start_ms && goal.t_ms <= s.end_ms);
  if (!scene) continue;
  const surroundingAction = graph.actions.find((a) => a.scene_id === scene.id);
  console.log(`  ${(scene.start_ms / 1000).toFixed(1)}s–${(scene.end_ms / 1000).toFixed(1)}s  ${surroundingAction?.label ?? "moment"}  (clip score ${goal.score.toFixed(2)})`);
}
