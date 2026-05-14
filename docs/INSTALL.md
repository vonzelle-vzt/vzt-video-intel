# Install

Three modes, one CLI. Pick whichever matches your machine + budget.

## TL;DR

```
npm install -g vzt-video-intel
vintel analyze <video>
```

The first run asks you to pick a mode and persists your choice to `~/.vzt-video-intel/config.json`.

## Cloud mode (fastest to get running)

Zero local infra. Heavy backends run on Replicate.

```bash
npm install -g vzt-video-intel
vintel login                # paste your Replicate token
vintel analyze https://example.com/clip.mp4
```

Get a Replicate API token at https://replicate.com/account/api-tokens. Free tier covers occasional dev work; pay-per-second for production.

Cost: ~$0.06/min of video for the full pipeline.

## Lite mode (free, offline)

Everything runs in Node — Whisper.cpp via WASM, ffmpeg-static for scene detection + keyframes, Tesseract.js for OCR, CLIP via ONNX. The first run downloads ~150 MB of model weights to `~/.vzt-video-intel/`.

```bash
npm install -g vzt-video-intel
vintel analyze ./demo.mp4   # first run prompts you to pick a mode; pick lite
```

Heavy backends (Qwen-VL action recognition, SAM2 entity tracking) skip gracefully. You still get transcript, scenes, OCR, semantic search, and keyframes.

Cost: zero. Speed: ~3–5× real-time on a modern laptop CPU.

## Local mode (cheapest at scale)

Full self-hosted GPU stack via Docker. All six backends as FastAPI services.

Requires:
- Docker (with Compose v2)
- One NVIDIA GPU with ≥24 GB VRAM (RTX 4090, A100, etc.)
- ffmpeg (system-installed)

```bash
git clone https://github.com/vonzelle-vzt/vzt-video-intel.git
cd vzt-video-intel
npm install && npm run build

vintel up                   # boots all 6 backends
vintel doctor               # health-check
vintel analyze ./demo.mp4
```

See [SELF-HOSTED.md](SELF-HOSTED.md) for advanced topics: alternative backends, GPU sharing across multiple machines, model swaps.

Cost: ~$0.30 / GPU-hour on an RTX 4090 spot instance, or compute-only if you own the hardware. Pays for itself the first month at >50 hours of video / day.

## Hybrid auto

`vintel auto` inspects the machine and picks the best per-stage routing — for example, ffmpeg scenes locally + Replicate Qwen-VL for actions + lite Whisper for transcript.

```bash
vintel auto                 # print recommendation
vintel auto --apply         # persist it
```

The orchestrator dispatches per-stage at runtime based on the persisted config, so you can run in mixed mode without setting env vars.

## Claude Code / Cursor / OpenCode (MCP)

Once installed, plug the MCP server into your AI IDE:

```json
{
  "mcpServers": {
    "vzt-video-intel": {
      "command": "npx",
      "args": ["vzt-video-intel", "mcp"]
    }
  }
}
```

The MCP server respects the same persisted mode — so the IDE gets whatever execution path you configured for the CLI.

See [INTEGRATIONS.md](INTEGRATIONS.md) for per-IDE setup.
