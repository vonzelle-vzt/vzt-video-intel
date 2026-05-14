# Roadmap

The north star: VZT Video-Intel is the **persistent index layer for video** — analyze once, query forever. v1.4.0 shipped the single-video form of that (the on-disk scene-graph cache). The roadmap below scales it to a corpus.

## Shipped

- **Persistent scene-graph cache** (v1.4.0) — content-addressed on-disk store; re-analyzing a video is an instant read; `observe` / `search` / `chapters` reuse it. The single-video form of "incremental processing".
- **Long-video transcription** (v1.3.0) — 30s audio windowing; no more OOM crashes on 30-min+ clips.
- **Fused perception track** (v1.3.0) — `observe` merges hear/see/read/scene into one timeline.

## v2.0 — the index layer

- **Corpus indexing** — `vintel index <dir>` builds a library of scene graphs; one command, many videos, all cached.
- **Cross-video search** — `vintel search` across the whole corpus, not just one clip — the thing stateless native-ingest APIs structurally cannot do.
- **Cross-video entity re-ID** — unify `tracking_id`s across clips so "the same person in video A and video C" is one entity. The schema already carries stable IDs; this makes them span the library.
- **Streaming output** — emit scene graph elements as they're produced (JSONL stream) instead of waiting for the full pipeline.

## Quality

- **Action fine-tune** — Qwen2.5-VL LoRA fine-tuned on a curated action recognition dataset (sports / meetings / tutorials)
- **OCR deduplication** — collapse identical text in the same bbox across consecutive samples
- **Speaker re-identification across runs** — embed-based speaker matching so the same person is `SPEAKER_00` in every analysis
- **Confidence calibration** — Platt scaling on each backend's confidence scores so 0.9 means the same thing everywhere

## Later — broader scope

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
