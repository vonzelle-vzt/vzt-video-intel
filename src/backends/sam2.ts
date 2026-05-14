import { resolveStage } from "../runtime/mode.js";
import type { Entity } from "../schema/types.js";

export interface Sam2Options {
  source: string;
  sceneStartMs?: number;
  sceneEndMs?: number;
  promptText?: string;
  sampleEveryMs?: number;
}

export async function trackEntities(opts: Sam2Options): Promise<{ entities: Entity[] }> {
  const route = await resolveStage("entities");
  if (route === "skip") return { entities: [] };
  const { cloudTrackEntities } = await import("./cloud/sam2.js");
  return cloudTrackEntities(opts);
}
