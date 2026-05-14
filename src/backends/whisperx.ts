import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";
import type { TranscriptSegment } from "../schema/types.js";

export interface WhisperXOptions {
  source: string;
  language?: string;
  diarize?: boolean;
  minSpeakers?: number;
  maxSpeakers?: number;
}

export async function transcribe(opts: WhisperXOptions): Promise<{ segments: TranscriptSegment[]; language?: string }> {
  return postRun(loadEnv().whisperx, opts as unknown as Record<string, unknown>);
}
