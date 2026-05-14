// Cloud CLIP semantic search via Replicate.

import { replicateRun } from "./replicate.js";
import type { ClipSearchOptions, ClipSearchHit } from "../clip.js";

interface RawClipOutput {
  hits?: { t_ms: number; score: number }[];
}

export async function cloudSemanticSearch(opts: ClipSearchOptions): Promise<{ hits: ClipSearchHit[] }> {
  const output = await replicateRun<RawClipOutput>({
    model: "andreasjansson/clip-features",
    input: {
      video: opts.source,
      query: opts.query,
      top_k: opts.topK ?? 10,
      min_score: opts.minScore ?? 0.2,
    },
    timeoutMs: 10 * 60_000,
  });
  return { hits: (output.hits ?? []).map((h) => ({ t_ms: Number(h.t_ms), score: Number(h.score) })) };
}
