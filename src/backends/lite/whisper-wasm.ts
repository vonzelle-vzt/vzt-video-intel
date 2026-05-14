// Lite WhisperX via nodejs-whisper.
// Extracts audio with ffmpeg-static, transcribes with whisper.cpp via the
// nodejs-whisper wrapper, reshapes output to TranscriptSegment[].

import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createRequire } from "node:module";
import type { WhisperXOptions } from "../whisperx.js";
import type { TranscriptSegment } from "../../schema/types.js";

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

async function extractAudio(source: string): Promise<string> {
  const tmpDir = join(tmpdir(), `vintel-audio-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  let local = source;
  if (source.startsWith("http")) {
    local = join(tmpDir, basename(new URL(source).pathname) || "input.mp4");
    const res = await fetch(source);
    if (!res.ok) throw new Error(`fetch ${source} returned ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(local, buf);
  }
  const out = join(tmpDir, "audio.wav");
  const child = spawn(ffmpegPath(), [
    "-i", local,
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-y", out,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c.toString()));
  const code: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (c) => resolve(c ?? 0));
  });
  if (code !== 0 || !existsSync(out)) {
    throw new Error(`ffmpeg audio extraction failed: ${stderr.slice(-400)}`);
  }
  return out;
}

export async function liteTranscribe(opts: WhisperXOptions): Promise<{ segments: TranscriptSegment[]; language?: string }> {
  let nodewhisper: any;
  try {
    const mod = await import("nodejs-whisper");
    nodewhisper = mod.nodewhisper ?? mod.default ?? mod;
  } catch {
    throw new Error(
      "lite-mode transcribe requires `nodejs-whisper` (declared optional). " +
      "Run `npm install nodejs-whisper` or switch to cloud mode with `vintel login`.",
    );
  }

  const audioPath = await extractAudio(opts.source);
  const model = process.env.VZT_WHISPER_MODEL ?? "base.en";

  try {
    const result = await nodewhisper(audioPath, {
      modelName: model,
      autoDownloadModelName: model,
      removeWavFileAfterTranscription: false,
      withCuda: false,
      whisperOptions: {
        outputInJson: true,
        outputInText: false,
        outputInSrt: false,
        outputInVtt: false,
        translateToEnglish: false,
        language: opts.language ?? "auto",
      },
    });

    // nodejs-whisper writes <audioPath>.json next to the wav; result may be the path or content.
    const jsonPath = audioPath.replace(/\.wav$/, ".wav.json");
    let segments: TranscriptSegment[] = [];
    if (existsSync(jsonPath)) {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
      const raw = parsed.transcription ?? parsed.segments ?? [];
      segments = raw.map((s: { timestamps?: { from: string; to: string }; offsets?: { from: number; to: number }; text: string }) => ({
        start_ms: s.offsets?.from ?? parseTimeToMs(s.timestamps?.from ?? "00:00:00.000"),
        end_ms: s.offsets?.to ?? parseTimeToMs(s.timestamps?.to ?? "00:00:00.000"),
        text: s.text.trim(),
      }));
      try { unlinkSync(jsonPath); } catch { /* ignore */ }
    } else if (typeof result === "string") {
      segments = [{ start_ms: 0, end_ms: 0, text: result.trim() }];
    }

    try { unlinkSync(audioPath); } catch { /* ignore */ }
    return { segments, language: opts.language };
  } catch (err) {
    try { unlinkSync(audioPath); } catch { /* ignore */ }
    throw err;
  }
}

function parseTimeToMs(ts: string): number {
  const m = ts.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (!m) return 0;
  return (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000 + parseInt(m[4].padEnd(3, "0").slice(0, 3), 10);
}
