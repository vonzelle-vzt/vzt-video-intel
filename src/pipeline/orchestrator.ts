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
import type { SceneGraph, Scene, Entity, Action, Keyframe, TranscriptSegment, OcrRegion } from "../schema/types.js";

// Incremental pipeline output. With `onEvent`, each track is emitted the moment
// it lands instead of waiting for the whole graph — the basis of `--stream`
// (JSONL) for long videos. Purely additive: the full SceneGraph is still
// returned and cached exactly as before.
export type StreamEvent =
  | { type: "meta"; source: string }
  | { type: "scenes"; scenes: Scene[]; duration_ms?: number }
  | { type: "transcript"; segments: TranscriptSegment[] }
  | { type: "ocr"; regions: OcrRegion[] }
  | { type: "keyframes"; count: number }
  | { type: "scene_analysis"; scene_id: number; entities: Entity[]; actions: Action[] }
  | { type: "warning"; message: string }
  | { type: "done"; duration_ms?: number; warnings?: string[]; fromCache: boolean };

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
  /** Emits each track as it's produced (and replays a cache hit as events). Powers `--stream`. */
  onEvent?: (event: StreamEvent) => void;
}

// Replay a finished/cached graph as the same event sequence a live run emits,
// so `--stream` behaves identically on a cache hit.
function emitGraphAsEvents(graph: SceneGraph, onEvent: (e: StreamEvent) => void): void {
  onEvent({ type: "meta", source: graph.source });
  onEvent({ type: "scenes", scenes: graph.scenes, duration_ms: graph.duration_ms });
  onEvent({ type: "transcript", segments: graph.transcript });
  onEvent({ type: "ocr", regions: graph.ocr });
  if (graph.keyframes?.length) onEvent({ type: "keyframes", count: graph.keyframes.length });
  for (const scene of graph.scenes) {
    onEvent({
      type: "scene_analysis",
      scene_id: scene.id,
      entities: graph.entities.filter((e) => e.appearances.some((a) => a.scene_id === scene.id)),
      actions: graph.actions.filter((a) => a.scene_id === scene.id),
    });
  }
  for (const w of graph._warnings ?? []) onEvent({ type: "warning", message: w });
  onEvent({ type: "done", duration_ms: graph.duration_ms, warnings: graph._warnings, fromCache: true });
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
        if (opts.onEvent) emitGraphAsEvents(hit, opts.onEvent);
        return hit;
      }
    }
  }

  opts.onEvent?.({ type: "meta", source: opts.source });
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

  // Stage 1 results are final — emit them now so a streaming consumer can start
  // working while stage 2 (the slow per-scene work) is still running.
  opts.onEvent?.({ type: "scenes", scenes, duration_ms });
  opts.onEvent?.({ type: "transcript", segments: transcriptRes.segments });
  opts.onEvent?.({ type: "ocr", regions: ocrRes.regions });

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
    // Collect this scene's results locally so we can both push to the graph
    // and emit them as a single per-scene event for streaming consumers.
    const sceneEntities: Entity[] = [];
    const sceneActions: Action[] = [];
    const jobs: { kind: "entities" | "actions"; run: Promise<unknown> }[] = [];
    if (wantEntities) {
      jobs.push({
        kind: "entities",
        run: trackEntities({ source: opts.source, sceneStartMs: scene.start_ms, sceneEndMs: scene.end_ms }).then((r) => {
          sceneEntities.push(...r.entities);
        }),
      });
    }
    if (wantActions) {
      jobs.push({
        kind: "actions",
        run: recognizeActions({ source: opts.source, sceneStartMs: scene.start_ms, sceneEndMs: scene.end_ms }).then((r) => {
          sceneActions.push(...r.actions.map((a) => ({ ...a, scene_id: scene.id })));
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
    entities.push(...sceneEntities);
    actions.push(...sceneActions);
    opts.onEvent?.({ type: "scene_analysis", scene_id: scene.id, entities: sceneEntities, actions: sceneActions });
  }

  if (wantKeyframes) {
    try {
      const kf = await extractKeyframes({ source: opts.source, perScene: true });
      keyframes.push(...kf.keyframes);
      opts.onEvent?.({ type: "keyframes", count: keyframes.length });
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

  for (const w of warnings) opts.onEvent?.({ type: "warning", message: w });
  opts.onEvent?.({ type: "done", duration_ms, warnings: warnings.length ? warnings : undefined, fromCache: false });

  return graph;
}
