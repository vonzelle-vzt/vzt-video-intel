# Roadmap

The north star: VZT Video-Intel is the **persistent index layer for video** — analyze once, query forever. v1.4.0 shipped the single-video form of that (the on-disk scene-graph cache); v1.6.0 scaled it to a corpus (`index` + cross-video `search`) and added an eval harness to keep quality honest.

## Shipped

- **Corpus indexing** (v1.6.0) — `vintel index <dir>` builds a library of scene graphs; one command, many videos, all reusing the content-addressed cache (instant for ones already analyzed).
- **Cross-video search** (v1.6.0) — `vintel search "<query>"` across the whole corpus, not just one clip — the thing stateless native-ingest APIs structurally cannot do. Lexical retrieval over every scene graph's text tracks (hear/read/see/entity/chapter); embedding-based semantic search is the next step (see below).
- **Eval harness** (v1.6.0) — `vintel eval` scores the pipeline against gold fixtures (transcription WER, scene-boundary F1, OCR recall, duration), with `--ci` gating. Makes a `VZT_CLOUD_*_MODEL` swap measurable instead of superstitious.
- **Streaming output** (v1.6.0) — `vintel analyze --stream` emits each track as JSONL the moment it's produced instead of waiting for the full pipeline; a cache hit replays the same sequence.
- **Persistent scene-graph cache** (v1.4.0) — content-addressed on-disk store; re-analyzing a video is an instant read; `observe` / `search` / `chapters` reuse it. The single-video form of "incremental processing".
- **Long-video transcription** (v1.3.0) — 30s audio windowing; no more OOM crashes on 30-min+ clips.
- **Fused perception track** (v1.3.0) — `observe` merges hear/see/read/scene into one timeline.

## v2.0 — deepening the index layer

- **Semantic corpus search** — embed each scene graph's text tracks (and keyframes) so `vintel search` ranks by meaning, not just lexical overlap. The corpus plumbing (index, source-dedupe, ranked hits, kind/source filters) already ships; this swaps the scorer.
- **Cross-video entity re-ID** — unify `tracking_id`s across clips so "the same person in video A and video C" is one entity. **Blocked on a prerequisite:** real re-ID needs a per-entity *visual embedding* to cluster on, which the schema doesn't yet persist (and entity tracking is cloud-SAM2-only). A label-only version ("every `person` is the same person") would be actively misleading, so this waits on adding `Entity.appearances[].embedding` + a CLIP-on-crops stage — not a free change.

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
