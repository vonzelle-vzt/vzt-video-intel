import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";
import type { Action, Chapter } from "../schema/types.js";

export interface QwenChapterOptions {
  source: string;
  targetChapterCount?: number;
  style?: "youtube" | "course" | "highlights" | "meeting";
}

export interface QwenActionOptions {
  source: string;
  sceneStartMs?: number;
  sceneEndMs?: number;
}

export async function generateChapters(opts: QwenChapterOptions): Promise<{ chapters: Chapter[] }> {
  return postRun(loadEnv().qwen, { mode: "chapters", ...opts });
}

export async function recognizeActions(opts: QwenActionOptions): Promise<{ actions: Action[] }> {
  return postRun(loadEnv().qwen, { mode: "actions", ...opts });
}
