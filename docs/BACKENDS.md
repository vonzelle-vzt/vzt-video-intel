# Backends

Every backend is a tiny FastAPI service exposing two endpoints:

- `GET /health` → `{ ok: boolean, ...meta }`
- `POST /run` → backend-specific JSON

The orchestrator and CLI know nothing about the model internals — only the HTTP contract.

## Default ports

| Backend | Port | Env var |
|---|---|---|
| WhisperX | 9010 | `WHISPERX_URL` |
| Qwen2.5-VL (via vLLM) | 9011 | `QWEN_VL_URL` |
| SAM2 | 9012 | `SAM2_URL` |
| PySceneDetect | 9013 | `SCENEDETECT_URL` |
| EasyOCR | 9014 | `EASYOCR_URL` |
| CLIP | 9015 | `CLIP_URL` |

## Per-backend HTTP contract

### WhisperX (`:9010`)

```jsonc
POST /run
{
  "source": "https://example.com/clip.mp4",
  "language": "en",          // optional ISO 639-1
  "diarize": true,
  "minSpeakers": 1,          // optional
  "maxSpeakers": 4           // optional
}

→ {
  "segments": [{ "start_ms", "end_ms", "text", "speaker?", "confidence?" }],
  "language": "en"
}
```

### PySceneDetect (`:9013`)

```jsonc
POST /run
{
  "source": "...",
  "threshold": 27.0,             // lower = more sensitive
  "minSceneLengthMs": 1000,
  "maxScenes": 200
}
→ { "scenes": [{ "id", "start_ms", "end_ms" }], "duration_ms": 124800 }

POST /run                         // keyframe extraction
{
  "mode": "keyframes",
  "source": "...",
  "perScene": true,
  "intervalMs": 2000,
  "quality": 85
}
→ { "keyframes": [{ "scene_id", "t_ms", "jpeg_b64", "width", "height" }] }
```

### EasyOCR (`:9014`)

```jsonc
POST /run
{ "source": "...", "languages": ["en"], "sampleEveryMs": 1000 }
→ { "regions": [{ "start_ms", "end_ms", "text", "bbox": [x, y, w, h], "confidence" }] }
```

### SAM2 (`:9012`)

```jsonc
POST /run
{
  "source": "...",
  "sceneStartMs": 0,
  "sceneEndMs": 4200,
  "promptText": "football players",  // optional
  "sampleEveryMs": 500
}
→ { "entities": [{ "tracking_id", "label", "confidence", "appearances": [...] }] }
```

### Qwen2.5-VL (`:9011`)

```jsonc
POST /run
{
  "mode": "chapters",
  "source": "...",
  "targetChapterCount": 8,
  "style": "youtube"
}
→ { "chapters": [{ "start_ms", "end_ms", "title", "summary?" }] }

POST /run
{
  "mode": "actions",
  "source": "...",
  "sceneStartMs": 0,
  "sceneEndMs": 4200
}
→ { "actions": [{ "start_ms", "end_ms", "label", "confidence" }] }
```

### CLIP (`:9015`)

```jsonc
POST /run
{
  "source": "...",
  "query": "goal scored",
  "topK": 10,
  "minScore": 0.2,
  "sampleEveryMs": 1000
}
→ { "hits": [{ "t_ms", "score" }] }
```

## Swapping backends

Because the contract is stable, you can swap implementations. Examples:

- **WhisperX → Whisper.cpp** — point `WHISPERX_URL` at a Whisper.cpp HTTP wrapper. Drop diarization or pair with a separate Pyannote service.
- **Qwen2.5-VL → InternVL3** — same vLLM runtime. Change `QWEN_MODEL` env var, restart the container.
- **CLIP ViT-L-14 → CLIP ViT-bigG-14** — set `CLIP_MODEL=ViT-bigG-14`. 3× slower, better at fine-grained moment search.
- **SAM2 → DEVA** — both do video segmentation. Wrap DEVA in the same `POST /run` shape; nothing in the orchestrator changes.

## Running backends remotely

The default URLs point at `localhost:90xx`. To run a backend on a different machine, set its env var:

```bash
WHISPERX_URL=http://gpu-box.lan:9010 vzt-video-intel analyze ./clip.mp4
```

The orchestrator doesn't care where the backends live, as long as they speak HTTP and pass health checks.
