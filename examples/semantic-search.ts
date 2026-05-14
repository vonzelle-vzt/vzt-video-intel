// CLIP semantic moment search. Find the moment when X happens.
//   node --import tsx examples/semantic-search.ts ./game.mp4 "ball crossing the goal line"

import { semanticSearch } from "../src/backends/clip.js";

const [, , source, ...rest] = process.argv;
const query = rest.join(" ");
if (!source || !query) {
  console.error("usage: semantic-search.ts <video> <query>");
  process.exit(1);
}

const { hits } = await semanticSearch({ source, query, topK: 10, minScore: 0.2 });

console.log(`Top ${hits.length} moments matching "${query}":`);
for (const hit of hits) {
  console.log(`  ${(hit.t_ms / 1000).toFixed(2)}s  score=${hit.score.toFixed(3)}`);
}
