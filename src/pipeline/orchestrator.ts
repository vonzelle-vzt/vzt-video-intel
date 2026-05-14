// Full pipeline. Fires all 6 backends with the right dependencies:
//   stage 1 (parallel): scene detection, transcription, OCR
//   stage 2 (parallel per scene): entity tracking, action recognition, keyframes
//
// Outputs a SceneGraph that's safe to hand to Claude — every element
// timestamped, every entity tracked by stable ID.

import { detectScenes, extractKeyframes } from "../backends/scene-detect.js";
import { transcribe } from "../backends/whisperx.js";
import { ocrOverlay } from "../backends/easyocr.js";
import { trackEntities } from "../backends/sam2.js";
import { recognizeActions } from "../backends/qwen-vl.js";
import { loadEnv } from "../lib/env.js";
import { getRouting } from "../runtime/mode.js";
import { cacheKey, readGraph, writeGraph } from "../runtime/graph-cache.js";
import type { SceneGraph, Entity, Action, Keyframe, TranscriptSegment, OcrRegion } from "../schema/types.js";

export interface AnalyzeOptions {
  source: string;
  includeKeyframes?: boolean;
  includeMuxUrls?: boolean;
  language?: string;
  maxScenes?: number;
  /** Run entity tracking — disable for speed on long videos */
  trackEntities?: boolean;
  /** Run action recognition (uses Qwen2.5-VL — most expensive stage) */
  recognizeActions?: boolean;
  /** Concurrency for per-scene work */
  sceneConcurrency?: number;
  /** Ignore any cached scene graph and re-run the full pipeline (still rewrites the cache). */
  refresh?: boolean;
  /** Skip the persistent graph cache entirely — neither read nor write. */
  noCache?: boolean;
  /** Invoked when the result is served from the persistent cache (no pipeline run). */
  onCacheHit?: () => void;
}

const VERSION = "1.4.1";

export async function analyzeVideo(opts: AnalyzeOptions): Promise<SceneGraph> {
  const env = loadEnv();

  // Persistent scene-graph cache — "analyze once, query forever". The key
  // covers source identity + every pipeline-affecting option + resolved
  // routing + schema version, so a hit is guaranteed to match what a fresh
  // run would produce. A changed file (new mtime/size) or a version bump
  // misses cleanly.
  let key: string | null = null;
  if (!opts.noCache) {
    const { routing } = await getRouting();
    key = cacheKey({
      source: opts.source,
      maxScenes: opts.maxScenes,
      language: opts.language,
      includeKeyframes: opts.includeKeyframes,
      includeMuxUrls: opts.includeMuxUrls,
      trackEntities: opts.trackEntities,
      recognizeActions: opts.recognizeActions,
      routingSignature: JSON.stringify(routing),
      version: VERSION,
    });
    if (!opts.refresh) {
      const hit = readGraph(key);
      if (hit) {
        opts.onCacheHit?.();
        return hit;
      }
    }
  }

  const warnings: string[] = [];

  // Stage 1: scenes + transcript + OCR — fully independent, fire in parallel.
  // `allSettled` (not `all`) so one backend crashing degrades the graph
  // instead of taking down the whole analyze. Scene detection is the only
  // hard dependency — without it there's nothing to hang timestamps on.
  const [scenesSettled, transcriptSettled, ocrSettled] = await Promise.allSettled([
    detectScenes({ source: opts.source, maxScenes: opts.maxScenes ?? 200 }),
    transcribe({ source: opts.source, language: opts.language, diarize: true }),
    ocrOverlay({ source: opts.source }),
  ]);

  function reason(r: PromiseRejectedResult): string {
    return r.reason instanceof Error ? r.reason.message : String(r.reason);
  }

  if (scenesSettled.status === "rejected") {
    throw new Error(`scene detection failed (required stage): ${reason(scenesSettled)}`);
  }
  const scenesRes = scenesSettled.value;

  const transcriptRes = transcriptSettled.status === "fulfilled"
    ? transcriptSettled.value
    : (warnings.push(`transcription failed: ${reason(transcriptSettled)}`), { segments: [] as TranscriptSegment[] });

  const ocrRes = ocrSettled.status === "fulfilled"
    ? ocrSettled.value
    : (warnings.push(`OCR failed: ${reason(ocrSettled)}`), { regions: [] as OcrRegion[] });

  const scenes = scenesRes.scenes;
  const duration_ms = scenesRes.duration_ms ?? (scenes.length ? scenes[scenes.length - 1].end_ms : undefined);

  // Stage 2: per-scene work — entity tracking + actions + keyframes
  const entities: Entity[] = [];
  const actions: Action[] = [];
  const keyframes: Keyframe[] = [];

  const concurrency = Math.max(1, opts.sceneConcurrency ?? 2);
  const wantEntities = opts.trackEntities !== false;
  const wantActions = opts.recognizeActions !== false;
  const wantKeyframes = opts.includeKeyframes !== false;

  // Per-scene backend failures don't abort the run — they degrade the stage
  // and surface as a `_warnings[]` entry. Counted here, reported after stage 2.
  let actionFailures = 0;
  let entityFailures = 0;

  async function processScene(scene: { id: number; start_ms: number; end_ms: number }) {
    const jobs: { kind: "entities" | "actions"; run: Promise<unknown> }[] = [];
    if (wantEntities) {
      jobs.push({
        kind: "entities",
        run: trackEntities({ source: opts.source, sceneStartMs: scene.start_ms, sceneEndMs: scene.end_ms }).then((r) => {
          entities.push(...r.entities);
        }),
      });
    }
    if (wantActions) {
      jobs.push({
        kind: "actions",
        run: recognizeActions({ source: opts.source, sceneStartMs: scene.start_ms, sceneEndMs: scene.end_ms }).then((r) => {
          actions.push(...r.actions.map((a) => ({ ...a, scene_id: scene.id })));
        }),
      });
    }
    const settled = await Promise.allSettled(jobs.map((j) => j.run));
    settled.forEach((s, i) => {
      if (s.status === "rejected") {
        if (jobs[i].kind === "actions") actionFailures++;
        else entityFailures++;
      }
    });
  }

  if (wantKeyframes) {
    try {
      const kf = await extractKeyframes({ source: opts.source, perScene: true });
      keyframes.push(...kf.keyframes);
    } catch (err) {
      warnings.push(`keyframe extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (let i = 0; i < scenes.length; i += concurrency) {
    await Promise.allSettled(scenes.slice(i, i + concurrency).map(processScene));
  }

  if (actionFailures > 0) {
    warnings.push(`action recognition failed on ${actionFailures}/${scenes.length} scene(s)`);
  }
  if (entityFailures > 0) {
    warnings.push(`entity tracking failed on ${entityFailures}/${scenes.length} scene(s)`);
  }

  const graph: SceneGraph = {
    source: opts.source,
    duration_ms,
    scenes,
    transcript: transcriptRes.segments,
    entities,
    actions,
    ocr: ocrRes.regions,
    keyframes: wantKeyframes ? keyframes : undefined,
    mux_base: opts.includeMuxUrls ? env.muxBase || null : null,
    _warnings: warnings.length ? warnings : undefined,
    _pipeline: "whisperx+scenedetect+easyocr+sam2+qwen-vl+clip",
    _generated_at: new Date().toISOString(),
    _version: VERSION,
  };

  // Persist for the next run. Partial graphs (with `_warnings`) are cached
  // too — `refresh: true` is the escape hatch to retry a degraded run.
  if (key && !opts.noCache) writeGraph(key, graph);

  return graph;
}
