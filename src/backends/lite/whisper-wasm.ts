// Lite-mode WhisperX (Slice 3 — pure Node WASM implementation).
// Stubbed in Slice 1 so the dispatcher typechecks.

import type { WhisperXOptions } from "../whisperx.js";
import type { TranscriptSegment } from "../../schema/types.js";

export async function liteTranscribe(_opts: WhisperXOptions): Promise<{ segments: TranscriptSegment[]; language?: string }> {
  throw new Error(
    "lite-mode transcribe not yet shipped (lands in v1.1.0 Slice 3). " +
    "Use `vintel config set mode=cloud` + `vintel login` for cloud transcription right now, " +
    "or `vintel up` for the self-hosted backend.",
  );
}
