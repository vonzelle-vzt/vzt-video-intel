# Architecture

The whole point of VZT Video-Intel is to produce a **temporal scene graph** that an LLM can quote by timestamp. This doc explains why the pipeline is shaped the way it is.

## Pipeline

```
Stage 1 (parallel, fully independent)
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ ffmpeg       │  │ Whisper      │  │ Tesseract /  │
│ scene bounds │  │ transcript   │  │ cloud OCR    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └────────┬────────┴─────────────────┘
                ▼
Stage 2 (per-scene, parallel within concurrency budget)
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ SAM2 cloud   │  │ Qwen2.5-VL   │  │ ffmpeg       │
│ entity track │  │ actions      │  │ keyframes    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       └────────┬────────┴─────────────────┘
                ▼
Stage 3 (on demand)
┌──────────────────┐
│ CLIP             │
│ moment search    │
└──────────────────┘
                ▼
            Scene Graph
```

## Why these models specifically

| Stage | Lite | Cloud | Why this combo |
|---|---|---|---|
| Transcript | Whisper-tiny.en (WASM, 39 MB), 30s-windowed | incredibly-fast-whisper | Lite gets ~95% of the quality at 0% of the cost. Cloud is faster for long-form content. |
| Scenes | ffmpeg-static `select=gt(scene)` | (lite always) | CPU-light, sub-second on short clips. No GPU value-add. |
| OCR | Tesseract.js (WASM) | cloud OCR equivalent | Lite handles 95% of overlay text accurately. Cloud is better for dense text or non-Latin scripts. |
| Entities | (skipped) | SAM2 video | SAM2 is the only model that does video segmentation with stable IDs. Too heavy for CPU WASM. |
| Actions | ViT-GPT2 caption (WASM, ~250 MB) | Qwen2.5-VL | Lite captions one frame per scene — coarse, but it's real visual understanding offline. Qwen is far sharper; too heavy for CPU. |
| Search | CLIP ViT-B/32 (ONNX) | CLIP-features | Both run the same model class; lite via @xenova/transformers, cloud at scale. |

## Why two modes (lite + cloud) instead of three

v1.0–v1.1 shipped a third "local" mode — six FastAPI services in a docker-compose stack for users with their own GPUs. **We dropped it in v1.2.0.**

Reasons:
- The cloud + lite combo covers 99% of real use cases. Cloud for "full quality, pay per use". Lite for "free, offline, good enough".
- The docker stack added a ton of install friction: 6 images, ~30 GB total, CUDA toolkit, NVIDIA Container Toolkit. For most users that was a much bigger ask than "paste a Replicate token".
- Anyone genuinely doing >1k hours/month and wanting to self-host can run Replicate's `cog` templates on their own GPUs directly (Replicate publishes all of them).

The dispatcher architecture still supports adding a "local" provider — it's just not shipped by default.

## Concurrency model

The orchestrator at `src/pipeline/orchestrator.ts`:

1. **Stage 1**: fires `Promise.allSettled([detectScenes, transcribe, ocrOverlay])`. No data dependencies between them. Scene detection is the one hard requirement — without it there's nothing to hang timestamps on, so a scene-detection failure throws. Transcription or OCR failing instead degrades gracefully: the stage returns empty, a line is pushed to `_warnings[]`, and the pipeline carries on. `analyze` exits 0 with a partial graph rather than bailing.
2. **Stage 2**: iterates scenes in chunks of `sceneConcurrency` (default 2). For each scene, fires entity tracking + action recognition in parallel. Wraps with `Promise.allSettled` so a single scene failure doesn't kill the run. Keyframe extraction is also wrapped — a failure there is a warning, not a crash.
3. **Stage 3**: only runs when the caller explicitly invokes `semantic_search` — it requires CLIP embeddings on every sampled frame which is its own pass.

Per-scene backend failures in Stage 2 don't abort the run — a failed scene degrades to fewer entities/actions and surfaces as a `_warnings[]` line, same as Stage 1.

## Lite captioning runs out-of-process

The lite caption model (vit-gpt2, ONNX/WASM) runs in a **child process** — `src/backends/lite/caption-worker.ts`, driven by `src/backends/lite/vlm-caption.ts`. Inside `analyze` it would otherwise share a process, and a WASM heap, with the Whisper and Tesseract runtimes; on a long video onnxruntime can't allocate its session and the whole process aborts with `bad allocation`. A child gets a fresh heap. The worker loads the model once and is reused for every frame via line-delimited JSON IPC (`{id, imagePath}` → `{id, caption | error}`); it's spawned lazily on the first caption and killed when the parent exits. If the child still dies, that's a catchable non-zero exit — the orchestrator degrades to empty actions plus a `_warnings[]` entry, not a hard crash.

## Persistent scene-graph cache

`analyzeVideo` is wrapped by a content-addressed disk cache (`src/runtime/graph-cache.ts`) — this is what makes "analyze once, query forever" literally true.

