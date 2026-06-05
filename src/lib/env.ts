// Resolved runtime configuration.
//
// Order of precedence (highest first):
//   1. process.env (per-call override)
//   2. ~/.vzt-video-intel/config.json (persisted user choice)
//   3. compiled defaults

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Mode = "cloud" | "lite" | "auto";

export interface Env {
  mode: Mode;
  cloudProvider: "replicate";
  replicateToken: string;
  muxBase: string;
  cacheDir: string;
}

export function configDir(): string {
  return process.env.VZT_VIDEO_INTEL_HOME ?? join(homedir(), ".vzt-video-intel");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

interface PersistedConfig {
  mode?: Mode;
  cloudProvider?: "replicate";
  replicateToken?: string;
  muxBase?: string;
}

function readPersistedConfig(): PersistedConfig {
  try {
    const path = configPath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8")) as PersistedConfig;
  } catch {
    return {};
  }
}

export function loadEnv(): Env {
  const persisted = readPersistedConfig();
  return {
    mode: (process.env.VZT_MODE as Mode) ?? persisted.mode ?? "auto",
    cloudProvider: persisted.cloudProvider ?? "replicate",
    replicateToken: process.env.REPLICATE_API_TOKEN ?? persisted.replicateToken ?? "",
    muxBase: process.env.MUX_BASE_URL ?? persisted.muxBase ?? "",
    cacheDir: process.env.VZT_CACHE_DIR ?? join(configDir(), "cache"),
  };
}

export function hasCloudKey(): boolean {
  return loadEnv().replicateToken.length > 0;
}

// ---- cloud model slugs -------------------------------------------------------
//
// The Replicate model slug for each heavy stage, overridable via env so power
// users can point at a newer model without a code change. Defaults stay on the
// official vendor namespaces (qwen/, meta/) — the proven, stable choice. Newer
// candidates (e.g. community-published Qwen3-VL / SAM 3 ports) exist; see
// docs/CLOUD-PROVIDERS.md before opting in. Setting the env is the only thing
// that changes behavior — defaults are unchanged.
//
// These are CLOUD (Replicate) slugs and are deliberately namespaced
// `VZT_CLOUD_*` so they never collide with the lite backends' Hugging Face
// model ids (`VZT_WHISPER_MODEL`, `VZT_CAPTION_MODEL`) — a Xenova id is not a
// valid Replicate slug, and vice versa.

export const DEFAULT_MODELS = {
  qwen: "qwen/qwen2.5-vl-7b-instruct", // chapters + action recognition
  sam: "meta/sam-2-video", // entity segmentation + tracking
  whisper: "vaibhavs10/incredibly-fast-whisper", // transcription (+ diarization)
} as const;

export function qwenModel(): string {
  return process.env.VZT_CLOUD_QWEN_MODEL || DEFAULT_MODELS.qwen;
}

export function samModel(): string {
  return process.env.VZT_CLOUD_SAM_MODEL || DEFAULT_MODELS.sam;
}

export function whisperModel(): string {
  return process.env.VZT_CLOUD_WHISPER_MODEL || DEFAULT_MODELS.whisper;
}
