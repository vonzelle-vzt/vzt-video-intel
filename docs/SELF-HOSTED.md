# Self-hosted (local mode)

Power-user setup. Boots all six backends as FastAPI services via Docker.

## Requirements

- Docker Engine 24+ with Compose v2
- NVIDIA Container Toolkit (for the GPU stages)
- One NVIDIA GPU with ≥ 24 GB VRAM
- ffmpeg installed system-wide (the CLI uses it for routing too)

CPU-only profile works for WhisperX, PySceneDetect, EasyOCR, but the heavy backends (Qwen2.5-VL, SAM2, CLIP) require GPU.

## Boot the stack

```bash
vintel up --profile gpu     # default — runs all 6 backends
vintel up --profile cpu     # only the 3 CPU-friendly backends
```

First run downloads model weights (~30 GB total). Subsequent runs use the persistent volume mounted at `docker/.cache/`.

## Health check

```bash
vintel doctor
```

Reports per-backend reachability + latency. Any backend that fails health-check after 6 retries triggers a clear error pointing you at the right log.

## Logs

```bash
docker compose -f docker/docker-compose.yml logs -f whisperx
docker compose -f docker/docker-compose.yml logs -f qwen-vl
```

## Configuring models

Edit `docker/.env` (created by `vintel init`):

```bash
# WhisperX — large-v3 (best quality, slowest) | large-v2 | medium | small
WHISPER_MODEL=large-v3

# Qwen2.5-VL — 7B fits on 24GB; 72B needs 2x A100
QWEN_MODEL=Qwen/Qwen2.5-VL-7B-Instruct

# EasyOCR languages
OCR_LANGS=en,es,fr

# CLIP variant — ViT-L-14 default; ViT-bigG-14 for 3x quality at 3x cost
CLIP_MODEL=ViT-L-14
```

## Alternative backend implementations

The HTTP contract (`POST /run` with a JSON body) is stable. Swap models by pointing the env var at a different URL:

| Default | Swap candidate |
|---|---|
| `nvidia/whisperx:latest` | `ggerganov/whisper.cpp` (CPU-only) |
| `Qwen/Qwen2.5-VL-7B` | `OpenGVLab/InternVL2.5-8B` |
| `meta/sam-2-video` | DEVA (no native HTTP — wrap with FastAPI) |
| `OpenCLIP/ViT-L-14` | `OpenCLIP/ViT-bigG-14` |
| `easyocr` | `tesseract` (lite-mode wrapper works as a drop-in if you build it as a service) |

See `docker/<backend>/server.py` for the canonical contract each backend implements.

## Distributed setup

Run different backends on different machines — the orchestrator only knows about URLs:

```bash
WHISPERX_URL=http://transcribe.lan:9010 \
QWEN_VL_URL=http://qwen.lan:9011 \
SAM2_URL=http://qwen.lan:9012 \
EASYOCR_URL=http://utility.lan:9014 \
CLIP_URL=http://qwen.lan:9015 \
SCENEDETECT_URL=http://utility.lan:9013 \
vintel analyze ./game.mp4
```

Useful when you have one beefy GPU box and several smaller utility nodes.

## Stopping the stack

```bash
vintel down
```

Persistent volumes survive `down` — only the containers are removed. To nuke caches too: `docker compose -f docker/docker-compose.yml down -v`.

## Costs

At list price (May 2026):

| GPU | Hourly | 100 hrs of video |
|---|---|---|
| RTX 4090 spot | $0.30 | $30 |
| RTX 4090 reserved | $0.50 | $50 |
| A100 80GB on-demand | $1.50 | $150 |
| Owned hardware | compute only | electricity + amortized $1.5k card |

Compare to Replicate cloud mode at ~$3.50/100 hrs of video. Local mode breaks even at ~10 hrs/month on owned hardware.
