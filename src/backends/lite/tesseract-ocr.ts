// Lite OCR via tesseract.js. Samples frames every sampleEveryMs using
// ffmpeg-static, OCRs each frame in WASM Tesseract, returns OcrRegion[].

import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { OcrOptions } from "../easyocr.js";
import type { OcrRegion, BBox } from "../../schema/types.js";

const require = createRequire(import.meta.url);

function ffmpegPath(): string {
  try {
    const p = require("ffmpeg-static") as string | { default?: string };
    const resolved = typeof p === "string" ? p : p.default;
    if (resolved && existsSync(resolved)) return resolved;
  } catch {
    // fall through
  }
  return "ffmpeg";
}

export async function liteOcrOverlay(opts: OcrOptions): Promise<{ regions: OcrRegion[] }> {
  let tesseract: any;
  try {
    tesseract = await import("tesseract.js");
  } catch {
    throw new Error("lite-mode OCR requires `tesseract.js`. Run `npm install tesseract.js`.");
  }
  const sampleEvery = opts.sampleEveryMs ?? 1000;
  const langs = (opts.languages ?? ["en"]).join("+");

  const tmpDir = join(tmpdir(), `vintel-ocr-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // Extract frames at sampleEveryMs cadence
  await new Promise<void>((resolve, reject) => {
    const fps = 1000 / sampleEvery;
    const child = spawn(ffmpegPath(), [
      "-i", opts.source,
      "-vf", `fps=${fps}`,
      "-q:v", "5",
      "-y", join(tmpDir, "frame-%05d.jpg"),
    ], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });

  const files = readdirSync(tmpDir).filter((f) => f.endsWith(".jpg")).sort();
  const regions: OcrRegion[] = [];

  const worker = await tesseract.createWorker(langs);
  try {
    for (let i = 0; i < files.length; i++) {
      const path = join(tmpDir, files[i]);
      const t_ms = i * sampleEvery;
      try {
        const { data } = await worker.recognize(path, undefined, { blocks: true });
        for (const word of data.words ?? []) {
          if (!word.text?.trim()) continue;
          const b = word.bbox;
          const bbox: BBox = [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0];
          regions.push({
            start_ms: t_ms,
            end_ms: t_ms + sampleEvery,
            text: word.text.trim(),
            bbox,
            confidence: typeof word.confidence === "number" ? word.confidence / 100 : undefined,
          });
        }
      } catch {
        // skip individual frame failures
      }
      try { unlinkSync(path); } catch { /* ignore */ }
    }
  } finally {
    await worker.terminate();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return { regions };
}
