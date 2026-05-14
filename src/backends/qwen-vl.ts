import { resolveStage } from "../runtime/mode.js";
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
  const route = await resolveStage("actions");
  if (route === "skip") return { chapters: [] };
  if (route === "lite") {
    const { liteGenerateChapters } = await import("./lite/vlm-caption.js");
    return liteGenerateChapters(opts);
  }
  const { cloudGenerateChapters } = await import("./cloud/qwen-vl.js");
  return cloudGenerateChapters(opts);
}

export async function recognizeActions(opts: QwenActionOptions): Promise<{ actions: Action[] }> {
  const route = await resolveStage("actions");
  if (route === "skip") return { actions: [] };
  if (route === "lite") {
    const { liteRecognizeActions } = await import("./lite/vlm-caption.js");
    return liteRecognizeActions(opts);
  }
  const { cloudRecognizeActions } = await import("./cloud/qwen-vl.js");
  return cloudRecognizeActions(opts);
}
