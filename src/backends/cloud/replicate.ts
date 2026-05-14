// Minimal Replicate REST client. We don't depend on the official SDK so the
// dependency surface stays small and the bin shim works on a fresh clone.

import { loadEnv } from "../../lib/env.js";

export interface ReplicateRunOptions {
  /** Model ref: "owner/name" — Replicate picks the latest version */
  model: string;
  /** Optional pinned version hash for reproducibility */
  version?: string;
  input: Record<string, unknown>;
  /** Polling cadence in ms */
  pollMs?: number;
  /** Max wait time in ms */
  timeoutMs?: number;
}

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: unknown;
  error: string | null;
  urls: { get: string; cancel: string };
}

export async function replicateRun<T = unknown>(opts: ReplicateRunOptions): Promise<T> {
  const token = loadEnv().replicateToken;
  if (!token) {
    throw new Error(
      "REPLICATE_API_TOKEN not set. Run `vintel login` to add one, or `vintel config set mode=lite` for free offline mode.",
    );
  }
  const body: Record<string, unknown> = { input: opts.input };
  if (opts.version) body.version = opts.version;
  const endpoint = opts.version
    ? "https://api.replicate.com/v1/predictions"
    : `https://api.replicate.com/v1/models/${opts.model}/predictions`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "wait=60", // short-circuit if it finishes in <60s
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate ${endpoint} returned ${res.status}: ${text.slice(0, 240)}`);
  }
  let prediction = (await res.json()) as Prediction;

  const pollMs = opts.pollMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
    if (Date.now() > deadline) {
      throw new Error(`Replicate prediction ${prediction.id} timed out after ${opts.timeoutMs ?? 600_000}ms`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
    const poll = await fetch(prediction.urls.get, { headers: { authorization: `Bearer ${token}` } });
    if (!poll.ok) {
      throw new Error(`Replicate poll returned ${poll.status}`);
    }
    prediction = (await poll.json()) as Prediction;
  }

  if (prediction.status !== "succeeded") {
    throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error ?? "unknown"}`);
  }
  return prediction.output as T;
}
