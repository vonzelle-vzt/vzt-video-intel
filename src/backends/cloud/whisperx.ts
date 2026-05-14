// Cloud WhisperX via Replicate's incredibly-fast-whisper.
// Output is reshaped to match the local WhisperX HTTP contract.

import { replicateRun } from "./replicate.js";
import type { WhisperXOptions } from "../whisperx.js";
import type { TranscriptSegment } from "../../schema/types.js";

interface IFWChunk { text: string; timestamp: [number, number] }
interface IFWOutput { text: string; chunks?: IFWChunk[] }

export async function cloudTranscribe(opts: WhisperXOptions): Promise<{ segments: TranscriptSegment[]; language?: string }> {
  const output = await replicateRun<IFWOutput>({
    model: "vaibhavs10/incredibly-fast-whisper",
    input: {
      audio: opts.source,
      task: "transcribe",
      language: opts.language ?? "None",
      timestamp: "chunk",
      diarise_audio: opts.diarize ?? true,
      hf_token: process.env.HF_TOKEN ?? undefined,
    },
    timeoutMs: 20 * 60_000,
  });

  const segments: TranscriptSegment[] = (output.chunks ?? []).map((c) => {
    const result: TranscriptSegment = {
      start_ms: Math.round((c.timestamp?.[0] ?? 0) * 1000),
      end_ms: Math.round((c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0) * 1000),
      text: c.text.trim(),
    };
    return result;
  });
  if (!segments.length && output.text) {
    segments.push({ start_ms: 0, end_ms: 0, text: output.text.trim() });
  }
  return { segments, language: opts.language };
}
