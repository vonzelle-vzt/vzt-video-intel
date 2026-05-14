// Smoke test — no backend required.
// Asserts the MCP server can be constructed and the CLI runs --help cleanly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

// Isolate every test from the real ~/.vzt-video-intel — config AND the
// persistent graph cache land in a throwaway dir instead.
process.env.VZT_VIDEO_INTEL_HOME = join(tmpdir(), `vintel-test-${process.pid}-${Date.now()}`);

test("CLI binary prints help", () => {
  const result = spawnSync("node", ["--import", "tsx", join(root, "src/cli.ts"), "--help"], {
    encoding: "utf-8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, "CLI --help should exit 0");
  assert.match(result.stdout, /vzt-video-intel/);
  assert.match(result.stdout, /analyze/);
  assert.match(result.stdout, /observe/);
  assert.match(result.stdout, /auto/);
  assert.match(result.stdout, /mcp/);
});

test("MCP server module imports", async () => {
  const mod = await import("../src/index.js");
  assert.equal(typeof mod.startMcpServer, "function");
});

test("Orchestrator module imports + has analyzeVideo", async () => {
  const mod = await import("../src/pipeline/orchestrator.js");
  assert.equal(typeof mod.analyzeVideo, "function");
});

test("Observe module imports + has observeVideo + renderer", async () => {
  const mod = await import("../src/pipeline/observe.js");
  assert.equal(typeof mod.observeVideo, "function");
  assert.equal(typeof mod.renderPerceptionText, "function");
});

test("All 6 backend modules import", async () => {
  await import("../src/backends/whisperx.js");
  await import("../src/backends/qwen-vl.js");
  await import("../src/backends/sam2.js");
  await import("../src/backends/scene-detect.js");
  await import("../src/backends/easyocr.js");
  await import("../src/backends/clip.js");
});

test("Schema types module imports", async () => {
  await import("../src/schema/types.js");
});

test("Runtime modules import (auto, mode, cache)", async () => {
  const auto = await import("../src/runtime/auto.js");
  const mode = await import("../src/runtime/mode.js");
  const cache = await import("../src/runtime/cache.js");
  assert.equal(typeof auto.detect, "function");
  assert.equal(typeof auto.resolveMode, "function");
  assert.equal(typeof mode.resolveStage, "function");
  assert.equal(typeof cache.readConfig, "function");
});

test("Cloud backends import", async () => {
  await import("../src/backends/cloud/replicate.js");
  await import("../src/backends/cloud/whisperx.js");
  await import("../src/backends/cloud/qwen-vl.js");
  await import("../src/backends/cloud/sam2.js");
  await import("../src/backends/cloud/clip.js");
  await import("../src/backends/cloud/easyocr.js");
});

test("Lite backends import", async () => {
  await import("../src/backends/lite/whisper-wasm.js");
  await import("../src/backends/lite/ffmpeg-scenes.js");
  await import("../src/backends/lite/tesseract-ocr.js");
  await import("../src/backends/lite/clip-onnx.js");
  const vlm = await import("../src/backends/lite/vlm-caption.js");
  assert.equal(typeof vlm.liteCaptionImage, "function");
  assert.equal(typeof vlm.liteRecognizeActions, "function");
  assert.equal(typeof vlm.liteGenerateChapters, "function");
});

// The caption model runs in a child process so a crash is a catchable child
// exit, not a hard abort of `analyze`. A bad frame path fails fast (before the
// model even loads) and must come back as a rejection — proving the failure
// path is catchable and the parent survives.
test("lite caption worker: bad frame path rejects cleanly, no process crash", { timeout: 120_000 }, async () => {
  const { liteCaptionImage } = await import("../src/backends/lite/vlm-caption.js");
  await assert.rejects(
    liteCaptionImage(join(tmpdir(), `vintel-no-such-frame-${Date.now()}.jpg`)),
    "captioning a missing frame must reject, not crash the process",
  );
});

test("vintel auto prints environment report", () => {
  const result = spawnSync("node", ["--import", "tsx", join(root, "src/cli.ts"), "auto"], {
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, VZT_VIDEO_INTEL_HOME: "/tmp/vintel-smoke-test" },
  });
  assert.equal(result.status, 0, "auto should exit 0");
  assert.match(result.stdout, /Environment:/);
  assert.match(result.stdout, /Resolved mode:/);
  assert.match(result.stdout, /Per-stage routing:/);
});

// Real watch+listen run on the bundled fixture. Downloads the WASM models on
// first run (cached after), so the timeout is generous. Verifies the perception
// track actually fuses multiple senses into one coherent, time-sorted timeline.
test("vintel observe fuses senses on the fixture", { timeout: 600_000 }, async () => {
  process.env.VZT_MODE = "lite";
  const { observeVideo, renderPerceptionText } = await import("../src/pipeline/observe.js");
  const fixture = join(root, "test/fixtures/sample.mp4");

  const result = await observeVideo({ source: fixture });

  assert.ok(Array.isArray(result.perception), "perception should be an array");
  assert.ok(result.perception.length > 0, "perception track should not be empty");

  // Time-sorted, every event timestamped.
  for (let i = 1; i < result.perception.length; i++) {
    assert.ok(result.perception[i].t_ms >= result.perception[i - 1].t_ms, "perception must be time-sorted");
  }
  for (const e of result.perception) {
    assert.equal(typeof e.t_ms, "number", "every event has t_ms");
    assert.ok(["hear", "see", "read", "scene"].includes(e.kind), `valid kind: ${e.kind}`);
  }

  // It's a fusion: at least two distinct senses must show up.
  const kinds = new Set(result.perception.map((e) => e.kind));
  assert.ok(kinds.size >= 2, `expected multiple senses, got: ${[...kinds].join(", ")}`);

  // The text renderer produces a readable script.
  const text = renderPerceptionText(result);
  assert.match(text, /Perception track/);
});

test("graph-cache: key determinism + read/write/list/clear", async () => {
  const gc = await import("../src/runtime/graph-cache.js");
  gc.clearGraphs();

  const base = { source: "https://example.com/x.mp4", routingSignature: "{}", version: "1.4.0" };
  assert.equal(gc.cacheKey(base), gc.cacheKey(base), "same input → same key");
  assert.notEqual(gc.cacheKey(base), gc.cacheKey({ ...base, language: "es" }), "language changes the key");
  assert.notEqual(gc.cacheKey(base), gc.cacheKey({ ...base, version: "1.3.0" }), "version changes the key");
  assert.notEqual(gc.cacheKey(base), gc.cacheKey({ ...base, routingSignature: "x" }), "routing changes the key");

  const key = gc.cacheKey(base);
  assert.equal(gc.readGraph(key), null, "missing key reads back null");

  const fake = {
    source: base.source,
    scenes: [],
    transcript: [],
    entities: [],
    actions: [],
    ocr: [],
    _pipeline: "test",
    _generated_at: new Date().toISOString(),
    _version: "1.4.0",
  };
  gc.writeGraph(key, fake);
  assert.deepEqual(gc.readGraph(key), fake, "written graph reads back identical");
  assert.equal(gc.listGraphs().length, 1, "listGraphs sees the entry");
  assert.equal(gc.clearGraphs(), 1, "clearGraphs removes it");
  assert.equal(gc.listGraphs().length, 0, "store is empty after clear");
});

// "Analyze once, query forever" — the second run of the same video must come
// straight from disk, with refresh/noCache as the documented escape hatches.
test("persistent graph cache: analyze once, query forever", { timeout: 600_000 }, async () => {
  process.env.VZT_MODE = "lite";
  const { observeVideo } = await import("../src/pipeline/observe.js");
  const { listGraphs, clearGraphs } = await import("../src/runtime/graph-cache.js");
  const fixture = join(root, "test/fixtures/sample.mp4");

  clearGraphs(); // start from a clean slate (the observe test above writes one)
  let hits = 0;
  const onCacheHit = () => { hits++; };

  // First run — full pipeline, no hit, writes to the cache.
  const first = await observeVideo({ source: fixture, onCacheHit });
  assert.equal(hits, 0, "first run must not be a cache hit");
  assert.equal(listGraphs().length, 1, "first run should write one cached graph");

  // Second run — served from cache, byte-identical perception track.
  const second = await observeVideo({ source: fixture, onCacheHit });
  assert.equal(hits, 1, "second run must be a cache hit");
  assert.deepEqual(second.perception, first.perception, "cached result must match the fresh run");

  // refresh — bypasses the cache read (still a full run).
  await observeVideo({ source: fixture, onCacheHit, refresh: true });
  assert.equal(hits, 1, "refresh must not count as a cache hit");

  // noCache — neither reads nor writes.
  clearGraphs();
  await observeVideo({ source: fixture, onCacheHit, noCache: true });
  assert.equal(hits, 1, "noCache must not produce a hit");
  assert.equal(listGraphs().length, 0, "noCache must not write to the store");
});
