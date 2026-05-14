import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";
import { resolveStage } from "../runtime/mode.js";
import type { OcrRegion } from "../schema/types.js";

export interface OcrOptions {
  source: string;
  languages?: string[];
  sampleEveryMs?: number;
}

export async function ocrOverlay(opts: OcrOptions): Promise<{ regions: OcrRegion[] }> {
  const route = await resolveStage("ocr");
  if (route === "cloud") {
    const { cloudOcrOverlay } = await import("./cloud/easyocr.js");
    return cloudOcrOverlay(opts);
  }
  if (route === "lite") {
    const { liteOcrOverlay } = await import("./lite/tesseract-ocr.js");
    return liteOcrOverlay(opts);
  }
  return postRun(loadEnv().ocr, opts as unknown as Record<string, unknown>);
}
