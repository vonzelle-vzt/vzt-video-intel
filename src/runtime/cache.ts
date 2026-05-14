// Persists user mode choice + cloud token to ~/.vzt-video-intel/config.json.
// Token storage is a placeholder for keychain integration in a future slice.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { configDir, configPath, Mode } from "../lib/env.js";

export interface PersistedConfig {
  mode?: Mode;
  cloudProvider?: "replicate";
  replicateToken?: string;
  muxBase?: string;
  firstRunCompleted?: boolean;
}

export function readConfig(): PersistedConfig {
  try {
    const path = configPath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8")) as PersistedConfig;
  } catch {
    return {};
  }
}

export function writeConfig(patch: PersistedConfig): PersistedConfig {
  if (!existsSync(configDir())) mkdirSync(configDir(), { recursive: true });
  const merged = { ...readConfig(), ...patch };
  const path = configPath();
  writeFileSync(path, JSON.stringify(merged, null, 2));
  try {
    chmodSync(path, 0o600); // tokens live here — lock down
  } catch {
    // chmod not supported on this filesystem (Windows FAT); best effort
  }
  return merged;
}

export function isFirstRun(): boolean {
  return !readConfig().firstRunCompleted;
}

export function markFirstRunComplete(): void {
  writeConfig({ firstRunCompleted: true });
}
