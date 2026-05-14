// Child-process caption worker.
//
// The lite caption model (vit-gpt2, ONNX/WASM) shares one process with the
// Whisper and Tesseract WASM runtimes when it runs inside `analyze`. On a
// long video those runtimes have grown large by the time captioning starts,
// and onnxruntime's session init fails with `bad allocation` — taking the
// whole process down. Running captioning in its own process gives it a fresh
// WASM heap, and a crash here is just a non-zero child exit the parent can
// catch (see vlm-caption.ts) instead of a hard abort of `analyze`.
//
// Protocol: one JSON request per stdin line `{ id, imagePath }`; one JSON
// response per stdout line `{ id, caption }` or `{ id, error }`. The model
// loads once and is reused. Requests are serialized. The worker exits when
// its stdin closes (the parent is done or gone).

import { createInterface } from "node:readline";

interface Request {
  id: number;
  imagePath: string;
}

let modPromise: Promise<any> | null = null;
function getMod(): Promise<any> {
  return (modPromise ??= import("@xenova/transformers"));
}

let captionerPromise: Promise<any> | null = null;
function getCaptioner(mod: any): Promise<any> {
  return (captionerPromise ??= mod.pipeline(
    "image-to-text",
    process.env.VZT_CAPTION_MODEL ?? "Xenova/vit-gpt2-image-captioning",
  ));
}

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handle(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: Request;
  try {
    req = JSON.parse(trimmed) as Request;
  } catch {
    return; // not a request we can answer — ignore
  }
  try {
    const mod = await getMod();
    // Read the frame first — a bad path fails fast here, before the model load.
    const image = await mod.RawImage.read(req.imagePath);
    const captioner = await getCaptioner(mod);
    const result = await captioner(image);
    const text: string = Array.isArray(result)
      ? result[0]?.generated_text ?? ""
      : result?.generated_text ?? "";
    send({ id: req.id, caption: text.replace(/\s+/g, " ").trim() });
  } catch (err) {
    send({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
}

// Serialize: caption one frame at a time. Each link is self-contained (handle
// never rejects), so the chain can't break.
let chain: Promise<void> = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  chain = chain.then(() => handle(line));
});
rl.on("close", () => {
  // stdin closed — parent is done with us.
  chain.finally(() => process.exit(0));
});
