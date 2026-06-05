// `observe` — watch AND listen, fused into one timeline.
//
// analyze() gives you parallel tracks: a transcript over here, scene captions
// over there, OCR somewhere else. A human doesn't experience a video as
// separate tracks — they perceive one stream of "now I hear this, now I see
// that, now the text on screen says this".
//
// observe() merges all four senses into a single time-sorted PerceptionEvent[]:
//   hear  — spoken audio (transcript segments)
//   see   — what's visually happening (VLM scene captions)
//   read  — on-screen text (OCR, de-duplicated into stable lines)
//   scene — shot/scene boundaries
//
// The result is a script you could hand to someone who can't watch the video
// and have them know what happened, second by second.

import { analyzeVideo } from "./orchestrator.js";
import type { SceneGraph, PerceptionEvent, OcrRegion } from "../schema/types.js";

export interface ObserveOptions {
  source: string;
  language?: string;
  maxScenes?: number;
  /** Include scene-boundary markers in the perception track (default true). */
  sceneMarkers?: boolean;
  /** Drop OCR words below this confidence before merging (default 0.5). */
  ocrMinConfidence?: number;
  /** Ignore any cached scene graph and re-run the full pipeline. */
  refresh?: boolean;
  /** Skip the persistent graph cache entirely — neither read nor write. */
  noCache?: boolean;
  /** Invoked when the underlying analyze is served from the persistent cache. */
  onCacheHit?: () => void;
}

export interface ObserveResult extends SceneGraph {
  perception: PerceptionEvent[];
}

// OCR comes back as one region per word per sampled frame — hundreds of near
// -duplicate rows. Collapse it into stable on-screen "lines": join words that
// share a frame timestamp, then merge consecutive frames showing the same text
// into a single event spanning how long it was visible.
export function condenseOcr(regions: OcrRegion[], minConfidence: number): PerceptionEvent[] {
  const byFrame = new Map<number, OcrRegion[]>();
  for (const r of regions) {
    if ((r.confidence ?? 1) < minConfidence) continue;
    if (r.text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) continue; // drop punctuation/noise
    const list = byFrame.get(r.start_ms) ?? [];
    list.push(r);
    byFrame.set(r.start_ms, list);
  }

  // Build one joined line per frame, ordered top-to-bottom then left-to-right.
  const frames = [...byFrame.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t_ms, list]) => {
      const ordered = list.slice().sort((a, b) => {
        const dy = a.bbox[1] - b.bbox[1];
        return Math.abs(dy) > 24 ? dy : a.bbox[0] - b.bbox[0];
      });
      const end_ms = Math.max(...list.map((r) => r.end_ms));
      return { t_ms, end_ms, text: ordered.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim() };
    })
    .filter((f) => f.text.length > 0);

  // Merge consecutive frames with the same text into one visible span.
  const events: PerceptionEvent[] = [];
  for (const f of frames) {
    const prev = events[events.length - 1];
    if (prev && prev.text === f.text && f.t_ms - (prev.end_ms ?? prev.t_ms) <= 2000) {
      prev.end_ms = f.end_ms;
    } else {
      events.push({ kind: "read", t_ms: f.t_ms, end_ms: f.end_ms, text: f.text });
    }
  }
  return events;
}

const KIND_ORDER: Record<PerceptionEvent["kind"], number> = { scene: 0, see: 1, read: 2, hear: 3 };

export async function observeVideo(opts: ObserveOptions): Promise<ObserveResult> {
  const graph = await analyzeVideo({
    source: opts.source,
    language: opts.language,
    maxScenes: opts.maxScenes,
    includeKeyframes: false, // perception track doesn't need base64 blobs
    trackEntities: false,    // no lite SAM2 path; skip the overhead
    recognizeActions: true,  // this is the "watch" half — keep it on
    refresh: opts.refresh,
    noCache: opts.noCache,
    onCacheHit: opts.onCacheHit,
  });

  const perception: PerceptionEvent[] = [];

  // hear — spoken audio
  for (const seg of graph.transcript) {
    if (!seg.text.trim()) continue;
    perception.push({
      kind: "hear",
      t_ms: seg.start_ms,
      end_ms: seg.end_ms,
      text: seg.text.trim(),
      speaker: seg.speaker,
      confidence: seg.confidence,
    });
  }

  // see — what's visually happening (VLM scene captions)
  for (const action of graph.actions) {
    if (!action.label.trim()) continue;
    perception.push({
      kind: "see",
      t_ms: action.start_ms,
      end_ms: action.end_ms,
      text: action.label.trim(),
      scene_id: action.scene_id,
      confidence: action.confidence,
    });
  }

  // read — on-screen text
  perception.push(...condenseOcr(graph.ocr, opts.ocrMinConfidence ?? 0.5));

  // scene — shot boundaries
  if (opts.sceneMarkers !== false) {
    for (const scene of graph.scenes) {
      perception.push({
        kind: "scene",
        t_ms: scene.start_ms,
        end_ms: scene.end_ms,
        text: `Scene ${scene.id + 1}${scene.shot_type ? ` (${scene.shot_type})` : ""}`,
        scene_id: scene.id,
      });
    }
  }

  perception.sort((a, b) => (a.t_ms - b.t_ms) || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));

  return { ...graph, perception, _pipeline: graph._pipeline + "+observe" };
}

// Render a perception track as a human-readable script.
export function renderPerceptionText(result: ObserveResult): string {
  const stamp = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  const glyph: Record<PerceptionEvent["kind"], string> = {
    scene: "▸ scene",
    see: "  see  ",
    read: "  read ",
    hear: "  hear ",
  };
  const lines = [`# Perception track — ${result.source}`, ""];
  for (const e of result.perception) {
    const who = e.kind === "hear" && e.speaker ? ` ${e.speaker}:` : "";
    lines.push(`[${stamp(e.t_ms)}] ${glyph[e.kind]}${who} ${e.text}`);
  }
  if (result._warnings?.length) {
    lines.push("", "# warnings");
    for (const w of result._warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}
