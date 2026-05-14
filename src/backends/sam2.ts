import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";
import type { Entity } from "../schema/types.js";

export interface Sam2Options {
  source: string;
  sceneStartMs?: number;
  sceneEndMs?: number;
  promptText?: string;
  sampleEveryMs?: number;
}

export async function trackEntities(opts: Sam2Options): Promise<{ entities: Entity[] }> {
  return postRun(loadEnv().sam2, opts as unknown as Record<string, unknown>);
}
