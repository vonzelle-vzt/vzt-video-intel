// Eval metrics — pure functions, no I/O. Each compares a pipeline prediction
// to hand-labeled ground truth and returns a 0..1 score (higher = better),
// except WER where lower is better (it's an error rate). These are what make a
// model swap measurable instead of superstitious: freeze a gold fixture, swap
// VZT_CLOUD_*_MODEL, re-run, compare the numbers.

// ---- word error rate (transcription) ----------------------------------------

function normWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

/** Token-level Levenshtein distance. */
function editDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export interface WerResult {
  wer: number; // 0 = perfect, can exceed 1 with many insertions
  refWords: number;
  edits: number;
}

/** Word Error Rate = edit distance / reference word count. Lower is better. */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = normWords(reference);
  const hyp = normWords(hypothesis);
  const edits = editDistance(ref, hyp);
  return { wer: ref.length ? edits / ref.length : hyp.length ? 1 : 0, refWords: ref.length, edits };
}

// ---- scene-boundary F1 -------------------------------------------------------

export interface F1Result {
  precision: number;
  recall: number;
  f1: number;
  matched: number;
  predicted: number;
  expected: number;
}

/**
 * Match predicted boundaries to expected ones within ±tolerance (greedy,
 * each gold boundary consumes at most one prediction). Returns precision /
 * recall / F1.
 */
export function boundaryF1(predicted: number[], expected: number[], toleranceMs: number): F1Result {
  const used = new Array(predicted.length).fill(false);
  let matched = 0;
  for (const e of expected) {
    let bestIdx = -1;
    let bestDelta = Infinity;
    for (let i = 0; i < predicted.length; i++) {
      if (used[i]) continue;
      const delta = Math.abs(predicted[i] - e);
      if (delta <= toleranceMs && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used[bestIdx] = true;
      matched++;
    }
  }
  const precision = predicted.length ? matched / predicted.length : expected.length ? 0 : 1;
  const recall = expected.length ? matched / expected.length : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, matched, predicted: predicted.length, expected: expected.length };
}

// ---- OCR recall (on-screen text) ---------------------------------------------

export interface OcrResult {
  recall: number; // fraction of expected phrases found
  matched: number;
  expected: number;
  missing: string[];
}

/**
 * A gold phrase counts as found when all of its (non-trivial) word tokens
 * appear somewhere in the predicted OCR text. This tolerates OCR returning
 * words as separate regions and ignores ordering/casing — what matters is
 * "did we read the text that's on screen".
 */
export function ocrRecall(predictedTexts: string[], expectedPhrases: string[]): OcrResult {
  const predTokens = new Set(predictedTexts.flatMap((t) => normWords(t)));
  const missing: string[] = [];
  let matched = 0;
  for (const phrase of expectedPhrases) {
    const tokens = normWords(phrase);
    const found = tokens.length > 0 && tokens.every((t) => predTokens.has(t));
    if (found) matched++;
    else missing.push(phrase);
  }
  return {
    recall: expectedPhrases.length ? matched / expectedPhrases.length : 1,
    matched,
    expected: expectedPhrases.length,
    missing,
  };
}
