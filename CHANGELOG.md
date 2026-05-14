# Changelog

All notable changes to VZT Video-Intel are documented in this file.

## [1.4.0] — 2026-05-14

### Added — analyze once, query forever

Until now `analyze` and `observe` re-ran the entire pipeline on every invocation — even on a video that hadn't changed. v1.4.0 makes the scene graph a *persistent artifact*: analyze a video once, query it forever.

- **Persistent scene-graph store** — `src/runtime/graph-cache.ts`. `analyzeVideo` now writes its result to a content-addressed disk cache at `~/.vzt-video-intel/graphs/<key>.json` and returns instantly on a hit. The key is a sha256 of the source identity (local file: `path + size + mtime`; URL: the string), every pipeline-affecting option, the resolved lite/cloud routing, and the schema `_version` — so a hit is guaranteed to match a fresh run, and a changed file or version bump misses cleanly. `observe` calls `analyzeVideo`, so it inherits the cache for free.
- **`vintel cache` command** — `cache` (list stored graphs), `cache clear` (wipe the store), `cache path` (print the dir).
- **`--refresh` / `--no-cache` flags** on `analyze` and `observe` — `--refresh` forces a fresh run (still rewrites the cache); `--no-cache` skips the store entirely. On a cache hit the CLI prints a one-line notice to stderr so piped JSON stays clean.
- **`refresh` param** on the `analyze_video` and `observe_video` MCP tools.

### Changed — repositioning

The docs were pinned to a *temporary* gap ("Claude can't watch video"). v1.4.0 reframes around the durable one: VZT Video-Intel is the **persistent index layer for video** — which stays true even after native video ingest exists, because native ingest is stateless and per-call.

- README "The gap" rewritten — the missing middle is a *persistent index layer*, not a gap-filler.
- README cost section replaced — the cloud-vs-Gemini price table is gone; the new framing is **per-video amortization** (native APIs bill per *question*; this bills per *video*, once).
- New FAQ entries: "What happens when Claude can watch video natively?" and "Where does the scene graph cache live?".
- `docs/COMPARISON.md` — dropped the weak `Cost / 1,000 hours` row, added a persistence/query-reuse row and a native-ingest section.
- `docs/ARCHITECTURE.md` — documents the graph-cache layer.
- `ROADMAP.md` — reframed around the index-layer direction; corpus indexing + cross-video search & entity re-ID is the v2 headline.
- Scene-graph `_version` bumped to `1.4.0`.

### Verified

- `npm run typecheck` → clean
- `npm run build` → clean
- `npm test` → 13/13 pass — includes a new graph-cache unit test (key determinism, read/write/list/clear) and an end-to-end "analyze once, query forever" test that runs the fixture, confirms the second run is a cache hit with an identical payload, and that `refresh` / `noCache` behave as documented.

## [1.3.0] — 2026-05-14

### Added — watch + listen

Lite mode could read on-screen text and find scene cuts, but it had no idea what was *visually happening* in a frame, and long videos crashed the transcriber outright. v1.3.0 closes both gaps.

- **`observe` command + `observe_video` MCP tool** — fuses all four senses into one time-sorted `PerceptionEvent[]`: `hear` (speech), `see` (visual scene captions), `read` (on-screen text, condensed into stable lines), `scene` (cut boundaries). A second-by-second script of what a human watching *and* listening would notice. `--format text` renders it as a readable transcript. (`src/pipeline/observe.ts`)
- **Lite visual captioning** — new `src/backends/lite/vlm-caption.ts` using `@xenova/transformers` image-to-text (`Xenova/vit-gpt2-image-captioning`, overridable via `VZT_CAPTION_MODEL`). `recognizeActions` and `generateChapters` now have real lite paths instead of returning empty — lite mode finally "watches", fully offline.
- `PerceptionEvent` / `PerceptionKind` types and `SceneGraph.perception` in the schema.
- `SceneGraph._warnings[]` — surfaces non-fatal stage failures.

### Fixed

