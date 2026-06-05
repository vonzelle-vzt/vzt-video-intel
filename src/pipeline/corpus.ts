// Corpus indexing + cross-video search — the "index layer" north star.
//
// A single video's scene graph is already a persistent, content-addressed
// artifact (see runtime/graph-cache.ts). The corpus is simply the *set* of
// those cached graphs: `indexCorpus` analyzes every video under a directory
// (instant for ones already cached — analyze once, query forever), and
// `searchCorpus` runs one query across the whole library.
//
// Cross-video search is the thing a stateless, per-call native-ingest API
// structurally cannot do: it has no persistent index to search. Here it is
// lexical retrieval over the text tracks every scene graph already carries —
// transcript (hear), OCR (read), action/caption labels (see), entity labels,
// and chapter titles/summaries. Zero extra model calls, works offline in lite
// mode, instant from cache. (True embedding-based semantic search across the
// corpus is a future upgrade; see docs/CORPUS.md.)

import { readdirSync, statSync } from "node:fs";
import { platform } from "node:os";
import { extname, join, resolve } from "node:path";
import { analyzeVideo } from "./orchestrator.js";
import { condenseOcr } from "./observe.js";
import { listGraphs, readGraph } from "../runtime/graph-cache.js";
import type { SceneGraph } from "../schema/types.js";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".m3u8"]);

// ---- indexing ----------------------------------------------------------------

export interface IndexOptions {
  /** Recurse into subdirectories (default true). */
  recursive?: boolean;
  /** Run entity tracking while indexing (cloud SAM2 only; default false for speed/lite). */
  trackEntities?: boolean;
  /** Run action/caption recognition — populates the "see" text track (default true). */
  recognizeActions?: boolean;
  /** Language hint passed through to transcription. */
  language?: string;
  /** Per-video progress callback. */
  onVideo?: (info: { source: string; status: "cached" | "analyzed" | "failed"; index: number; total: number }) => void;
}

export interface IndexedVideo {
  source: string;
  status: "cached" | "analyzed" | "failed";
  durationMs?: number;
  scenes?: number;
  error?: string;
}

export interface IndexResult {
  dir: string;
  total: number;
  analyzed: number;
  fromCache: number;
  failed: number;
  totalDurationMs: number;
  videos: IndexedVideo[];
}

