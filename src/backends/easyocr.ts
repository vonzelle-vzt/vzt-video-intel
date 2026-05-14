import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";
import type { OcrRegion } from "../schema/types.js";

export interface OcrOptions {
  source: string;
  languages?: string[];
  sampleEveryMs?: number;
}

export async function ocrOverlay(opts: OcrOptions): Promise<{ regions: OcrRegion[] }> {
  return postRun(loadEnv().ocr, opts as unknown as Record<string, unknown>);
}
