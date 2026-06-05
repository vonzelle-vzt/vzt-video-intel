// Cloud Qwen2.5-VL via Replicate. Powers both chapter generation and action recognition.

import { replicateRun } from "./replicate.js";
import { qwenModel } from "../../lib/env.js";
import type { QwenChapterOptions, QwenActionOptions } from "../qwen-vl.js";
import type { Chapter, Action } from "../../schema/types.js";

interface RawQwenOutput { text?: string; content?: string }

function parseJsonish<T>(raw: string, key: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as T[];
    if (parsed && typeof parsed === "object" && Array.isArray(parsed[key])) return parsed[key] as T[];
  } catch {
    // try to extract the first top-level JSON array via regex
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]) as T[]; } catch { /* fall through */ }
    }
  }
  return [];
}

export async function cloudGenerateChapters(opts: QwenChapterOptions): Promise<{ chapters: Chapter[] }> {
  const prompt = `You are an expert video editor. Generate ${opts.targetChapterCount ?? 8} chapters for the video in '${opts.style ?? "youtube"}' style.
Return ONLY a JSON array. Each item must have: start_ms (integer), end_ms (integer), title (string), summary (string, optional).
No prose. No markdown fences.`;
  const output = await replicateRun<RawQwenOutput>({
    model: qwenModel(),
    input: { video: opts.source, prompt, max_tokens: 1024 },
    timeoutMs: 15 * 60_000,
  });
  const raw = output.text ?? output.content ?? "";
  return { chapters: parseJsonish<Chapter>(raw, "chapters") };
}

export async function cloudRecognizeActions(opts: QwenActionOptions): Promise<{ actions: Action[] }> {
  const range = opts.sceneStartMs != null && opts.sceneEndMs != null
    ? `between ${opts.sceneStartMs}ms and ${opts.sceneEndMs}ms`
    : "across the full video";
  const prompt = `Identify discrete actions ${range}. Return ONLY a JSON array of {start_ms, end_ms, label, confidence (0..1)}.
No prose. No markdown fences. label should be a short verb phrase.`;
  const output = await replicateRun<RawQwenOutput>({
    model: qwenModel(),
    input: { video: opts.source, prompt, max_tokens: 512 },
    timeoutMs: 10 * 60_000,
  });
  const raw = output.text ?? output.content ?? "";
  const items = parseJsonish<Action>(raw, "actions");
  const actions = items.map((a) => ({
    scene_id: 0,
    start_ms: Number(a.start_ms) || 0,
    end_ms: Number(a.end_ms) || 0,
    label: String(a.label ?? "unknown"),
    confidence: typeof a.confidence === "number" ? a.confidence : 0.5,
  })) as Action[];
  return { actions };
}