- **Long-video transcription no longer crashes the process.** The lite Whisper adapter handed the entire decoded audio to the model in one call; on 30-min+ videos the WASM runtime OOM-killed the process mid-run (this is why `analyze` bailed). Audio is now sliced into fixed 30s windows — whisper's native receptive field — and inferred one clean pass per window, reusing a single loaded model, with bounded memory.
- **English-only Whisper models returned empty transcripts.** Passing a `language` hint to a `.en` model sets `forced_decoder_ids` it has no tokens for; every window came back blank. The adapter now detects `.en` models and omits the hint.
- **`analyze` is failure-tolerant.** Stage 1 moved from `Promise.all` to `Promise.allSettled`: a transcription or OCR failure now degrades to an empty stage + a `_warnings[]` entry instead of taking down the whole run. Only scene detection (the timestamp backbone) is still a hard requirement. Keyframe extraction is wrapped too.

### Changed

- `actions` stage now routes to `lite` (was `skip`) when no cloud token is present — see the `Routing` type in `src/runtime/auto.ts`.
- MCP server exposes 9 tools (was 8).
- Scene-graph `_version` bumped to `1.3.0` (additive schema change).
- docs/ARCHITECTURE.md, docs/BACKENDS.md, docs/SCHEMA.md, README.md updated for the above.

### Verified

- npm run typecheck → clean
- npm run build → clean
- npm test → 11/11 pass (includes a real `observe` run on the bundled fixture)
- Full 30-minute video: `analyze` runs end-to-end, exits 0, produces a non-empty transcript — the original crash is gone.

## [1.2.0] — 2026-05-14

### Removed — local/Docker mode

v1.0 and v1.1 shipped a six-container docker-compose stack as a third "local mode" for users with their own GPUs. v1.2.0 **deletes it entirely**. Cloud and lite modes cover 99% of real use cases; the docker stack added too much install friction (6 images, ~30 GB total, CUDA toolkit, NVIDIA Container Toolkit) to be the default path. Anyone genuinely doing >1k hours/month on owned hardware can run Replicate's `cog` templates directly.

### Removed

- `docker/` directory (all 14 files: docker-compose.yml + 6 Dockerfiles + 6 server.py + .env.example)
- `src/lib/verify-backends.ts` — health-checked the docker-compose backends only
- `src/backends/cloud/scene-detect.ts` — was a thin proxy to the local Docker endpoint; scenes now always run via lite (ffmpeg-static)
- `docs/SELF-HOSTED.md` — was the local-mode deep dive
- CLI commands: `vintel up`, `vintel down`, `vintel doctor`, `vintel init` (the docker-stack wizard)
- MCP server `doctor` tool — backend health-check on the docker stack
- `Mode = "local"` from the Mode type
- `local` routing branch from every `src/backends/<x>.ts` dispatcher
- 6 local backend URL env vars from `src/lib/env.ts` (`WHISPERX_URL`, `QWEN_VL_URL`, etc.)
- Docker / GPU detection from `src/runtime/auto.ts`
- `docker` entry from `package.json` `files` array

### Simplified

- `Mode` type: `"cloud" | "local" | "lite" | "auto"` → `"cloud" | "lite" | "auto"`
- `Routing` type: 3-way → 2-way per stage
- `vintel auto` output: 5 environment checks → 2 (ffmpeg + cloud token)
- First-run wizard: 3 options → 2 (cloud / lite)
- Friendly errors no longer mention Docker
- README: dropped the "🛠 Local mode" section; FAQ adds "Why drop the Docker self-hosted mode?"
- docs/INSTALL.md: 3 modes → 2
- docs/BACKENDS.md: rewritten around the lite + cloud adapter matrix instead of the old FastAPI HTTP contract
- docs/ARCHITECTURE.md: new "Why two modes instead of three" section documenting the decision
- docs/COMPARISON.md: added "No Docker required" + "No GPU required" rows

### Verified

- npm run typecheck → clean
- npm test → 9/9 pass
- `vintel auto` correctly identifies ffmpeg + token state, recommends cloud or lite
- No dangling Docker references in src/ except intentional historical mentions in CHANGELOG + ARCHITECTURE
- Output schema unchanged — scene graphs produced by v1.1.1 and v1.2.0 are byte-for-byte compatible

## [1.1.1] — 2026-05-14

