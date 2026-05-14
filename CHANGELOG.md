# Changelog

All notable changes to VZT Video-Intel are documented in this file.

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
