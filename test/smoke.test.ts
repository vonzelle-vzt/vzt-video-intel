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

test("install: editor normalization + aliases", async () => {
  const { normalizeEditor, EDITORS } = await import("../src/install.js");
  assert.equal(normalizeEditor("claude-code"), "claude", "claude-code aliases to claude");
  assert.equal(normalizeEditor("vscode"), "copilot", "vscode aliases to copilot");
  assert.equal(normalizeEditor("CURSOR".toLowerCase()), "cursor");
  assert.equal(normalizeEditor("nonsense"), null, "unknown editor is null");
  for (const e of EDITORS) assert.equal(normalizeEditor(e), e, `${e} normalizes to itself`);
});

test("install: snippet shape per editor (JSON + TOML, Copilot type:stdio, token env)", async () => {
  const { buildSnippet, launchSpec } = await import("../src/install.js");
  const spec = launchSpec(); // platform-aware: npx on POSIX, cmd /c on Windows

  // Claude → mcpServers JSON, no type field, platform-correct launch.
  const claude = buildSnippet("claude");
  const claudeDoc = JSON.parse(claude.snippet);
  assert.ok(claudeDoc.mcpServers["vzt-video-intel"], "claude uses mcpServers root");
  assert.equal(claudeDoc.mcpServers["vzt-video-intel"].type, undefined, "claude has no type field");
  assert.equal(claudeDoc.mcpServers["vzt-video-intel"].command, spec.command);
  assert.deepEqual(claudeDoc.mcpServers["vzt-video-intel"].args, spec.args);
  // Whatever the launcher, the actual server invocation is always present.
  assert.ok([claudeDoc.mcpServers["vzt-video-intel"].command, ...claudeDoc.mcpServers["vzt-video-intel"].args].join(" ").includes("vzt-video-intel mcp"));

  // Copilot → servers root with explicit type:stdio.
  const copilot = buildSnippet("copilot");
  const copilotDoc = JSON.parse(copilot.snippet);
  assert.ok(copilotDoc.servers["vzt-video-intel"], "copilot uses servers root");
  assert.equal(copilotDoc.servers["vzt-video-intel"].type, "stdio", "copilot needs type:stdio");

  // Codex → TOML, not JSON.
  const codex = buildSnippet("codex");
  assert.match(codex.snippet, /\[mcp_servers\.vzt-video-intel\]/);
  assert.match(codex.snippet, new RegExp(`command = "${spec.command}"`));
  assert.equal(codex.file.endsWith("config.toml"), true);

  // Token embeds as an env entry in both formats.
  const withToken = buildSnippet("claude", { token: "r8_secret" });
  assert.equal(JSON.parse(withToken.snippet).mcpServers["vzt-video-intel"].env.REPLICATE_API_TOKEN, "r8_secret");
  const tomlToken = buildSnippet("codex", { token: "r8_secret" });
  assert.match(tomlToken.snippet, /REPLICATE_API_TOKEN = "r8_secret"/);
});

test("install: merge is idempotent + preserves existing servers", async () => {
  const { installEditor } = await import("../src/install.js");
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { join: pjoin } = await import("node:path");

  // Seed a Cursor config that already has an unrelated server.
  const dir = join(process.env.VZT_VIDEO_INTEL_HOME!, ".cursor");
  mkdirSync(dir, { recursive: true });
  const file = pjoin(dir, "mcp.json");
  writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 2));

  // Point HOME at the throwaway dir so installEditor writes there.
  const realHome = process.env.HOME;
  const realUserProfile = process.env.USERPROFILE;
  process.env.HOME = process.env.VZT_VIDEO_INTEL_HOME!;
  process.env.USERPROFILE = process.env.VZT_VIDEO_INTEL_HOME!;
  try {
    const first = installEditor("cursor");
    assert.equal(first.written, true);
    assert.equal(first.alreadyPresent, false, "first install: not already present");

    const doc1 = JSON.parse(readFileSync(first.file, "utf-8"));
    assert.ok(doc1.mcpServers.other, "existing server preserved");
    assert.ok(doc1.mcpServers["vzt-video-intel"], "our server added");

    const second = installEditor("cursor");
    assert.equal(second.alreadyPresent, true, "second install: already present");
    const doc2 = JSON.parse(readFileSync(second.file, "utf-8"));
    assert.equal(Object.keys(doc2.mcpServers).length, 2, "no duplicate entry on re-run");
  } finally {
    process.env.HOME = realHome;
    process.env.USERPROFILE = realUserProfile;
  }
});

