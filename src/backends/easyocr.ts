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
  const { liteOcrOverlay } = await import("./lite/tesseract-ocr.js");
  return liteOcrOverlay(opts);
}
