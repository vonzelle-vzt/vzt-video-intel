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

const SAMPLE_RATE = 16000;
// Whisper's encoder has a fixed 30s receptive field. Feeding it exactly one
// 30s window per call means no internal re-chunking — transformers.js's
// chunk_length_s/stride path is where long audio silently dropped segments.
const WINDOW_SEC = 30;

/**
 * Transcribe in fixed 30s windows instead of one giant call.
 *
 * The old implementation handed the entire decoded audio to `transcriber()`
 * in a single call. On long videos (30+ min) the WASM runtime accumulated
 * intermediate tensors until the process was OOM-killed mid-run — which is why
 * `analyze` bailed. Here we slice the PCM into 30s windows (whisper's native
 * receptive field), run one clean inference per window reusing a single loaded
 * model, offset each window's timestamps back onto the global timeline, and
 * isolate failures so one bad window degrades to a gap instead of a crash.
 */
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
  const windowSamples = WINDOW_SEC * SAMPLE_RATE;

  // English-only whisper builds (the `.en` models) reject a `language` option:
  // it sets forced_decoder_ids the model has no tokens for, and every window
  // comes back empty. Only multilingual builds take a language hint.
  const isEnglishOnly = /\.en$/i.test(model);
  const languageHint = isEnglishOnly || opts.language === "auto" ? undefined : opts.language;

  const { samples } = await extractAudioPcm(opts.source);
  const totalSec = samples.length / SAMPLE_RATE;
  const windowCount = Math.max(1, Math.ceil(samples.length / windowSamples));

  // eslint-disable-next-line no-console
  console.error(
    `[vintel] transcribing ${totalSec.toFixed(1)}s of audio with ${model} (WASM) ` +
    `in ${windowCount} window(s) of ${WINDOW_SEC}s…`,
  );

  const transcriber = await pipeline("automatic-speech-recognition", model);
  const segments: TranscriptSegment[] = [];
  let okWindows = 0;

  for (let w = 0; w < windowCount; w++) {
    const startSample = w * windowSamples;
    const windowStartMs = Math.round((startSample / SAMPLE_RATE) * 1000);
    // `slice` (not `subarray`) — we need a fresh, zero-offset ArrayBuffer.
    // A `subarray` view shares the full backing buffer; transformers.js reads
    // it byteOffset-unaware and transcribes garbage. The per-window copy is
    // ~2 MB — cheap and correct.
    const slice = samples.slice(startSample, startSample + windowSamples);
    try {
      // No chunk_length_s: the window already fits whisper's 30s field, so it
      // runs as a single native pass with reliable per-segment timestamps.
      const result = await transcriber(slice, {
        return_timestamps: true,
        language: languageHint,
      });

      const chunks: { timestamp: [number, number]; text: string }[] = result?.chunks ?? [];
      let added = 0;
      for (const c of chunks) {
        const text = c.text?.trim();
        if (!text) continue;
        segments.push({
          start_ms: windowStartMs + Math.round((c.timestamp[0] ?? 0) * 1000),
          end_ms: windowStartMs + Math.round((c.timestamp[1] ?? c.timestamp[0] ?? 0) * 1000),
          text,
        });
        added++;
      }
      // Fallback: model returned plain text with no per-chunk timestamps.
      if (added === 0 && typeof result?.text === "string" && result.text.trim()) {
        segments.push({
          start_ms: windowStartMs,
          end_ms: windowStartMs + WINDOW_SEC * 1000,
          text: result.text.trim(),
        });
        added++;
      }
      okWindows++;
      if (windowCount > 1 && (w === 0 || (w + 1) % 10 === 0 || w === windowCount - 1)) {
        // eslint-disable-next-line no-console
        console.error(`[vintel]   window ${w + 1}/${windowCount} (${segments.length} segment(s) so far)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[vintel]   window ${w + 1}/${windowCount} failed: ${msg} — skipping`);
    }
  }

  // eslint-disable-next-line no-console
  console.error(`[vintel] transcription done — ${segments.length} segment(s) from ${okWindows}/${windowCount} window(s)`);
  return { segments, language: opts.language };
}
