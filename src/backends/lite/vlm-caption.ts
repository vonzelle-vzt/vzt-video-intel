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
//
// The caption model runs in a CHILD PROCESS (caption-worker.ts). Inside
// `analyze` it would otherwise share a process — and a WASM heap — with the
// Whisper and Tesseract runtimes; on a long video onnxruntime then can't
// allocate its session and the whole process aborts with `bad allocation`.
// A child gets a fresh heap, and if it still OOMs that's a catchable non-zero
// exit, not a hard crash of `analyze`.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

// ── caption worker client ──────────────────────────────────────────────────
//
// One worker per process, spawned lazily on the first caption and reused for
// every frame after (the model load is the expensive part). If the worker
// dies — OOM or otherwise — every pending and future request rejects, which
// the orchestrator's per-scene `Promise.allSettled` turns into empty actions
// rather than a crash.

interface PendingReq {
  resolve: (caption: string) => void;
  reject: (err: Error) => void;
}

let worker: ChildProcess | null = null;
let workerDead: Error | null = null;
let reqId = 0;
const pending = new Map<number, PendingReq>();
let stdoutBuf = "";

// The worker ships as caption-worker.js next to this file once built; in dev
// (tsx) only the .ts exists, so fall back to running it through tsx.
function resolveWorkerCommand(): { cmd: string; args: string[] } {
  const jsPath = fileURLToPath(new URL("./caption-worker.js", import.meta.url));
  if (existsSync(jsPath)) return { cmd: process.execPath, args: [jsPath] };
  const tsPath = jsPath.replace(/\.js$/, ".ts");
  return { cmd: process.execPath, args: ["--import", "tsx", tsPath] };
}

function failWorker(err: Error): void {
  workerDead = err;
  worker = null;
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

// child_process stdio pipes are net.Sockets at runtime — they expose ref()/
// unref(), but the ChildProcess type only surfaces them as Readable/Writable.
function asPipe(s: unknown): { ref(): void; unref(): void } {
  return s as { ref(): void; unref(): void };
}

// The worker's stdout pipe may only keep the parent's event loop alive while a
// caption is actually in flight — otherwise an idle worker would hang the whole
// process at exit. (The child handle and stdin are never allowed to: we only
// ever write to stdin.) Call after every change to `pending`.
function syncStdoutRef(): void {
  const out = worker?.stdout;
  if (!out) return;
  if (pending.size > 0) asPipe(out).ref();
  else asPipe(out).unref();
}

function ensureWorker(): ChildProcess {
  if (worker) return worker;
  if (workerDead) throw workerDead;

  const { cmd, args } = resolveWorkerCommand();
  // stderr inherited so onnxruntime/model logs still surface; stdout is the
  // JSON response channel.
  const w = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
  worker = w;

  w.stdout!.setEncoding("utf-8");
  w.stdout!.on("data", (chunk: string) => {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let msg: { id: number; caption?: string; error?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // stray non-JSON line — ignore
      }
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      syncStdoutRef();
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.caption ?? "");
    }
  });

  w.on("exit", (code, signal) => {
    if (worker === w) {
      failWorker(
        new Error(
          `lite caption worker exited (code ${code}${signal ? `, signal ${signal}` : ""}) — ` +
          "likely out of memory; captioning is unavailable for the rest of this run",
        ),
      );
    }
  });
  w.on("error", (err) => {
    if (worker === w) failWorker(err);
  });
  w.stdin!.on("error", () => {
    /* worker gone — the exit handler reports it */
  });
  // Never let an idle worker hang the parent: unref the child handle and stdin
  // outright; stdout is ref'd on demand by syncStdoutRef() while captions are
  // in flight and unref'd here to start (nothing pending yet).
  w.unref();
  asPipe(w.stdin).unref();
  asPipe(w.stdout).unref();

  return w;
}

// Kill the worker when the parent exits so it doesn't linger.
process.on("exit", () => {
  try {
    worker?.kill();
  } catch {
    /* ignore */
  }
});

/** Caption a single image file via the worker process. Spawns it on first call. */
export async function liteCaptionImage(imagePath: string): Promise<string> {
  const w = ensureWorker();
  const id = ++reqId;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    syncStdoutRef();
    w.stdin!.write(JSON.stringify({ id, imagePath }) + "\n", (err) => {
      if (err) {
        pending.delete(id);
        syncStdoutRef();
        reject(err);
      }
    });
  });
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
