// Lite "watch" backend — gives lite mode actual visual understanding.
//
// Before this, lite mode could read on-screen text (OCR) and find scene cuts,
// but it had no idea *what was happening* in a frame. Cloud mode used
// Qwen2.5-VL for that; lite mode just returned empty actions[].
//
// Here we caption frames locally with a small image-to-text model via
// @xenova/transformers (Xenova/vit-gpt2-image-captioning by default — pure
// WASM, no GPU, no token). One frame per scene gets captioned; the caption
// becomes an Action so the scene graph finally describes the picture, not
// just the text on it.

import { spawn } from "node:child_process";
import { mkdirSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { QwenChapterOptions, QwenActionOptions } from "../qwen-vl.js";
import type { Action, Chapter } from "../../schema/types.js";

const require = createRequire(import.meta.url);

function ffmpegPath(): string {
  try {
    const p = require("ffmpeg-static") as string | { default?: string };
    const resolved = typeof p === "string" ? p : p.default;
    if (resolved && existsSync(resolved)) return resolved;
  } catch {
    // fall through to system ffmpeg
  }
  return "ffmpeg";
}

// One loaded pipeline per process — captioning a 60-scene video must not
// reload the model 60 times.
let captionerPromise: Promise<any> | null = null;

async function getCaptioner(): Promise<{ captioner: any; RawImage: any }> {
  let mod: any;
  try {
    mod = await import("@xenova/transformers");
  } catch {
    throw new Error(
      "lite-mode visual captioning requires `@xenova/transformers` (declared optional). " +
      "Run `npm install @xenova/transformers` or switch to cloud mode with `vintel login`.",
    );
  }
  if (!captionerPromise) {
    const model = process.env.VZT_CAPTION_MODEL ?? "Xenova/vit-gpt2-image-captioning";
    // eslint-disable-next-line no-console
    console.error(`[vintel] loading visual caption model ${model} (WASM)…`);
    captionerPromise = mod.pipeline("image-to-text", model);
  }
  return { captioner: await captionerPromise, RawImage: mod.RawImage };
}

// Pull a single frame at `t_ms` to a temp JPEG and return its path.
async function grabFrame(source: string, t_ms: number, dir: string): Promise<string> {
  const out = join(dir, `frame-${t_ms}.jpg`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath(), [
      "-ss", String(Math.max(0, t_ms) / 1000),
      "-i", source,
      "-frames:v", "1",
      "-q:v", "4",
      "-y", out,
    ], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 && existsSync(out) ? resolve() : reject(new Error(`ffmpeg frame grab exited ${code}`))));
  });
  return out;
}

function cleanCaption(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Caption a single image file. Loads the model on first call, reuses it after. */
export async function liteCaptionImage(imagePath: string): Promise<string> {
  const { captioner, RawImage } = await getCaptioner();
  const image = await RawImage.read(imagePath);
  const result = await captioner(image);
  const text: string = Array.isArray(result) ? result[0]?.generated_text ?? "" : result?.generated_text ?? "";
  return cleanCaption(text);
}

/**
 * Lite action recognition: caption the frame at the middle of the scene
 * window. Returns one Action describing what's visible. scene_id is left at 0 —
 * the orchestrator stamps the real scene id on.
 */
export async function liteRecognizeActions(opts: QwenActionOptions): Promise<{ actions: Action[] }> {
  if (!existsSync(opts.source) && !opts.source.startsWith("http")) {
    throw new Error(`source not found: ${opts.source}`);
  }
  const start = opts.sceneStartMs ?? 0;
  const end = opts.sceneEndMs ?? start + 2000;
  const mid = Math.round((start + end) / 2);

  const dir = join(tmpdir(), `vintel-vlm-${Date.now()}-${mid}`);
  mkdirSync(dir, { recursive: true });
  try {
    const framePath = await grabFrame(opts.source, mid, dir);
    const caption = await liteCaptionImage(framePath);
    try { unlinkSync(framePath); } catch { /* ignore */ }
    if (!caption) return { actions: [] };
    return {
      actions: [{
        scene_id: 0,
        start_ms: start,
        end_ms: end,
        label: caption,
        confidence: 0.5,
      }],
    };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Lite chapter generation: no LLM. Detect scenes, caption a bounded sample of
 * scene-midpoint frames, then bucket consecutive scenes into ~targetChapterCount
 * chapters titled by their first caption. Heuristic, but fully offline.
 */
export async function liteGenerateChapters(opts: QwenChapterOptions): Promise<{ chapters: Chapter[] }> {
  const { liteDetectScenes } = await import("./ffmpeg-scenes.js");
  const { scenes, duration_ms } = await liteDetectScenes({ source: opts.source, maxScenes: 200 });
  if (!scenes.length) return { chapters: [] };

  const target = Math.max(1, Math.min(opts.targetChapterCount ?? 8, scenes.length));
  const bucketSize = Math.ceil(scenes.length / target);

  // Cap how many frames we caption so a long video doesn't take forever — we
  // only need the first scene of each bucket for a title.
  const dir = join(tmpdir(), `vintel-vlm-chapters-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const chapters: Chapter[] = [];
  try {
    for (let i = 0; i < scenes.length; i += bucketSize) {
      const bucket = scenes.slice(i, i + bucketSize);
      const first = bucket[0];
      const last = bucket[bucket.length - 1];
      let title = `Scene ${first.id + 1}`;
      try {
        const mid = Math.round((first.start_ms + first.end_ms) / 2);
        const framePath = await grabFrame(opts.source, mid, dir);
        const caption = await liteCaptionImage(framePath);
        try { unlinkSync(framePath); } catch { /* ignore */ }
        if (caption) title = caption.charAt(0).toUpperCase() + caption.slice(1);
      } catch {
        // keep the fallback title
      }
      chapters.push({
        start_ms: first.start_ms,
        end_ms: last.end_ms ?? duration_ms ?? first.end_ms,
        title,
      });
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  return { chapters };
}
