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
| **Cost / 1,000 hours** | $0 (your CPU) | ~$3,600 | ~$2,800 | ~$3,500 | ~$0 (no graph) |

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
