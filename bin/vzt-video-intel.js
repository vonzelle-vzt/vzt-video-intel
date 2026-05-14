#!/usr/bin/env node
// VZT Video-Intel CLI entry point.
// Delegates to the compiled CLI in dist/cli.js when available, falls back to
// tsx-loaded src/cli.ts during development so `node bin/vzt-video-intel.js` works
// straight from a fresh clone before `npm run build`.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));
const built = join(root, "dist", "cli.js");
const src = join(root, "src", "cli.ts");

if (existsSync(built)) {
  await import(pathToFileURL(built).href);
} else if (existsSync(src)) {
  await import("tsx/esm/api").then(({ tsImport }) => tsImport(pathToFileURL(src).href, import.meta.url));
} else {
  console.error("vzt-video-intel: build not found. Run `npm run build` first.");
  process.exit(1);
}
