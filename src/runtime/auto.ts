// Environment detection — what backends does this machine have available?
// Powers `vintel auto` and the first-run wizard.

import { spawnSync } from "node:child_process";
import { hasCloudKey } from "../lib/env.js";

export interface Detection {
  node: string;
  hasFfmpeg: boolean;
  hasCloudKey: boolean;
  recommendedMode: "cloud" | "lite";
  recommendedReason: string;
}

function which(cmd: string): boolean {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    stdio: "ignore",
    timeout: 5000,
  });
  return probe.status === 0;
}

export async function detect(): Promise<Detection> {
  const hasFfmpeg = which("ffmpeg") || which("ffmpeg.exe");
  const cloudKey = hasCloudKey();

  const recommendedMode: Detection["recommendedMode"] = cloudKey ? "cloud" : "lite";
  const recommendedReason = cloudKey
    ? "REPLICATE_API_TOKEN detected — heavy stages will run on Replicate"
    : "no cloud key — falling back to pure-Node lite mode (free + offline)";

  return {
    node: process.version,
    hasFfmpeg,
    hasCloudKey: cloudKey,
    recommendedMode,
    recommendedReason,
  };
}

// Resolved per-stage routing given a detection + an explicit mode override.
export interface Routing {
  transcribe: "cloud" | "lite";
  scenes: "lite";
  ocr: "cloud" | "lite";
  clip: "cloud" | "lite";
  entities: "cloud" | "skip";
  actions: "cloud" | "skip";
}

export function routeFor(mode: "cloud" | "lite", det: Detection): Routing {
  if (mode === "cloud") {
    return {
      transcribe: "cloud",
      scenes: "lite", // ffmpeg-static is fast + free; no need to spend cloud cycles
      ocr: "cloud",
      clip: "cloud",
      entities: "cloud",
      actions: "cloud",
    };
  }
  // lite
  return {
    transcribe: "lite",
    scenes: "lite",
    ocr: "lite",
    clip: "lite",
    entities: det.hasCloudKey ? "cloud" : "skip",
    actions: det.hasCloudKey ? "cloud" : "skip",
  };
}

// Resolved mode for the current process — explicit override > persisted config > auto-detect.
export async function resolveMode(): Promise<{ mode: "cloud" | "lite"; detection: Detection; routing: Routing }> {
  const { loadEnv } = await import("../lib/env.js");
  const env = loadEnv();
  const detection = await detect();
  const mode: "cloud" | "lite" = env.mode === "auto" ? detection.recommendedMode : env.mode;
  return { mode, detection, routing: routeFor(mode, detection) };
}
