# Eval — measure quality, don't guess at it

`vzt-video-intel` lets you point any stage at a different cloud model via env (`VZT_CLOUD_QWEN_MODEL`, `VZT_CLOUD_SAM_MODEL`, `VZT_CLOUD_WHISPER_MODEL` — see [CLOUD-PROVIDERS.md](CLOUD-PROVIDERS.md)). The eval harness is how you tell whether a swap actually *helped*, instead of swapping on faith.

```bash
vintel eval                 # score against the bundled gold fixtures
vintel eval ./my-fixtures   # score against your own
vintel eval --ci            # exit non-zero if any gold-gated dimension regresses
vintel eval --json          # machine-readable result
```

## What it measures

| Dimension | Metric | Notes |
|---|---|---|
| Transcription | **WER** (word error rate) | token-level Levenshtein ÷ reference length; lower is better |
| Scenes | **Boundary F1** | predicted internal cuts matched to gold within a tolerance |
| On-screen text | **OCR recall** | fraction of expected phrases whose words all appear in the OCR output |
| Duration | pass/fail | `|predicted − expected|` within tolerance |

A fixture only declares the dimensions it can certify, so a music-only clip skips WER rather than failing it.

## Gold fixtures

A gold fixture is a `*.gold.json` file next to (or referencing) a video:

```json
{
  "source": "../sample.mp4",
  "notes": "why these labels are what they are",
  "duration": { "ms": 12000, "tolerance_ms": 500 },
  "ocr": { "phrases": ["SCENE ONE", "SCENE TWO", "SCENE THREE"], "min": 1.0 },
  "scenes": { "boundaries_ms": [4000, 8000], "tolerance_ms": 1500, "min": 0.5 },
  "speech": { "text": "the full reference transcript", "max": 0.15 }
}
```

- `source` — path relative to the gold file (or absolute / URL).
- Each dimension is **optional** — omit it (or set `speech: null`) to skip scoring it.
- `min` (or `max` for WER, where lower is better) is the **gate** `--ci` enforces. Without it, the dimension is reported but never fails CI.

`vintel eval <dir>` scans `<dir>` for every `*.gold.json`, runs `analyze` on each video, and prints a per-fixture scorecard.

## Honest by design

The bundled fixture (`test/fixtures/eval/sample.gold.json`) is a synthetic test-card clip. It scores **OCR recall 1.0** and **duration exact** — but **scene-boundary F1 ≈ 0.67**, because the content detector only sees the one real visual cut and misses the text-only section change at 4s. That's not a bug in the eval; it's the eval doing its job. A harness that always reports 100% on its own fixture is worthless — this one shows you a real limitation, which is exactly the signal you want when deciding whether a model swap moved the needle.

## Typical workflow: is the new model better?

```bash
vintel eval --json > before.json
export VZT_CLOUD_WHISPER_MODEL="someuser/new-whisper-port"
vintel eval --json > after.json
# diff the WER / F1 / recall numbers — now the decision is data, not vibes
```
