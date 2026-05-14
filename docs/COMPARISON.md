# Comparison

| Capability | VZT Video-Intel | Gemini 3.1 native | Twelve Labs Pegasus | GPT-5.5 video | yt-dlp + Whisper |
|---|---|---|---|---|---|
| **Self-hosted** | ✅ all 6 backends | ❌ API only | ❌ API only | ❌ API only | ✅ |
| **Structured output (scene graph)** | ✅ Claude-native JSON | partial (text only) | ✅ index API | partial | ❌ |
| **Entity tracking with stable IDs across scenes** | ✅ SAM2 | ❌ | partial | ❌ | ❌ |
| **Action recognition (per scene)** | ✅ Qwen2.5-VL | implicit | ✅ Marengo | implicit | ❌ |
| **Speaker diarization** | ✅ Pyannote 3.1 | ❌ | ✅ | ✅ | ❌ (without extra Pyannote) |
| **OCR with bounding boxes** | ✅ EasyOCR | ❌ | partial | partial | ❌ |
| **Semantic moment search (CLIP)** | ✅ | implicit | ✅ | implicit | ❌ |
| **Auditable model weights** | ✅ all open | ❌ closed | ❌ closed | ❌ closed | ✅ |
| **Citation by timestamp** | ✅ every element | text-only | partial | text-only | text-only |
| **MCP server included** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **CLI included** | ✅ | n/a | n/a | n/a | yes (yt-dlp) |
| **Cost / 1,000 hours video** | ~$300 (4090 spot) | ~$2,800 | ~$3,500 | ~$3,000 | ~$0 (compute only, but no scene graph) |
| **Plug-and-play setup** | docker compose up | API key only | API key only | API key only | manual scripting |

## When to use what

- **VZT Video-Intel** — you want a Claude-native, auditable, structured scene graph and you don't want to pay $3k+ per 1k hours.
- **Gemini 3.1 native** — you only need conversational Q&A over the video and you're OK with closed-box output, opaque inference, and no entity tracking.
- **Twelve Labs Pegasus** — you specifically need their indexing API (good for media catalogs) and you're paying for managed infra.
- **GPT-5.5 video** — you're already deep in the OpenAI ecosystem and need text answers, not structured graphs.
- **yt-dlp + Whisper** — you only need a transcript, you're on a budget, you don't care about scenes / entities / actions / search.

## What VZT Video-Intel does NOT do (yet)

- Live streaming (we work on files / URLs, not live ingest)
- Multi-camera sync (planned for v2.0 — see [ROADMAP](../ROADMAP.md))
- Face recognition / identity (intentional — separate ML problem, separate ethics)
- Generation (we analyze, we don't synthesize)
