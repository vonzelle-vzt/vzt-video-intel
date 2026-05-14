import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";
import { resolveStage } from "../runtime/mode.js";

export interface ClipSearchOptions {
  source: string;
  query: string;
  topK?: number;
  minScore?: number;
}

export interface ClipSearchHit {
  t_ms: number;
  score: number;
  scene_id?: number;
}

export async function semanticSearch(opts: ClipSearchOptions): Promise<{ hits: ClipSearchHit[] }> {
  const route = await resolveStage("clip");
  if (route === "cloud") {
    const { cloudSemanticSearch } = await import("./cloud/clip.js");
    return cloudSemanticSearch(opts);
  }
  if (route === "lite") {
    const { liteSemanticSearch } = await import("./lite/clip-onnx.js");
    return liteSemanticSearch(opts);
  }
  return postRun(loadEnv().clip, opts as unknown as Record<string, unknown>);
}
