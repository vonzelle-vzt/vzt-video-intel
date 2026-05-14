import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";

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
  return postRun(loadEnv().clip, opts as unknown as Record<string, unknown>);
}
