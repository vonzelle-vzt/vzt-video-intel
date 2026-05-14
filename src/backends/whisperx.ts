// Mode-aware dispatcher. Routes the call to cloud / local / lite based on
// the resolved runtime mode (see src/runtime/mode.ts).

import { loadEnv } from "../lib/env.js";
import { postRun } from "../lib/http.js";
import { resolveStage } from "../runtime/mode.js";
import type { TranscriptSegment } from "../schema/types.js";

export interface WhisperXOptions {
  source: string;
  language?: string;
  diarize?: boolean;
  minSpeakers?: number;
  maxSpeakers?: number;
}

export async function transcribe(opts: WhisperXOptions): Promise<{ segments: TranscriptSegment[]; language?: string }> {
  const route = await resolveStage("transcribe");
  if (route === "cloud") {
    const { cloudTranscribe } = await import("./cloud/whisperx.js");
    return cloudTranscribe(opts);
  }
  if (route === "lite") {
    const { liteTranscribe } = await import("./lite/whisper-wasm.js");
    return liteTranscribe(opts);
  }
  return postRun(loadEnv().whisperx, opts as unknown as Record<string, unknown>);
}
