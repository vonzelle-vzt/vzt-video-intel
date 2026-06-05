# Cloud providers

VZT Video-Intel ships with Replicate as the default cloud provider. Other providers can be swapped in by adding an adapter module under `src/backends/cloud/`.

## Replicate (default, ships out of the box)

Why Replicate:
- Every model we use has a public Replicate version
- Single API key
- Predictable per-second pricing
- Cold-start times are tolerable for our use case (~5–20s for the heavy models)

Pricing approximations (May 2026):
- Qwen2.5-VL-7B: ~$0.001/sec → ~$0.06/min of video
- WhisperX (incredibly-fast-whisper): ~$0.0005/sec → ~$0.03/min of audio
- SAM2 video: ~$0.002/sec → ~$0.12/min
- CLIP: ~$0.0002/sec → ~$0.012/min
- EasyOCR equivalent: ~$0.0003/sec → ~$0.018/min

Total for a 1-minute clip in cloud mode: roughly $0.20–$0.30. Skip entities + actions and you drop to $0.05/min.

Setup:

```bash
vintel login                # paste a Replicate token
# or set REPLICATE_API_TOKEN in your env
vintel config set mode=cloud
```

### Pinning a different model version

Each heavy cloud stage runs a specific Replicate model slug. The defaults track
the official vendor namespaces (`qwen/`, `meta/`) — the proven, stable choice —
but you can point any stage at a newer or community-published version with an env
var, no code change:

| Stage | Env var | Default slug |
|---|---|---|
| Chapters + actions | `VZT_CLOUD_QWEN_MODEL` | `qwen/qwen2.5-vl-7b-instruct` |
| Entity tracking | `VZT_CLOUD_SAM_MODEL` | `meta/sam-2-video` |
| Transcription | `VZT_CLOUD_WHISPER_MODEL` | `vaibhavs10/incredibly-fast-whisper` |

```bash
# e.g. opt into a community Qwen3-VL port without touching the code
export VZT_CLOUD_QWEN_MODEL="someuser/qwen3-vl-instruct"
```

These are **cloud** (Replicate) slugs and are namespaced `VZT_CLOUD_*` so they
never collide with the lite backends' Hugging Face ids (`VZT_WHISPER_MODEL`,
`VZT_CAPTION_MODEL` — see [BACKENDS.md](BACKENDS.md)). A Xenova id is not a valid
Replicate slug, and vice versa. Verify the model's input schema matches what the
adapter sends (`video`/`audio` + `prompt`) before relying on a non-default slug.

## Alternatives (adapter stubs)

Switching providers is a single adapter module per stage. The mode-aware dispatcher in `src/backends/<x>.ts` doesn't care which cloud you use — it just calls a `cloudTranscribe()` etc.

### fal.ai

Faster cold starts (~1–3s vs Replicate's 5–20s). Slightly higher per-second pricing. Good fit for interactive use cases.

To add: create `src/backends/cloud/fal.ts` modeled on `replicate.ts` (POST + poll), then alias the existing per-stage cloud modules to import from it when `cloudProvider=fal`.

### Modal

More control, lower latency at scale, requires deploying your own model containers. Closer to a managed Kubernetes for ML. Best when you have specific model versions you need to pin.

### Hugging Face Inference Endpoints

Bring-your-own model server hosted on HF. Pay-per-instance-hour. Useful for fine-tuned models.

### Anthropic/OpenAI (transcript + chapters only)

Anthropic doesn't yet have native video (the whole reason this tool exists), but GPT-5.5 can be used for chapter generation from a transcript + keyframes. Not a drop-in for Qwen2.5-VL but works for some downstream use cases.

## Adding a new provider

1. Create `src/backends/cloud/<provider>.ts` with a client class (modeled on `replicate.ts`).
2. Create per-stage adapters (`<provider>-whisperx.ts`, etc.) that map your provider's response shape to the canonical TranscriptSegment/Scene/Entity/etc. types.
3. Add a `cloudProvider: "<name>"` value to the Env type in `src/lib/env.ts`.
4. Update the dispatcher in each `src/backends/<x>.ts` to switch on `env.cloudProvider`.
5. Document pricing + setup in this file.

PRs welcome.
