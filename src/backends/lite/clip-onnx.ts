// Lite-mode CLIP via @xenova/transformers (Slice 3). Stubbed in Slice 1.

import type { ClipSearchOptions, ClipSearchHit } from "../clip.js";

export async function liteSemanticSearch(_opts: ClipSearchOptions): Promise<{ hits: ClipSearchHit[] }> {
  throw new Error("lite-mode CLIP not yet shipped (lands in v1.1.0 Slice 3).");
}
