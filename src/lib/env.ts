// Backend URL resolution — sensible defaults match the docker-compose stack.

export interface Env {
  whisperx: string;
  qwen: string;
  sam2: string;
  sceneDetect: string;
  ocr: string;
  clip: string;
  muxBase: string;
}

export function loadEnv(): Env {
  return {
    whisperx: process.env.WHISPERX_URL ?? "http://localhost:9010",
    qwen: process.env.QWEN_VL_URL ?? "http://localhost:9011",
    sam2: process.env.SAM2_URL ?? "http://localhost:9012",
    sceneDetect: process.env.SCENEDETECT_URL ?? "http://localhost:9013",
    ocr: process.env.EASYOCR_URL ?? "http://localhost:9014",
    clip: process.env.CLIP_URL ?? "http://localhost:9015",
    muxBase: process.env.MUX_BASE_URL ?? "",
  };
}
