# Backends

Each pipeline stage has up to two implementations — **lite** (pure-Node WASM) and **cloud** (Replicate). The orchestrator picks per stage based on the resolved runtime mode (see [`src/runtime/mode.ts`](../src/runtime/mode.ts)).

## Per-stage adapter matrix

| Stage | Lite (pure-Node, free, offline) | Cloud (Replicate, paid) |
|---|---|---|
| **Transcript** | `@xenova/transformers` Whisper-tiny.en (ONNX), 30s-windowed | `vaibhavs10/incredibly-fast-whisper` |
| **Scenes** | `ffmpeg-static` content-aware filter | (no cloud adapter — lite is fast enough) |
| **OCR** | `tesseract.js` (WASM) | `abiruyt/text-extract-ocr` |
| **CLIP search** | `@xenova/transformers` CLIP ViT-B/32 (ONNX) | `andreasjansson/clip-features` |
| **Entities (SAM2)** | (skip — falls back to "no entity tracking") | `meta/sam-2-video` |
| **Actions / Chapters (Qwen2.5-VL)** | `@xenova/transformers` ViT-GPT2 caption (ONNX) | `qwen/qwen2.5-vl-7b-instruct` |

## How dispatch works

Each `src/backends/<x>.ts` file is a thin dispatcher:

```ts
export async function transcribe(opts) {
  const route = await resolveStage("transcribe");
  if (route === "cloud") {
    const { cloudTranscribe } = await import("./cloud/whisperx.js");
    return cloudTranscribe(opts);
  }
  const { liteTranscribe } = await import("./lite/whisper-wasm.js");
  return liteTranscribe(opts);
}
```

- `resolveStage()` reads `~/.vzt-video-intel/config.json` (or the `VZT_MODE` env var) to decide which adapter to load.
- Dynamic imports keep the lite path from pulling in `@xenova/transformers` if you're only using cloud mode, and vice versa.
- Both adapters return the same TypeScript shape — the orchestrator + MCP server + CLI don't need to know which one ran.

## Lite adapter notes

- **Whisper** — defaults to `Xenova/whisper-tiny.en`. Audio is transcribed in fixed **30s windows** (whisper's native receptive field), one clean pass per window, reusing a single loaded model. This is what keeps long videos from OOM-crashing the process. A failed window degrades to a gap, never a crash. Override the model with `VZT_WHISPER_MODEL=Xenova/whisper-small.en` for higher quality at ~3× the runtime. Note: English-only (`.en`) models reject a `language` hint — the adapter detects this and omits it automatically; pass a multilingual model (e.g. `Xenova/whisper-small`) if you need language forcing.
- **Scenes** — uses `select=gt(scene\,0.27)` filter. Tune via `--threshold` (default `27`, lower = more sensitive).
- **OCR** — `tesseract.js` uses ISO 639-2/T 3-letter codes (`eng`, not `en`). The CLI normalizes 2-letter codes automatically.
- **CLIP** — defaults to `Xenova/clip-vit-base-patch32`. Samples one frame per second and runs zero-shot scoring against the query.
- **Actions / Chapters (visual captioning)** — defaults to `Xenova/vit-gpt2-image-captioning`, overridable via `VZT_CAPTION_MODEL`. This is lite mode's "eyes": it grabs one frame at each scene's midpoint and captions it, so `actions[]` describes *what's visible*, not just the text on screen. `generate_chapters` in lite mode buckets scenes and titles each chapter from its first caption — heuristic, no LLM, fully offline. Before v1.3 this stage was `skip` in lite mode.

## Cloud adapter notes

- All cloud adapters POST to `https://api.replicate.com/v1/models/<owner>/<name>/predictions` and poll until `succeeded`.
- The Replicate REST client is minimal (`src/backends/cloud/replicate.ts`) — no SDK dependency. ~100 lines.
- Outputs are reshaped to match the canonical `TranscriptSegment[]` / `Scene[]` / `Entity[]` / etc. types so they're indistinguishable from lite outputs downstream.
- Cost is roughly $0.06/min of video for the full pipeline. Skip entities + actions and you drop to $0.02/min.

## Adding a new adapter

To add a third implementation (e.g. fal.ai cloud, Modal serverless, a custom ONNX model):

1. Create `src/backends/<provider>/<stage>.ts` exporting a function with the same signature as `liteTranscribe` / `cloudTranscribe`.
2. Extend the `Routing` type in `src/runtime/auto.ts` with the new provider name.
3. Wire it into the dispatcher in `src/backends/<stage>.ts`.
4. Add an env var to `src/lib/env.ts` if needed (API key, endpoint URL).
5. Document the pricing + config in [CLOUD-PROVIDERS.md](CLOUD-PROVIDERS.md).

PRs welcome.
