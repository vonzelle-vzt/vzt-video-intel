import { loadEnv } from "./env.js";
import { getHealth } from "./http.js";
import type { BackendHealth } from "../schema/types.js";

export async function verifyBackends(): Promise<BackendHealth[]> {
  const env = loadEnv();
  const backends: { name: string; url: string }[] = [
    { name: "whisperx", url: env.whisperx },
    { name: "qwen-vl", url: env.qwen },
    { name: "sam2", url: env.sam2 },
    { name: "scenedetect", url: env.sceneDetect },
    { name: "easyocr", url: env.ocr },
    { name: "clip", url: env.clip },
  ];

  return Promise.all(
    backends.map(async (b) => {
      const h = await getHealth(b.url);
      const result: BackendHealth = { name: b.name, url: b.url, reachable: h.ok, latency_ms: h.latency_ms };
      if (h.status !== undefined) result.status_code = h.status;
      if (h.error !== undefined) result.error = h.error;
      return result;
    }),
  );
}
