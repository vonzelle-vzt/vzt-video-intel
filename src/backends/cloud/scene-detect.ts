// Cloud "scene detect" — in practice we use lite (ffmpeg) for this because
// scene detection is CPU-light and free. Kept as a stub so the routing layer
// has a symmetric shape; falls back to local-Python URL if pointed at one.

import { postRun } from "../../lib/http.js";
import { loadEnv } from "../../lib/env.js";
import type { SceneDetectOptions, KeyframeOptions } from "../scene-detect.js";
import type { Scene, Keyframe } from "../../schema/types.js";

export async function cloudDetectScenes(opts: SceneDetectOptions): Promise<{ scenes: Scene[]; duration_ms?: number }> {
  return postRun(loadEnv().sceneDetect, opts as unknown as Record<string, unknown>);
}

export async function cloudExtractKeyframes(opts: KeyframeOptions): Promise<{ keyframes: Keyframe[] }> {
  return postRun(loadEnv().sceneDetect, { mode: "keyframes", ...opts });
}
