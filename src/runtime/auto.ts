// Environment detection — what backends does this machine have available?
// Powers `vintel auto` and the first-run wizard.

import { spawnSync } from "node:child_process";
import { hasCloudKey, loadEnv } from "../lib/env.js";
import { verifyBackends } from "../lib/verify-backends.js";

export interface Detection {
  node: string;
  hasDocker: boolean;
  hasGpu: boolean;
  hasFfmpeg: boolean;
  hasCloudKey: boolean;
  localBackendsReachable: number; // 0..6
  recommendedMode: "cloud" | "local" | "lite";
  recommendedReason: string;
}

function which(cmd: string): boolean {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    stdio: "ignore",
    timeout: 5000,
  });
  return probe.status === 0;
}

function detectGpu(): boolean {
  const probe = spawnSync("nvidia-smi", ["-L"], { stdio: "pipe", timeout: 5000 });
  return probe.status === 0 && probe.stdout.toString().includes("GPU");
}

export async function detect(): Promise<Detection> {
  const hasDocker = which("docker");
  const hasGpu = detectGpu();
  const hasFfmpeg = which("ffmpeg") || which("ffmpeg.exe");
  const cloudKey = hasCloudKey();

  // Probe local backends in parallel
  let reachable = 0;
  try {
    const report = await verifyBackends();
    reachable = report.filter((b) => b.reachable).length;
  } catch {
    reachable = 0;
  }

  // Priority: cloud-key → cloud; local-backends-running → local; otherwise → lite
  let recommendedMode: Detection["recommendedMode"];
  let recommendedReason: string;
  if (reachable >= 4) {
    recommendedMode = "local";
    recommendedReason = `${reachable}/6 local backends reachable`;
  } else if (cloudKey) {
    recommendedMode = "cloud";
    recommendedReason = "REPLICATE_API_TOKEN detected";
  } else if (hasGpu && hasDocker) {
    recommendedMode = "local";
    recommendedReason = "GPU + Docker available — run `vintel up` to start backends";
  } else {
    recommendedMode = "lite";
    recommendedReason = "no GPU, no cloud key, no running backends — falling back to pure-Node lite mode";
  }

  return {
    node: process.version,
    hasDocker,
    hasGpu,
    hasFfmpeg,
    hasCloudKey: cloudKey,
    localBackendsReachable: reachable,
    recommendedMode,
    recommendedReason,
  };
}

// Resolved per-stage routing given a detection + an explicit mode override.
export interface Routing {
  transcribe: "cloud" | "local" | "lite";
  scenes: "cloud" | "local" | "lite";
  ocr: "cloud" | "local" | "lite";
  clip: "cloud" | "local" | "lite";
  entities: "cloud" | "local" | "skip";
  actions: "cloud" | "local" | "skip";
}

export function routeFor(mode: "cloud" | "local" | "lite", det: Detection): Routing {
  if (mode === "local") {
    // Power-user mode — always try local, but degrade per-stage if not reachable
    return {
      transcribe: "local", scenes: "local", ocr: "local", clip: "local", entities: "local", actions: "local",
    };
  }
  if (mode === "cloud") {
    return {
      transcribe: "cloud",
      scenes: det.hasFfmpeg ? "lite" : "cloud", // ffmpeg lite is faster + free
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
export async function resolveMode(): Promise<{ mode: "cloud" | "local" | "lite"; detection: Detection; routing: Routing }> {
  const env = loadEnv();
  const detection = await detect();
  let mode: "cloud" | "local" | "lite";
  if (env.mode === "auto") {
    mode = detection.recommendedMode;
  } else {
    mode = env.mode;
  }
  return { mode, detection, routing: routeFor(mode, detection) };
}
