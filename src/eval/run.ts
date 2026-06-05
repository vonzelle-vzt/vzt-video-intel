// Eval harness — score the pipeline against hand-labeled gold fixtures.
//
// Point it at a directory of `*.gold.json` files (each referencing a video and
// declaring the dimensions it certifies). The harness runs `analyze` on each
// video and scores only the declared dimensions, so a fixture that has no
// speech simply skips WER instead of failing it. Output is a per-fixture
// scorecard; `--ci` exits non-zero if any dimension falls below the `min` the
// gold declares — that's the regression gate for model swaps.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { analyzeVideo } from "../pipeline/orchestrator.js";
import { boundaryF1, ocrRecall, wordErrorRate } from "./metrics.js";

// ---- gold schema -------------------------------------------------------------

export interface GoldFixture {
  /** Video path relative to the gold file (or absolute / URL). */
  source: string;
  notes?: string;
  /** Expected on-screen text phrases. Scores OCR recall. */
  ocr?: { phrases: string[]; min?: number };
  /** Expected internal scene-cut boundaries (ms). Scores boundary F1. */
  scenes?: { boundaries_ms: number[]; tolerance_ms?: number; min?: number };
  /** Expected speech transcript. Scores WER (lower is better; `max` is the gate). */
  speech?: { text: string; max?: number } | null;
  /** Expected duration. Pass/fail within tolerance. */
  duration?: { ms: number; tolerance_ms?: number };
}

// ---- result shapes -----------------------------------------------------------

export interface DimensionScore {
  dimension: "ocr" | "scenes" | "speech" | "duration";
  metric: string; // e.g. "recall", "f1", "wer", "delta_ms"
  value: number;
  pass: boolean; // vs the gold-declared gate (true if no gate declared)
  detail: string;
}

export interface FixtureScore {
  file: string;
  source: string;
  notes?: string;
  scores: DimensionScore[];
  error?: string;
}

export interface EvalResult {
  fixturesDir: string;
  fixtures: FixtureScore[];
  passed: boolean; // all gated dimensions across all fixtures passed
}

function findGold(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".gold.json"))
    .map((n) => join(dir, n))
    .sort();
}

function resolveSource(goldFile: string, source: string): string {
  if (/^https?:\/\//i.test(source) || isAbsolute(source)) return source;
  return resolve(dirname(goldFile), source);
}

async function scoreFixture(goldFile: string): Promise<FixtureScore> {
  const gold = JSON.parse(readFileSync(goldFile, "utf-8")) as GoldFixture;
  const source = resolveSource(goldFile, gold.source);
  const base: FixtureScore = { file: goldFile, source, notes: gold.notes, scores: [] };

  let graph;
  try {
    graph = await analyzeVideo({ source, includeKeyframes: false, trackEntities: false, recognizeActions: false });
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  const scores: DimensionScore[] = [];

  // OCR recall
  if (gold.ocr) {
    const r = ocrRecall(graph.ocr.map((o) => o.text), gold.ocr.phrases);
    const min = gold.ocr.min ?? 0;
    scores.push({
      dimension: "ocr",
      metric: "recall",
      value: r.recall,
      pass: r.recall >= min,
      detail: `${r.matched}/${r.expected} phrases${r.missing.length ? ` (missing: ${r.missing.join(", ")})` : ""}`,
    });
  }

  // Scene-boundary F1 — predicted internal cuts = scene starts after the first.
  if (gold.scenes) {
    const predicted = graph.scenes.map((s) => s.start_ms).filter((ms) => ms > 0);
    const f = boundaryF1(predicted, gold.scenes.boundaries_ms, gold.scenes.tolerance_ms ?? 1000);
    const min = gold.scenes.min ?? 0;
    scores.push({
      dimension: "scenes",
      metric: "f1",
      value: f.f1,
      pass: f.f1 >= min,
      detail: `P ${f.precision.toFixed(2)} / R ${f.recall.toFixed(2)} — matched ${f.matched}/${f.expected}, predicted ${f.predicted}`,
    });
  }

  // WER (only if gold declares speech)
  if (gold.speech && gold.speech.text.trim()) {
    const hyp = graph.transcript.map((t) => t.text).join(" ");
    const w = wordErrorRate(gold.speech.text, hyp);
    const max = gold.speech.max ?? Infinity;
    scores.push({
      dimension: "speech",
      metric: "wer",
      value: w.wer,
      pass: w.wer <= max,
      detail: `${w.edits} edits over ${w.refWords} ref words`,
    });
  }

  // Duration check
  if (gold.duration) {
    const tol = gold.duration.tolerance_ms ?? 500;
    const delta = Math.abs((graph.duration_ms ?? 0) - gold.duration.ms);
    scores.push({
      dimension: "duration",
      metric: "delta_ms",
      value: delta,
      pass: delta <= tol,
      detail: `got ${graph.duration_ms ?? 0}ms, expected ${gold.duration.ms}ms (±${tol})`,
    });
  }

  return { ...base, scores };
}

export async function runEval(fixturesDir: string): Promise<EvalResult> {
  const files = findGold(fixturesDir);
  const fixtures: FixtureScore[] = [];
  let passed = true;
  for (const f of files) {
    const score = await scoreFixture(f);
    fixtures.push(score);
    if (score.error || score.scores.some((s) => !s.pass)) passed = false;
  }
  return { fixturesDir, fixtures, passed };
}
