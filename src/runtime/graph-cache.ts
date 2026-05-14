// Persistent scene-graph store — "analyze once, query forever".
//
// analyzeVideo() writes its result here keyed by a content hash of
// (source identity + pipeline-affecting options + resolved routing + schema
// version). Re-running the same analysis is then an instant disk read instead
// of a full pipeline pass. observe/search/chapters that call analyzeVideo
// inherit the cache for free. A changed file or a version bump misses cleanly.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { configDir } from "../lib/env.js";
import type { SceneGraph } from "../schema/types.js";

export function graphCacheDir(): string {
  return join(configDir(), "graphs");
}

// The slice of AnalyzeOptions that changes the produced graph. Anything not
// here (sceneConcurrency, callbacks) doesn't affect the payload's identity.
export interface GraphCacheKeyInput {
  source: string;
  maxScenes?: number;
  language?: string;
  includeKeyframes?: boolean;
  includeMuxUrls?: boolean;
  trackEntities?: boolean;
  recognizeActions?: boolean;
  /** JSON-serialized per-stage routing — lite vs cloud produce different graphs. */
  routingSignature: string;
  /** Schema version — a bump auto-invalidates every prior entry. */
  version: string;
}

// A local file's identity is path + size + mtime: cheap (no full read) and it
// changes the moment the file is edited, so a stale cache self-invalidates.
// A URL is identified by the URL string alone.
function sourceIdentity(source: string): string {
  if (/^https?:\/\//i.test(source)) return `url:${source}`;
  try {
    const st = statSync(source);
    return `file:${source}:${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    // Not stat-able — analyzeVideo will fail downstream anyway; this just
    // means we never produce a cache hit for it.
    return `raw:${source}`;
  }
}

export function cacheKey(input: GraphCacheKeyInput): string {
  const material = JSON.stringify({
    s: sourceIdentity(input.source),
    m: input.maxScenes ?? null,
    l: input.language ?? null,
    k: input.includeKeyframes !== false,
    x: !!input.includeMuxUrls,
    e: input.trackEntities !== false,
    a: input.recognizeActions !== false,
    r: input.routingSignature,
    v: input.version,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function graphPath(key: string): string {
  return join(graphCacheDir(), `${key}.json`);
}

export function readGraph(key: string): SceneGraph | null {
  try {
    const path = graphPath(key);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as SceneGraph;
  } catch {
    return null; // corrupt / unreadable — treat as a miss
  }
}

export function writeGraph(key: string, graph: SceneGraph): void {
  const dir = graphCacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(graphPath(key), JSON.stringify(graph));
}

export interface CachedGraphInfo {
  key: string;
  source: string;
  version: string;
  generatedAt: string;
  sizeBytes: number;
}

export function listGraphs(): CachedGraphInfo[] {
  const dir = graphCacheDir();
  if (!existsSync(dir)) return [];
  const out: CachedGraphInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    try {
      const st = statSync(path);
      const g = JSON.parse(readFileSync(path, "utf-8")) as SceneGraph;
      out.push({
        key: name.replace(/\.json$/, ""),
        source: g.source,
        version: g._version,
        generatedAt: g._generated_at,
        sizeBytes: st.size,
      });
    } catch {
      // skip corrupt entries
    }
  }
  return out.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export function clearGraphs(): number {
  const dir = graphCacheDir();
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    rmSync(join(dir, name));
    n++;
  }
  return n;
}