function findVideos(dir: string, recursive: boolean): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (recursive) out.push(...findVideos(full, recursive));
    } else if (VIDEO_EXTS.has(extname(name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

export async function indexCorpus(dir: string, opts: IndexOptions = {}): Promise<IndexResult> {
  const recursive = opts.recursive !== false;
  const sources = findVideos(dir, recursive).sort();
  const videos: IndexedVideo[] = [];
  let analyzed = 0;
  let fromCache = 0;
  let failed = 0;
  let totalDurationMs = 0;

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    let wasCached = false;
    try {
      const graph = await analyzeVideo({
        source,
        includeKeyframes: false, // corpus index doesn't need base64 blobs
        trackEntities: opts.trackEntities === true,
        recognizeActions: opts.recognizeActions !== false,
        language: opts.language,
        onCacheHit: () => {
          wasCached = true;
        },
      });
      const status = wasCached ? "cached" : "analyzed";
      if (wasCached) fromCache++;
      else analyzed++;
      totalDurationMs += graph.duration_ms ?? 0;
      const info: IndexedVideo = { source, status, durationMs: graph.duration_ms, scenes: graph.scenes.length };
      videos.push(info);
      opts.onVideo?.({ source, status, index: i + 1, total: sources.length });
    } catch (err) {
      failed++;
      const error = err instanceof Error ? err.message : String(err);
      videos.push({ source, status: "failed", error });
      opts.onVideo?.({ source, status: "failed", index: i + 1, total: sources.length });
    }
  }

  return { dir, total: sources.length, analyzed, fromCache, failed, totalDurationMs, videos };
}

// ---- cross-video search ------------------------------------------------------

export interface CorpusSearchOptions {
  topK?: number;
  /** Restrict to specific source paths/URLs (substring match). */
  sources?: string[];
  /** Restrict to certain track kinds. */
  kinds?: CorpusHitKind[];
  /** Minimum score to include (default 0). */
  minScore?: number;
}

export type CorpusHitKind = "hear" | "read" | "see" | "entity" | "chapter";

export interface CorpusHit {
  source: string;
  kind: CorpusHitKind;
  t_ms: number;
  end_ms?: number;
  text: string;
  score: number;
}

export interface CorpusSearchResult {
  query: string;
  videos: number; // distinct videos searched
  hits: CorpusHit[];
}

// Small stopword set — drop terms that match everything and add no signal.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "is", "are",
  "was", "were", "be", "with", "for", "it", "this", "that", "as", "by",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

interface SearchUnit {
  kind: CorpusHitKind;
  t_ms: number;
  end_ms?: number;
  text: string;
}

// Pull every time-bounded text fragment out of a scene graph. These are the
// units we rank — each carries enough to cite back (source + timestamp).
function unitsFromGraph(graph: SceneGraph): SearchUnit[] {
  const units: SearchUnit[] = [];
  for (const seg of graph.transcript) {
    if (seg.text.trim()) units.push({ kind: "hear", t_ms: seg.start_ms, end_ms: seg.end_ms, text: seg.text.trim() });
  }
  // Raw OCR is one region per word per sampled frame. Condense to stable
  // on-screen lines (the same merge `observe` does) so a phrase like
  // "scene three" matches a single unit instead of scattered word fragments.
  for (const line of condenseOcr(graph.ocr, 0.5)) {
    if (line.text.trim()) units.push({ kind: "read", t_ms: line.t_ms, end_ms: line.end_ms, text: line.text.trim() });
  }
  for (const a of graph.actions) {
    if (a.label.trim()) units.push({ kind: "see", t_ms: a.start_ms, end_ms: a.end_ms, text: a.label.trim() });
  }
  for (const kf of graph.keyframes ?? []) {
    if (kf.caption?.trim()) units.push({ kind: "see", t_ms: kf.t_ms, text: kf.caption.trim() });
  }
  for (const e of graph.entities) {
    const ap = e.appearances[0];
    if (e.label.trim() && ap) units.push({ kind: "entity", t_ms: ap.start_ms, end_ms: ap.end_ms, text: e.label.trim() });
  }
  for (const c of graph.chapters ?? []) {
    const text = [c.title, c.summary].filter(Boolean).join(" — ").trim();
    if (text) units.push({ kind: "chapter", t_ms: c.start_ms, end_ms: c.end_ms, text });
  }
  return units;
}

// Field weights — a chapter title or visible caption matching is a slightly
// stronger signal than an incidental word in a long transcript line.
const KIND_WEIGHT: Record<CorpusHitKind, number> = {
  chapter: 1.3,
  see: 1.15,
  read: 1.1,
  entity: 1.1,
  hear: 1.0,
};

function scoreUnit(unitText: string, queryTokens: string[], normalizedQuery: string): number {
  const unitLower = unitText.toLowerCase();
  const unitTokens = new Set(tokenize(unitText));
  let matched = 0;
  for (const qt of queryTokens) if (unitTokens.has(qt)) matched++;
  if (matched === 0 && !unitLower.includes(normalizedQuery)) return 0;
  // Fraction of (meaningful) query terms present, plus a phrase-substring boost.
  const base = queryTokens.length ? matched / queryTokens.length : 0;
  const phraseBoost = normalizedQuery.length >= 3 && unitLower.includes(normalizedQuery) ? 0.5 : 0;
  return base + phraseBoost;
}

// Group key for "the same physical video". A local path analyzed as
// `test/fixtures/x.mp4` and `test\fixtures\x.mp4` is one video — resolve +
// normalize separators (case-insensitively on Windows) so they collapse. URLs
// are identity-compared as-is.
function sourceGroupKey(source: string): string {
  if (/^https?:\/\//i.test(source)) return source;
  const norm = resolve(source).replace(/\\/g, "/");
  return platform() === "win32" ? norm.toLowerCase() : norm;
}

// One scene graph per source — the cache can hold several entries for the same
// video (different options/routing); keep the newest, richest one.
function dedupeBySource(): SceneGraph[] {
  const newest = new Map<string, { graph: SceneGraph; at: string }>();
  for (const info of listGraphs()) {
    const graph = readGraph(info.key);
    if (!graph) continue;
    const gk = sourceGroupKey(graph.source);
    const prev = newest.get(gk);
    if (!prev || graph._generated_at > prev.at) newest.set(gk, { graph, at: graph._generated_at });
  }
  return [...newest.values()].map((v) => v.graph);
}

export function searchCorpus(query: string, opts: CorpusSearchOptions = {}): CorpusSearchResult {
  const queryTokens = tokenize(query).filter((t) => !STOPWORDS.has(t));
  const normalizedQuery = query.toLowerCase().trim();
  const topK = opts.topK ?? 20;
  const minScore = opts.minScore ?? 0;
  const kindFilter = opts.kinds ? new Set(opts.kinds) : null;

  let graphs = dedupeBySource();
  if (opts.sources?.length) {
    graphs = graphs.filter((g) => opts.sources!.some((s) => g.source.includes(s)));
  }

  const hits: CorpusHit[] = [];
  for (const graph of graphs) {
    for (const unit of unitsFromGraph(graph)) {
      if (kindFilter && !kindFilter.has(unit.kind)) continue;
      const raw = scoreUnit(unit.text, queryTokens, normalizedQuery);
      if (raw <= 0) continue;
      const score = raw * KIND_WEIGHT[unit.kind];
      if (score < minScore) continue;
      hits.push({ source: graph.source, kind: unit.kind, t_ms: unit.t_ms, end_ms: unit.end_ms, text: unit.text, score });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.t_ms - b.t_ms);
  return { query, videos: graphs.length, hits: hits.slice(0, topK) };
}
