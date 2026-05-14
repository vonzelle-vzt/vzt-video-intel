# Architecture

The whole point of VZT Video-Intel is to produce a **temporal scene graph** that an LLM can quote by timestamp. This doc explains why the pipeline is shaped the way it is.

## Pipeline

```
Stage 1 (parallel, fully independent)
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ PySceneDetect│  │ WhisperX     │  │ EasyOCR      │
│ scene bounds │  │ transcript + │  │ on-screen    │
│              │  │ diarization  │  │ text         │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └────────┬────────┴─────────────────┘
                ▼
Stage 2 (per-scene, parallel within concurrency budget)
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ SAM2         │  │ Qwen2.5-VL   │  │ keyframe     │
│ entity track │  │ action       │  │ extraction   │
│              │  │ recognition  │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       └────────┬────────┴─────────────────┘
                ▼
Stage 3 (on demand)
┌──────────────────┐
│ CLIP semantic    │
│ search           │
└──────────────────┘
                ▼
            Scene Graph
```

## Why six models specifically

| Backend | Role | Why this one |
|---|---|---|
| **WhisperX** | Transcript + diarization | Whisper large-v3 is SOTA on open-source ASR (5.26% WER). WhisperX adds Pyannote 3.1 diarization without leaving the same process. |
| **PySceneDetect** | Scene boundaries | Content-aware detection is faster and more accurate than ffmpeg's `select=gt(scene,X)` for editorial-cut videos. CPU-only, runs in seconds. |
| **EasyOCR** | On-screen text | Multilingual out of the box. Better than Tesseract on video frames. CPU-friendly. |
| **SAM2** | Entity segmentation + tracking | Meta's SAM2 is the only model that does video segmentation with stable IDs across frames. Closest competitor: DEVA. |
| **Qwen2.5-VL** | Action recognition + chapters | Best open-source VLM in 2026. 72.2 MMMU. Runs in vLLM at production speeds. We default to 7B; 72B is a compose profile. |
| **CLIP** (OpenCLIP ViT-L-14) | Semantic frame search | The most cost-effective way to do "find me the moment when X happens" — embed query + frames, cosine similarity. |

## Why HTTP between models

Each backend has different CUDA versions, Python deps, model weights, and GPU requirements. Putting them behind FastAPI:

- **Isolation** — upgrade WhisperX without rebuilding the Qwen-VL image
- **Distribution** — run them on different machines (one box for SAM2 + Qwen, another for transcript)
- **Swappability** — point `WHISPERX_URL` at a different transcription server without touching the orchestrator

The cost is a few milliseconds of HTTP overhead per call, dwarfed by GPU inference time.

## Concurrency model

The orchestrator at `src/pipeline/orchestrator.ts`:

1. **Stage 1**: fires `Promise.all([detectScenes, transcribe, ocrOverlay])`. No data dependencies between them.
2. **Stage 2**: iterates scenes in chunks of `sceneConcurrency` (default 2). For each scene, fires entity tracking + action recognition in parallel. Wraps with `Promise.allSettled` so a single scene failure doesn't kill the run.
3. **Stage 3**: only runs when the caller explicitly invokes `semantic_search` — it requires CLIP embeddings on every sampled frame which is its own pass.

On a 10-minute clip with default settings on a 4090, expected wall-clock:
- Stage 1: ~2 min (WhisperX dominates)
- Stage 2: ~6 min (action recognition is the expensive stage)
- Total: ~8 min ≈ 0.8× real time

## Long-form strategies

For videos > 30 minutes you have three options:

1. **`--no-entities --no-actions`** — drop the two expensive stages, keep transcript + scenes + OCR + keyframes + CLIP. Usually 5× faster.
2. **Chunked processing** — split the video into ~5-minute chunks, run the pipeline per chunk, stitch by offsetting `start_ms`/`end_ms`. Scene IDs are unique per chunk; the orchestrator namespaces them.
3. **Pre-filter with CLIP** — for "find specific moments" use cases, run `semantic_search` first to narrow the time window, then `analyze` only that window.

## Output stability

The scene graph schema is versioned via `_version` on every output. Breaking changes bump the major version (e.g. v2.0 will introduce camera-position tracking). Additive changes ship in minors.

The HTTP contract per backend (`POST /run`) is **stable across orchestrator versions** — you can run an older orchestrator against newer backends.