- **Location**: `~/.vzt-video-intel/graphs/<key>.json` (`<configDir>/graphs`, alongside `config.json`).
- **Key**: a sha256 of the *source identity* + every pipeline-affecting option + the resolved lite/cloud routing + the schema `_version`. The source identity of a local file is `path + size + mtime` (cheap — no full read) so editing the file misses cleanly; a URL is keyed by its string. Because routing is in the key, a lite-mode graph and a cloud-mode graph for the same video never collide.
- **Flow**: `analyzeVideo` computes the key, returns `readGraph(key)` immediately on a hit, otherwise runs the full pipeline and `writeGraph(key, graph)` before returning. A version bump auto-invalidates every prior entry.
- **Inheritance**: `observe` calls `analyzeVideo`, so it gets caching for free — its first run on a video is a full pass, subsequent runs read from disk and only re-fuse the perception track.
- **Escape hatches**: `refresh` bypasses the read (forces a fresh run, still rewrites the cache); `noCache` skips read *and* write entirely. Exposed as `--refresh` / `--no-cache` on the CLI and `refresh` on the `analyze_video` / `observe_video` MCP tools. `vintel cache` lists the store, `vintel cache clear` wipes it, `vintel cache path` prints the dir.
- Partial graphs (those carrying `_warnings[]`) are cached too — `refresh` is the way to retry a degraded run.

## Corpus — the cache *is* the library

The corpus layer (`src/pipeline/corpus.ts`) is built directly on the cache above — there is no separate store.

- **`indexCorpus(dir)`** walks a directory for videos and calls `analyzeVideo` on each. Because that's cache-wrapped, a video already analyzed is an instant hit; only new ones run the pipeline. It reports analyzed/cached/failed counts.
- **`searchCorpus(query)`** enumerates every cached graph (`listGraphs` → `readGraph`), dedupes to one graph per *physical* video (newest wins; source paths are normalized for separators + Windows case so `a/b.mp4` and `a\b.mp4` don't double-count), and runs lexical retrieval over each graph's text tracks — transcript (`hear`), condensed OCR lines (`read`), action/caption labels (`see`), entity labels, chapter titles (`chapter`). Scoring is field-weighted term overlap + a phrase-substring boost; hits are returned ranked, each citing source + timestamp.
- This is the cross-video capability a stateless per-call API can't have: it has no persistent index to search. Semantic (embedding) ranking is the planned upgrade — the index/dedupe/ranking plumbing is already shaped for it. See [CORPUS.md](CORPUS.md).

## `observe` — the fused perception track

`analyze` returns parallel tracks (transcript here, captions there, OCR elsewhere). `observe` (`src/pipeline/observe.ts`) runs `analyze`, then merges all four senses into one time-sorted `PerceptionEvent[]`: `hear` (transcript), `see` (scene captions), `read` (OCR, condensed into stable on-screen lines), `scene` (cut boundaries). The output is a second-by-second script of what a human watching *and* listening would notice — the thing lite mode previously couldn't do at all.

Wall-clock for a 10-minute clip:
- **Lite mode** on a modern laptop CPU: 3–5 min (Whisper dominates; entities/actions skipped)
- **Cloud mode** on Replicate: 2–3 min (cold-start dominates; mostly Qwen-VL + SAM2)

## Long-form strategies

For videos > 30 minutes:

1. **Transcription is already chunked.** The lite Whisper adapter windows audio into 30s passes internally — long videos no longer OOM-crash the process. No manual splitting needed for the transcript stage.
2. **`--no-entities --no-actions`** — drop entity tracking (cloud-only) and visual captioning, keep transcript + scenes + OCR + keyframes + CLIP. On long videos the per-scene caption pass is the slow part in lite mode; dropping it is the biggest speedup.
3. **Pre-filter with CLIP** — for "find specific moments" use cases, run `semantic_search` first to narrow the time window, then `analyze` only that window.
4. **Chunked processing** — for the heavier stages you can still split the video into ~5-minute chunks, run per chunk, and stitch by offsetting `start_ms`/`end_ms`. The scene-graph schema supports stitching.

## Streaming output

`analyzeVideo` takes an optional `onEvent` callback that fires as each track lands — `meta`, then `scenes`/`transcript`/`ocr` (end of stage 1), then one `scene_analysis` per scene (stage 2), then `done`. `vintel analyze --stream` prints these as JSONL (one object per line) so a long video produces output incrementally instead of all-at-once. A cache hit replays the identical sequence (with `done.fromCache = true`). It's purely additive: the full `SceneGraph` is still assembled, returned, and cached exactly as before — streaming is a view over the same run, not a separate path.

## Output stability

The scene graph schema is versioned via `_version` on every output. Breaking changes bump the major version. Additive changes ship in minors. Lite-mode and cloud-mode outputs are byte-for-byte compatible.
