// Scene detection + keyframe extraction always run locally via ffmpeg-static.
// CPU-light, sub-second on short clips — no point spending cloud cycles.

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
  const { liteDetectScenes } = await import("./lite/ffmpeg-scenes.js");
  return liteDetectScenes(opts);
}

export async function extractKeyframes(opts: KeyframeOptions): Promise<{ keyframes: Keyframe[] }> {
  const { liteExtractKeyframes } = await import("./lite/ffmpeg-scenes.js");
  return liteExtractKeyframes(opts);
}
