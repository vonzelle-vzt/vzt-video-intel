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
