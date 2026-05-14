// Smoke test — no backend required.
// Asserts the MCP server can be constructed and the CLI runs --help cleanly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

test("CLI binary prints help", () => {
  const result = spawnSync("node", ["--import", "tsx", join(root, "src/cli.ts"), "--help"], {
    encoding: "utf-8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, "CLI --help should exit 0");
  assert.match(result.stdout, /vzt-video-intel/);
  assert.match(result.stdout, /analyze/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /mcp/);
});

test("MCP server module imports", async () => {
  const mod = await import("../src/index.js");
  assert.equal(typeof mod.startMcpServer, "function");
});

test("Orchestrator module imports + has analyzeVideo", async () => {
  const mod = await import("../src/pipeline/orchestrator.js");
  assert.equal(typeof mod.analyzeVideo, "function");
});

test("All 6 backend modules import", async () => {
  await import("../src/backends/whisperx.js");
  await import("../src/backends/qwen-vl.js");
  await import("../src/backends/sam2.js");
  await import("../src/backends/scene-detect.js");
  await import("../src/backends/easyocr.js");
  await import("../src/backends/clip.js");
});

test("Schema types module imports", async () => {
  await import("../src/schema/types.js");
});
