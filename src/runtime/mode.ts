// Single source of truth for "which adapter handles this stage right now?"
// Backend modules call resolveStage() before each call to pick local vs cloud vs lite.

import { resolveMode, Routing } from "./auto.js";

export type StageName = "transcribe" | "scenes" | "ocr" | "clip" | "entities" | "actions";
export type StageRoute = Routing[StageName];

let cached: { routing: Routing; mode: "cloud" | "local" | "lite" } | null = null;

export async function getRouting(): Promise<{ mode: "cloud" | "local" | "lite"; routing: Routing }> {
  if (cached) return cached;
  const { mode, routing } = await resolveMode();
  cached = { mode, routing };
  return cached;
}

export async function resolveStage(stage: StageName): Promise<StageRoute> {
  const { routing } = await getRouting();
  return routing[stage];
}

export function invalidateRoutingCache(): void {
  cached = null;
}
