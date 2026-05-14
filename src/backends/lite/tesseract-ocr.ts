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
  // Tesseract uses ISO 639-2/T 3-letter codes ("eng" not "en"). Normalize common cases
  // so users can pass either. Without this, tesseract.js tries to fetch a non-existent
  // `@tesseract.js-data/en` package and 404s.
  const langMap: Record<string, string> = {
    en: "eng", es: "spa", fr: "fra", de: "deu", it: "ita", pt: "por", nl: "nld",
    ja: "jpn", ko: "kor", zh: "chi_sim", ru: "rus", ar: "ara", hi: "hin",
  };
  const langs = (opts.languages ?? ["eng"])
    .map((l) => langMap[l.toLowerCase()] ?? l)
    .join("+");

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

  // The tesseract.js worker's WASM heap grows with every recognize() call and
  // is never reclaimed. On a long video (~1800 frames at 1 fps) it eventually
  // OOMs — and the failure is thrown uncaught from inside the worker thread
  // (process.nextTick), so it can't be caught by a try/catch out here. The fix
  // is to never let it get that big: recycle the worker every N frames so its
  // heap stays bounded. ~150 keeps peak memory comfortable on a 30-min video.
  const recycleEvery = Math.max(25, Number(process.env.VZT_OCR_WORKER_RECYCLE) || 150);

  let worker = await tesseract.createWorker(langs);
  let sinceRecycle = 0;
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

      if (++sinceRecycle >= recycleEvery && i < files.length - 1) {
        try { await worker.terminate(); } catch { /* ignore */ }
        worker = await tesseract.createWorker(langs);
        sinceRecycle = 0;
        if (files.length > recycleEvery) {
          // eslint-disable-next-line no-console
          console.error(`[vintel]   OCR ${i + 1}/${files.length} frames (${regions.length} regions)…`);
        }
      }
    }
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return { regions };
}