End-to-end smoke test on a fresh Windows machine (no GPU, no Docker, no cloud
token) uncovered three lite-mode bugs. Patched, retested, all 6 stages now
verified working against a 12-second synthetic test clip.

### Fixed

- **Whisper transcription on Windows** — `nodejs-whisper` requires compiling
  `whisper-cli` from C++ source, which doesn't work out of the box on Windows.
  Rewrote `src/backends/lite/whisper-wasm.ts` to use `@xenova/transformers`
  (which we already depend on for CLIP) — pure WASM Whisper-tiny, no native
  compilation, works identically on macOS/Linux/Windows. Drops `nodejs-whisper`
  from optionalDependencies.
- **OCR language codes** — `tesseract.js` uses ISO 639-2/T 3-letter codes
  (`eng` not `en`). Default value was `["en"]`, causing a 404 on the model
  CDN. Added a normalization map for the 13 most common languages so callers
  can pass either form.
- **CLIP semantic search shipped as stub** — the `clip-onnx.ts` file in the
  v1.1.0 release was still the v1.0.0 stub (parallel-write race). Real
  `@xenova/transformers` CLIP ViT-B/32 implementation now in place. Verified:
  finds the red scene of a 3-scene test clip with score 1.0.

### Verified working (lite mode, no GPU / no Docker / no cloud)

- `vintel scenes ./clip.mp4` — ffmpeg-static detects scene boundaries
- `vintel keyframes ./clip.mp4` — extracts per-scene JPEGs, parses dimensions
- `vintel transcribe ./clip.mp4` — Xenova/whisper-tiny.en via WASM (~5s for 12s audio)
- `vintel ocr ./clip.mp4` — Tesseract.js detects on-screen text with bboxes + 93%+ confidence
- `vintel search ./clip.mp4 "query"` — CLIP ViT-B/32 ONNX
- `vintel analyze ./clip.mp4` — full pipeline in ~5s for 12s clip on CPU
- `vintel auto` — environment detection
- `vintel config set mode=...` — persisted config
- Cloud-mode friendly error correctly points users to `vintel login` / `vintel config set mode=lite` / `vintel up`

## [1.1.0] — 2026-05-14

### Kill the Docker friction

Three modes now ship out of the box. The CLI auto-detects which one fits your environment and routes each pipeline stage to the best adapter at runtime.

- **🌩 Cloud mode** — every heavy backend runs on Replicate. Zero local infra. ~$0.06/min of video. Works on a fresh MacBook in 60 seconds.
- **🪶 Lite mode** — pure-Node WASM pipeline. Whisper.cpp transcription, ffmpeg-static scene detection + keyframes, Tesseract.js OCR, CLIP-ONNX semantic search. No Docker, no GPU, no API key. Heavy backends (Qwen-VL, SAM2) skip gracefully.
- **🛠 Local mode** — the existing self-hosted Docker stack. Still 10× cheaper than cloud at scale; just no longer the default install path.

### Added

- `src/runtime/auto.ts` — environment detection (GPU, Docker, ffmpeg, cloud key, reachable local backends) + `resolveMode()` that picks the best per-stage routing.
- `src/runtime/mode.ts` — per-call stage resolver. Backends consult this before dispatching.
- `src/runtime/cache.ts` — persists user mode choice + cloud token to `~/.vzt-video-intel/config.json` (0o600 perms).
- `src/backends/cloud/replicate.ts` — minimal Replicate REST client (no SDK), POST predictions + poll until succeeded.
- `src/backends/cloud/{whisperx, qwen-vl, sam2, clip, easyocr, scene-detect}.ts` — Replicate adapters for all 6 stages. Outputs reshaped to match the canonical `SceneGraph` schema.
- `src/backends/lite/ffmpeg-scenes.ts` — scene detection + keyframe extraction via ffmpeg-static.
- `src/backends/lite/whisper-wasm.ts` — Whisper.cpp via `nodejs-whisper`. Auto-downloads model on first run.
- `src/backends/lite/tesseract-ocr.ts` — Tesseract.js with per-word bboxes.
- `src/backends/lite/clip-onnx.ts` — `@xenova/transformers` CLIP ViT-B/32, zero-shot moment search.
- **CLI commands**: `vintel auto` (detect + recommend), `vintel config [show|set]` (persisted config), `vintel login` (Replicate token).
- **First-run wizard** — interactive 3-option prompt the first time you run `vintel analyze`. Choice persists; never asks again unless config is deleted.
- `docs/INSTALL.md` — install guide for all 3 modes.
- `docs/SELF-HOSTED.md` — local-mode deep dive.
- `docs/CLOUD-PROVIDERS.md` — Replicate adapter docs + how to add new providers.

