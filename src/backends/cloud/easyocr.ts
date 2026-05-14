// Cloud OCR via Replicate. Uses an easyocr-equivalent model.

import { replicateRun } from "./replicate.js";
import type { OcrOptions } from "../easyocr.js";
import type { OcrRegion } from "../../schema/types.js";

interface RawOcrOutput {
  regions?: { start_ms: number; end_ms: number; text: string; bbox: [number, number, number, number]; confidence?: number }[];
}

export async function cloudOcrOverlay(opts: OcrOptions): Promise<{ regions: OcrRegion[] }> {
  const output = await replicateRun<RawOcrOutput>({
    model: "abiruyt/text-extract-ocr",
    input: {
      video: opts.source,
      languages: (opts.languages ?? ["en"]).join(","),
      sample_every_ms: opts.sampleEveryMs ?? 1000,
    },
    timeoutMs: 10 * 60_000,
  });
  return {
    regions: (output.regions ?? []).map((r) => ({
      start_ms: Number(r.start_ms),
      end_ms: Number(r.end_ms),
      text: String(r.text),
      bbox: r.bbox,
      confidence: r.confidence,
    })),
  };
}
