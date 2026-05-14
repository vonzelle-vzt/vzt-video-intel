# Roadmap

## v1.1 — efficiency

- **Incremental processing** — chunked video ingest for files > 30 min, with scene-ID stitching across chunks
- **Dense bbox sampling** — option to sample every frame inside a scene for fine-grained tracking
- **Streaming output** — emit scene graph elements as they're produced (JSONL stream) instead of waiting for the full pipeline
- **Smarter keyframe selection** — pick "most informative" keyframe per scene via CLIP scoring against scene transcript

## v1.2 — quality

- **Action fine-tune** — Qwen2.5-VL LoRA fine-tuned on a curated action recognition dataset (sports / meetings / tutorials)
- **OCR deduplication** — collapse identical text in the same bbox across consecutive samples
- **Speaker re-identification across runs** — embed-based speaker matching so the same person is `SPEAKER_00` in every analysis
- **Confidence calibration** — Platt scaling on each backend's confidence scores so 0.9 means the same thing everywhere

## v2.0 — scope

- **Multi-camera sync** — N feeds of the same event, unified timeline, cross-camera entity tracking
- **Live ingest** — RTMP / WebRTC streams, rolling scene graph with a configurable window
- **Action ontology** — pluggable label set (e.g. SportRadar's basketball events) instead of free-text labels
- **Face recognition** (optional, opt-in module) — separately licensed; not in core

## Maybe / community-driven

- Apple Silicon support (MLX backends for WhisperX / Qwen / CLIP)
- Whisper-Streaming integration for real-time transcription
- DEVA as a SAM2 alternative
- BLIP-2 captions on keyframes
- A Web UI for visualizing the scene graph

If any of these matter to you, open an issue or PR — we triage every weekend.
