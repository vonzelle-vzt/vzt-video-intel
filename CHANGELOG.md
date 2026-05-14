# Changelog

All notable changes to VZT Video-Intel are documented in this file.

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
