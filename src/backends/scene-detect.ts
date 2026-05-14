import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";
import { resolveStage } from "../runtime/mode.js";
import type { Scene, Keyframe } from "../schema/types.js";

export interface SceneDetectOptions {
  source: string;
  threshold?: number;
  minSceneLengthMs?: number;
  maxScenes?: number;
}

export interface KeyframeOptions {
  source: string;
  perScene?: boolean;
  intervalMs?: number;
  quality?: number;
}

export async function detectScenes(opts: SceneDetectOptions): Promise<{ scenes: Scene[]; duration_ms?: number }> {
  const route = await resolveStage("scenes");
  if (route === "lite") {
    const { liteDetectScenes } = await import("./lite/ffmpeg-scenes.js");
    return liteDetectScenes(opts);
  }
  // cloud + local both POST to the configured URL
  return postRun(loadEnv().sceneDetect, opts as unknown as Record<string, unknown>);
}

export async function extractKeyframes(opts: KeyframeOptions): Promise<{ keyframes: Keyframe[] }> {
  const route = await resolveStage("scenes");
  if (route === "lite") {
    const { liteExtractKeyframes } = await import("./lite/ffmpeg-scenes.js");
    return liteExtractKeyframes(opts);
  }
  return postRun(loadEnv().sceneDetect, { mode: "keyframes", ...opts });
}
