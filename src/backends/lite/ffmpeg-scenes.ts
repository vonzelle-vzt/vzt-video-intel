// Lite-mode scene detection + keyframe extraction (Slice 3 — ffmpeg-static).
// Stubbed in Slice 1.

import type { SceneDetectOptions, KeyframeOptions } from "../scene-detect.js";
import type { Scene, Keyframe } from "../../schema/types.js";

export async function liteDetectScenes(_opts: SceneDetectOptions): Promise<{ scenes: Scene[]; duration_ms?: number }> {
  throw new Error(
    "lite-mode scene detection not yet shipped (lands in v1.1.0 Slice 3). " +
    "Use `vintel config set mode=cloud` or `vintel up` for now.",
  );
}

export async function liteExtractKeyframes(_opts: KeyframeOptions): Promise<{ keyframes: Keyframe[] }> {
  throw new Error("lite-mode keyframes not yet shipped (lands in v1.1.0 Slice 3).");
}
