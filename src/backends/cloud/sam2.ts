// Cloud SAM2 video segmentation via Replicate.

import { replicateRun } from "./replicate.js";
import { samModel } from "../../lib/env.js";
import type { Sam2Options } from "../sam2.js";
import type { Entity } from "../../schema/types.js";

interface RawSam2Output {
  masks?: { tracking_id?: string; label?: string; bbox?: [number, number, number, number]; t_ms?: number }[];
}

export async function cloudTrackEntities(opts: Sam2Options): Promise<{ entities: Entity[] }> {
  const output = await replicateRun<RawSam2Output>({
    model: samModel(),
    input: {
      video: opts.source,
      mask_type: "highlighted",
      prompt: opts.promptText ?? "person, vehicle, object",
      sample_every_ms: opts.sampleEveryMs ?? 500,
    },
    timeoutMs: 15 * 60_000,
  });
  const byId = new Map<string, Entity>();
  for (const m of output.masks ?? []) {
    const id = m.tracking_id ?? `e${byId.size + 1}`;
    const label = m.label ?? "entity";
    const t = Number(m.t_ms) || 0;
    if (!byId.has(id)) {
      byId.set(id, {
        tracking_id: id,
        label,
        confidence: 0.85,
        appearances: [{ scene_id: 0, start_ms: t, end_ms: t, bboxes: [] }],
      });
    }
    const e = byId.get(id)!;
    if (m.bbox) e.appearances[0].bboxes!.push({ t_ms: t, bbox: m.bbox });
    e.appearances[0].end_ms = Math.max(e.appearances[0].end_ms, t);
  }
  return { entities: [...byId.values()] };
}