test("eval metrics: WER, boundary F1, OCR recall (pure functions)", async () => {
  const { wordErrorRate, boundaryF1, ocrRecall } = await import("../src/eval/metrics.js");

  // WER — one substitution in five reference words = 0.2.
  assert.equal(wordErrorRate("the quick brown fox jumps", "the quick brown fox runs").wer, 0.2);
  assert.equal(wordErrorRate("hello world", "hello world").wer, 0, "identical → 0");
  assert.ok(wordErrorRate("a b", "a b c d").wer > 0, "insertions count as error");

  // Boundary F1 — predicted 7900 matches gold 8000 within ±1000; gold 4000 missed.
  const f = boundaryF1([7900], [4000, 8000], 1000);
  assert.equal(f.matched, 1);
  assert.equal(f.recall, 0.5);
  assert.equal(f.precision, 1);
  assert.ok(Math.abs(f.f1 - 0.6667) < 0.01, "F1 ~0.667");
  assert.equal(boundaryF1([], [], 1000).f1, 1, "nothing expected, nothing predicted → vacuously perfect");
  assert.equal(boundaryF1([5000], [], 1000).precision, 0, "predicted a boundary that doesn't exist → precision 0");

  // OCR recall — token-subset match, order/case-insensitive, words may be split.
  const r = ocrRecall(["SCENE", "ONE", "TWO", "THREE"], ["scene one", "scene three"]);
  assert.equal(r.recall, 1, "both phrases' tokens present");
  const r2 = ocrRecall(["SCENE", "ONE"], ["scene one", "scene four"]);
  assert.equal(r2.matched, 1);
  assert.deepEqual(r2.missing, ["scene four"]);
});

test("corpus search: ranking, phrase boost, kind filter (over the cached fixture)", async () => {
  // Seed the cache by analyzing the fixture, then query the corpus.
  process.env.VZT_MODE = "lite";
  const { analyzeVideo } = await import("../src/pipeline/orchestrator.js");
  const { searchCorpus } = await import("../src/pipeline/corpus.js");
  const fixture = join(root, "test/fixtures/sample.mp4");
  await analyzeVideo({ source: fixture, includeKeyframes: false, trackEntities: false, recognizeActions: true });

  const res = searchCorpus("scene three");
  assert.ok(res.videos >= 1, "at least the fixture is indexed");
  assert.ok(res.hits.length > 0, "finds hits");
  // Phrase match ("SCENE THREE" as one condensed OCR line) must outrank a bare
  // single-term match — the phrase boost is the whole point.
  assert.match(res.hits[0].text.toLowerCase(), /scene three/, "top hit is the phrase line");
  assert.ok(res.hits[0].score > res.hits[res.hits.length - 1].score, "ranked by score");

  // Kind filter restricts the track.
  const onlyRead = searchCorpus("scene", { kinds: ["read"] });
  assert.ok(onlyRead.hits.every((h) => h.kind === "read"), "kind filter respected");
  const onlySee = searchCorpus("blue", { kinds: ["see"] });
  assert.ok(onlySee.hits.every((h) => h.kind === "see"), "see-only filter respected");

  // No match → empty, no throw.
  assert.equal(searchCorpus("zzzznonexistentquery").hits.length, 0);
}, { timeout: 600_000 });

test("analyze --stream emits a complete event sequence + replays a cache hit", async () => {
  process.env.VZT_MODE = "lite";
  const { analyzeVideo } = await import("../src/pipeline/orchestrator.js");
  const fixture = join(root, "test/fixtures/sample.mp4");

  const events: { type: string }[] = [];
  await analyzeVideo({
    source: fixture,
    includeKeyframes: false,
    trackEntities: false,
    recognizeActions: true,
    onEvent: (e) => events.push(e),
  });
  const types = events.map((e) => e.type);
  assert.equal(types[0], "meta", "starts with meta");
  assert.ok(types.includes("scenes") && types.includes("transcript") && types.includes("ocr"), "stage-1 tracks emitted");
  assert.ok(types.includes("scene_analysis"), "per-scene events emitted");
  assert.equal(types[types.length - 1], "done", "ends with done");

  // A cache hit replays the same sequence (fromCache=true on the done event).
  const replay: { type: string; fromCache?: boolean }[] = [];
  await analyzeVideo({
    source: fixture,
    includeKeyframes: false,
    trackEntities: false,
    recognizeActions: true,
    onEvent: (e) => replay.push(e),
  });
  const done = replay.find((e) => e.type === "done") as { fromCache?: boolean } | undefined;
  assert.equal(done?.fromCache, true, "replayed from cache");
  assert.ok(replay.some((e) => e.type === "scenes"), "replay includes track events");
}, { timeout: 600_000 });

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
