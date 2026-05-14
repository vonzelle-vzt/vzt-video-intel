# Comparison

| Capability | VZT Video-Intel (lite) | VZT Video-Intel (cloud) | Gemini 3.1 native | Twelve Labs Pegasus | yt-dlp + Whisper |
|---|---|---|---|---|---|
| **Structured output (scene graph)** | ✅ Claude-native JSON | ✅ Claude-native JSON | partial (text only) | ✅ index API | ❌ |
| **Entity tracking (stable IDs)** | ❌ skipped in lite | ✅ SAM2 | ❌ | partial | ❌ |
| **Action recognition** | ❌ skipped in lite | ✅ Qwen2.5-VL | implicit | ✅ Marengo | ❌ |
| **Speaker diarization** | partial | ✅ | ❌ | ✅ | ❌ (needs Pyannote) |
| **OCR with bounding boxes** | ✅ Tesseract | ✅ cloud OCR | ❌ | partial | ❌ |
| **Semantic moment search** | ✅ CLIP ONNX | ✅ CLIP cloud | implicit | ✅ | ❌ |
| **Citation by timestamp** | ✅ every element | ✅ every element | text-only | partial | text-only |
| **MCP server included** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **CLI included** | ✅ | ✅ | n/a | n/a | yes (yt-dlp) |
| **No Docker required** | ✅ | ✅ | n/a (API only) | n/a (API only) | ✅ |
| **No GPU required** | ✅ | ✅ (Replicate runs it) | n/a | n/a | ✅ |
| **Zero install** | ✅ npm install | ✅ npm install + token | API key only | API key only | manual scripting |
| **Persistent local index (analyze once, query forever)** | ✅ on-disk scene-graph store | ✅ on-disk scene-graph store | ❌ stateless, re-ingests per call | partial (managed index, their infra) | ❌ |
| **Cost model** | $0 — per video, once | per video, once (~$0.06/min) | **per question** — re-billed every call | per clip + indexing | $0 (no graph) |

## Per video, not per question

The cost line that matters isn't "our cloud vs their cloud" — it's *what you're billed for*. Native video APIs re-ingest and re-bill the whole clip on **every question**. VZT Video-Intel analyzes a video **once**, writes the scene graph to a local store, and every subsequent `analyze` / `observe` / `search` / `chapters` call on that video is an instant cache read for $0. Ask 10 questions about a 1-hour video and a native API bills you ~10×; here you pay once (cloud mode) or nothing at all (lite mode).

## What about native video ingest?

When a reasoning model can watch video directly, this still matters — for the same reason you embed and index documents even though models can read text. Native ingest is **stateless**: opaque inference, no frame citations, the whole clip re-read per call. VZT Video-Intel is the **persistent, queryable, diff-able index layer** underneath it. Native ingest changes what you do with the scene graph; it doesn't remove the need for one.

## When to use what

- **VZT Video-Intel lite mode** — free, offline, runs on your laptop. Best for: trying it, dev environments, "transcript + scenes + OCR is enough", privacy-sensitive material that shouldn't leave your machine.
- **VZT Video-Intel cloud mode** — full pipeline including entities + actions. ~$0.06/min. Best for: production, sports/security analysis, anywhere you need entity tracking or scene-level action labels and want Claude-citable output.
- **Gemini 3.1 native** — you only need conversational Q&A over the video and you're OK with closed-box output, opaque inference, and no entity tracking.
- **Twelve Labs Pegasus** — you specifically need their indexing API (good for media catalogs) and you're paying for managed infra.
- **yt-dlp + Whisper** — you only need a transcript, no scenes / entities / actions / search. Free if you have ffmpeg.

## What VZT Video-Intel does NOT do (yet)

- Live streaming (we work on files / URLs, not live ingest)
- Multi-camera sync (planned for v2.0 — see [ROADMAP](../ROADMAP.md))
- Face recognition / identity (intentional — separate ML problem, separate ethics)
- Generation (we analyze, we don't synthesize)