### Changed

- Every `src/backends/<x>.ts` rewritten as a mode-aware dispatcher. Same exported signature → orchestrator + CLI + MCP server unchanged. `resolveStage()` picks cloud/local/lite/skip per call.
- `src/lib/env.ts` extended with `mode`, `cloudProvider`, `replicateToken`, `cacheDir`. Resolves from `process.env` > persisted config > defaults.
- README rewrites the install section as three numbered paths (cloud / lite / local) with a `vintel auto` fallback. Docker is no longer in the first paragraph.
- `vintel doctor` is now an alias for the local-only backend probe; `vintel auto` is the full environment audit.
- Error messages now point users to `vintel login`, `vintel config set mode=lite`, or `vintel up` based on context — not just "boot the docker stack".

### Tests

- 4 new smoke tests covering runtime modules, cloud backends import, lite backends import, and `vintel auto` end-to-end.
- Total smoke suite: 9/9 pass.

### Dependencies

- `commander`, `kleur` — already used; CLI dependencies stay tight.
- New `optionalDependencies`: `ffmpeg-static`, `nodejs-whisper`, `tesseract.js`, `@xenova/transformers`. Users who only use cloud or local mode don't download these.

## [1.0.0] — 2026-05-13

### Added

- Initial release as standalone repo. The package previously lived in
  `vzt-tech-consulting-protocol/packages/mcp-video-intel` and remains there for
  internal protocol consumption; this repo is the canonical public version.
- **MCP server** (`vzt-video-intel mcp`) exposing 9 tools: `analyze_video`,
  `extract_transcript`, `detect_scenes`, `track_entities`, `extract_keyframes`,
  `ocr_overlay`, `semantic_search`, `generate_chapters`, `doctor`.
- **CLI** (`vzt-video-intel` + `vintel` alias) with 12 subcommands including
  `up`, `down`, `doctor`, `init`, and one subcommand per MCP tool.
- **Full pipeline orchestrator** (`src/pipeline/orchestrator.ts`) — fires all
  6 backends with proper stage 1 / stage 2 / stage 3 dependency resolution
  (the protocol package only fires 3 backends).
- **Docker stack** — `docker compose up` boots WhisperX (:9010), Qwen2.5-VL
  (:9011), SAM2 (:9012), PySceneDetect (:9013), EasyOCR (:9014), CLIP (:9015).
  CPU and GPU profiles; healthchecks; shared media volume.
- **Per-backend FastAPI servers** — `docker/<backend>/server.py` for each of
  the 6 backends, stable `POST /run` HTTP contract.
- **5 examples** — basic, transcribe-only, semantic-search, sports-highlight,
  meeting-summary plus a pre-generated `sample-output.json`.
- **6 documentation files** — README, ARCHITECTURE, SCHEMA, BACKENDS,
  INTEGRATIONS, COMPARISON, ROADMAP.
- **CI** — typecheck + smoke test on every push and PR.
- **MIT LICENSE** — © 2026 VZT Tech Consulting.

### Differs from protocol package

- Real per-scene orchestration with concurrency control (orchestrator was a
  3-backend skeleton in the protocol; here it fires all 6).
- New `doctor` tool / CLI command that pings all backends and reports health.
- New `up` / `down` / `init` CLI commands wrapping `docker compose`.
- Friendly errors that point users to `doctor` and `up` when backends are down.
- Lazy CLI fallback — the `bin/` shim runs from source via tsx if `dist/`
  isn't built yet, so `git clone && node bin/vzt-video-intel.js doctor` works
  on a fresh checkout.

[1.0.0]: https://github.com/vonzelle-vzt/vzt-video-intel/releases/tag/v1.0.0
