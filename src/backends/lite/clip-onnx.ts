// Lite CLIP search via @xenova/transformers (CLIP ViT-B/32 in ONNX).
//
// Samples keyframes from the video, computes CLIP image features in Node,
// scores against the text query, returns top-K hits with timestamps.

import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { ClipSearchOptions, ClipSearchHit } from "../clip.js";

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

export async function liteSemanticSearch(opts: ClipSearchOptions): Promise<{ hits: ClipSearchHit[] }> {
  let pipeline: any;
  let RawImage: any;
  try {
    const mod = await import("@xenova/transformers");
    pipeline = mod.pipeline;
    RawImage = mod.RawImage;
  } catch {
    throw new Error("lite-mode CLIP requires `@xenova/transformers`. Run `npm install @xenova/transformers`.");
  }

  const sampleEvery = 1000;
  const tmpDir = join(tmpdir(), `vintel-clip-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), [
      "-i", opts.source,
      "-vf", `fps=1,scale=224:224:force_original_aspect_ratio=increase,crop=224:224`,
      "-q:v", "5",
      "-y", join(tmpDir, "frame-%05d.jpg"),
    ], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });

  const files = readdirSync(tmpDir).filter((f) => f.endsWith(".jpg")).sort();
  if (!files.length) {
    rmSync(tmpDir, { recursive: true, force: true });
    return { hits: [] };
  }

  // eslint-disable-next-line no-console
  console.error(`[vintel] scoring ${files.length} frames against CLIP query "${opts.query}"…`);
  const extractor = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32");
  const hits: ClipSearchHit[] = [];

  try {
    for (let i = 0; i < files.length; i++) {
      const path = join(tmpDir, files[i]);
      try {
        const image = await RawImage.read(path);
        const result = await extractor(image, [opts.query], { hypothesis_template: "{}" });
        const score = result?.[0]?.score ?? 0;
        if (score >= (opts.minScore ?? 0.2)) {
          hits.push({ t_ms: i * sampleEvery, score });
        }
      } catch {
        // skip individual frame failures
      }
      try { unlinkSync(path); } catch { /* ignore */ }
    }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, opts.topK ?? 10) };
}
