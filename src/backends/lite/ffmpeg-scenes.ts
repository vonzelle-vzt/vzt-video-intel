// Lite scene detection + keyframe extraction via ffmpeg-static.
//
// Uses `ffmpeg -vf "select=gt(scene\,0.4),showinfo" -f null -` and parses the
// `pts_time` values from stderr to get scene boundaries. For keyframes we
// extract one frame at the scene midpoint via `-ss <t> -frames:v 1`.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { SceneDetectOptions, KeyframeOptions } from "../scene-detect.js";
import type { Scene, Keyframe } from "../../schema/types.js";

const require = createRequire(import.meta.url);

function ffmpegPath(): string {
  try {
    const p = require("ffmpeg-static") as string | { default?: string };
    const resolved = typeof p === "string" ? p : p.default;
    if (resolved && existsSync(resolved)) return resolved;
  } catch {
    // not installed — fall through to system ffmpeg
  }
  return "ffmpeg";
}

async function runFfmpeg(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdoutChunks: Buffer[] = [];
  let stderr = "";
  child.stdout.on("data", (c) => stdoutChunks.push(c));
  child.stderr.on("data", (c) => (stderr += c.toString()));
  const code: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (c) => resolve(c ?? 0));
  });
  if (code !== 0 && !stderr.includes("pts_time")) {
    throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`);
  }
  return { stdout: Buffer.concat(stdoutChunks), stderr };
}

function parseDurationMs(stderr: string): number | undefined {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return undefined;
  return Math.round((parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3])) * 1000);
}

function parseSceneTimes(stderr: string): number[] {
  // Lines look like: "[Parsed_showinfo_1 @ ...] n:   3 pts:    180 pts_time:1.5 ..."
  const times: number[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.includes("showinfo")) continue;
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) times.push(parseFloat(m[1]));
  }
  return times;
}

export async function liteDetectScenes(opts: SceneDetectOptions): Promise<{ scenes: Scene[]; duration_ms?: number }> {
  if (!existsSync(opts.source) && !opts.source.startsWith("http")) {
    throw new Error(`source not found: ${opts.source}`);
  }
  const threshold = (opts.threshold ?? 27) / 100; // ffmpeg uses 0..1 scale; default ~0.27
  const { stderr } = await runFfmpeg([
    "-i", opts.source,
    "-vf", `select=gt(scene\\,${threshold}),showinfo`,
    "-f", "null", "-",
  ]);
  const duration_ms = parseDurationMs(stderr);
  const cutTimesMs = parseSceneTimes(stderr).map((s) => Math.round(s * 1000));
  cutTimesMs.unshift(0);
  if (duration_ms !== undefined) cutTimesMs.push(duration_ms);

  const minLen = opts.minSceneLengthMs ?? 1000;
  const scenes: Scene[] = [];
  for (let i = 0; i < cutTimesMs.length - 1; i++) {
    const start = cutTimesMs[i];
    const end = cutTimesMs[i + 1];
    if (end - start < minLen) continue;
    scenes.push({ id: scenes.length, start_ms: start, end_ms: end });
    if (scenes.length >= (opts.maxScenes ?? 200)) break;
  }
  if (scenes.length === 0 && duration_ms) {
    scenes.push({ id: 0, start_ms: 0, end_ms: duration_ms });
  }
  return { scenes, duration_ms };
}

export async function liteExtractKeyframes(opts: KeyframeOptions): Promise<{ keyframes: Keyframe[] }> {
  if (!existsSync(opts.source) && !opts.source.startsWith("http")) {
    throw new Error(`source not found: ${opts.source}`);
  }
  // First detect scenes so we know where to grab keyframes
  const { scenes } = await liteDetectScenes({ source: opts.source, maxScenes: 200 });
  const keyframes: Keyframe[] = [];
  const tmpDir = join(tmpdir(), `vintel-keyframes-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const quality = opts.quality ?? 85;
  // ffmpeg -q:v maps 2 (best) to 31 (worst); convert from 1..100 quality
  const qScale = Math.max(2, Math.round(31 - (quality / 100) * 29));

  const targets = opts.perScene !== false ? scenes.map((s) => ({ scene_id: s.id, t_ms: Math.round((s.start_ms + s.end_ms) / 2) }))
    : (() => {
        const arr: { scene_id: number; t_ms: number }[] = [];
        const total = scenes.at(-1)?.end_ms ?? 0;
        const step = opts.intervalMs ?? 2000;
        for (let i = 0; i * step < total; i++) {
          arr.push({ scene_id: 0, t_ms: i * step });
        }
        return arr;
      })();

  for (const target of targets) {
    const out = join(tmpDir, `kf-${target.scene_id}-${target.t_ms}.jpg`);
    try {
      await runFfmpeg([
        "-ss", String(target.t_ms / 1000),
        "-i", opts.source,
        "-frames:v", "1",
        "-q:v", String(qScale),
        "-y", out,
      ]);
      if (existsSync(out)) {
        const data = readFileSync(out);
        const stat = statSync(out);
        keyframes.push({
          scene_id: target.scene_id,
          t_ms: target.t_ms,
          jpeg_b64: data.toString("base64"),
        });
        if (stat.size > 0) {
          // Probe dimensions cheaply via JPEG marker scan
          for (let i = 0; i < data.length - 1; i++) {
            if (data[i] === 0xff && data[i + 1] === 0xc0 && i + 9 < data.length) {
              const height = (data[i + 5] << 8) | data[i + 6];
              const width = (data[i + 7] << 8) | data[i + 8];
              keyframes[keyframes.length - 1].height = height;
              keyframes[keyframes.length - 1].width = width;
              break;
            }
          }
        }
        unlinkSync(out);
      }
    } catch {
      // skip individual frame failures
    }
  }
  return { keyframes };
}
