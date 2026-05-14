// Lite-mode OCR via tesseract.js (Slice 3). Stubbed in Slice 1.

import type { OcrOptions } from "../easyocr.js";
import type { OcrRegion } from "../../schema/types.js";

export async function liteOcrOverlay(_opts: OcrOptions): Promise<{ regions: OcrRegion[] }> {
  throw new Error("lite-mode OCR not yet shipped (lands in v1.1.0 Slice 3).");
}
