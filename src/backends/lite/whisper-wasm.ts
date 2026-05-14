// Lite WhisperX via @xenova/transformers (Xenova/whisper-tiny.en).
// Pure WASM — no native compilation, works identically on macOS / Linux / Windows.
// We already depend on @xenova/transformers for CLIP, so this reuses that runtime.

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

// Decode a 16-bit PCM WAV file into a Float32Array of mono samples in [-1, 1].
function readWavAsFloat32(path: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(path);
  // Parse minimal RIFF/WAV header
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let offset = 12;
  let sampleRate = 16000;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset < buf.length - 8) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      sampleRate = buf.readUInt32LE(offset + 12);
    }
    if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size;
  }
  if (dataOffset < 0) throw new Error("no WAV data chunk");
  const sampleCount = dataSize / 2; // 16-bit PCM mono
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return { samples, sampleRate };
}

async function extractAudioPcm(source: string): Promise<{ samples: Float32Array; sampleRate: number; tmpDir: string }> {
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
  const wav = join(tmpDir, "audio.wav");
  const child = spawn(ffmpegPath(), [
    "-i", local,
    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
    "-y", wav,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c.toString()));
  const code: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (c) => resolve(c ?? 0));
  });
  if (code !== 0 || !existsSync(wav)) {
    throw new Error(`ffmpeg audio extraction failed: ${stderr.slice(-400)}`);
  }
  const { samples, sampleRate } = readWavAsFloat32(wav);
  try { unlinkSync(wav); } catch { /* ignore */ }
  return { samples, sampleRate, tmpDir };
}

export async function liteTranscribe(opts: WhisperXOptions): Promise<{ segments: TranscriptSegment[]; language?: string }> {
  let pipeline: any;
  try {
    const mod = await import("@xenova/transformers");
    pipeline = mod.pipeline;
  } catch {
    throw new Error(
      "lite-mode transcribe requires `@xenova/transformers` (declared optional). " +
      "Run `npm install @xenova/transformers` or switch to cloud mode with `vintel login`.",
    );
  }

  const model = process.env.VZT_WHISPER_MODEL ?? "Xenova/whisper-tiny.en";
  const { samples } = await extractAudioPcm(opts.source);

  // eslint-disable-next-line no-console
  console.error(`[vintel] transcribing ${(samples.length / 16000).toFixed(1)}s of audio with ${model} (WASM)…`);
  const transcriber = await pipeline("automatic-speech-recognition", model);
  const result = await transcriber(samples, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    language: opts.language === "auto" ? undefined : opts.language,
  });

  const chunks: { timestamp: [number, number]; text: string }[] = result?.chunks ?? [];
  const segments: TranscriptSegment[] = chunks
    .filter((c) => c.text?.trim().length > 0)
    .map((c) => ({
      start_ms: Math.round((c.timestamp[0] ?? 0) * 1000),
      end_ms: Math.round((c.timestamp[1] ?? c.timestamp[0] ?? 0) * 1000),
      text: c.text.trim(),
    }));

  if (!segments.length && typeof result?.text === "string") {
    segments.push({ start_ms: 0, end_ms: 0, text: result.text.trim() });
  }

  return { segments, language: opts.language };
}
