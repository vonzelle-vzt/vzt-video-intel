#!/usr/bin/env node
// VZT Video-Intel — CLI entry point.
//
// Subcommands:
//   analyze       Run the full pipeline on a video, print the scene graph as JSON
//   transcribe    WhisperX transcription with diarization
//   scenes        PySceneDetect scene boundaries
//   entities      SAM2 entity tracking
//   keyframes     Per-scene keyframe extraction
//   ocr           On-screen text extraction
//   search        CLIP semantic moment search
//   chapters      Qwen2.5-VL chapter generation
//   auto          Detect environment + pick best mode (cloud / local / lite)
//   config        Show or set persisted configuration
//   login         Store cloud API token
//   doctor        Health-check all 6 backends
//   up            Boot the docker-compose stack
//   down          Stop the docker-compose stack
//   init          First-run wizard — creates .env, prints next steps
//   mcp           Run as an MCP stdio server (for Claude Code, Cursor, OpenCode)

import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import kleur from "kleur";

import { analyzeVideo } from "./pipeline/orchestrator.js";
import { transcribe } from "./backends/whisperx.js";
import { detectScenes, extractKeyframes } from "./backends/scene-detect.js";
import { trackEntities } from "./backends/sam2.js";
import { ocrOverlay } from "./backends/easyocr.js";
import { semanticSearch } from "./backends/clip.js";
import { generateChapters } from "./backends/qwen-vl.js";
import { verifyBackends } from "./lib/verify-backends.js";
import { startMcpServer } from "./index.js";
import { detect, resolveMode } from "./runtime/auto.js";
import { readConfig, writeConfig, isFirstRun, markFirstRunComplete } from "./runtime/cache.js";
import { invalidateRoutingCache } from "./runtime/mode.js";
import type { Mode } from "./lib/env.js";

const __filename = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(dirname(__filename), "..");
const DOCKER_DIR = join(PKG_ROOT, "docker");

const program = new Command();
program
  .name("vzt-video-intel")
  .description("VZT Video-Intel — temporal scene-graph CLI + MCP server. Gives Claude video understanding.")
  .version("1.1.0");

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

async function tryOrHelp<T>(fn: () => Promise<T>): Promise<T | void> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(kleur.red("✖ ") + msg);
    if (msg.includes("REPLICATE_API_TOKEN")) {
      console.error("");
      console.error(kleur.yellow("No cloud token. Options:"));
      console.error("  " + kleur.cyan("vintel login") + "                  add a Replicate token");
      console.error("  " + kleur.cyan("vintel config set mode=lite") + "   use free offline mode");
      console.error("  " + kleur.cyan("vintel up") + "                     boot the local Docker stack");
    } else if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error("");
      console.error(kleur.yellow("Backend not reachable. Try:"));
      console.error("  " + kleur.cyan("vintel auto") + "       redetect and pick the best mode");
      console.error("  " + kleur.cyan("vintel up") + "         boot the local Docker stack");
      console.error("  " + kleur.cyan("vintel login") + "      add a cloud token to use Replicate");
    }
    process.exit(1);
  }
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function runFirstRunWizardIfNeeded(): Promise<void> {
  if (!isFirstRun()) return;
  console.log(kleur.bold("✨ First run — picking your mode."));
  console.log("   " + kleur.gray("Detecting your environment..."));
  const det = await detect();
  console.log(`   ${det.hasGpu ? kleur.green("✓") : kleur.red("✗")} NVIDIA GPU`);
  console.log(`   ${det.hasDocker ? kleur.green("✓") : kleur.red("✗")} Docker`);
  console.log(`   ${det.hasFfmpeg ? kleur.green("✓") : kleur.red("✗")} ffmpeg`);
  console.log(`   ${det.hasCloudKey ? kleur.green("✓") : kleur.red("✗")} REPLICATE_API_TOKEN`);
  console.log(`   ${det.localBackendsReachable === 6 ? kleur.green("✓") : kleur.red("✗")} Local backends (${det.localBackendsReachable}/6 reachable)`);
  console.log("");
  console.log(kleur.bold("🤔 You have three options:"));
  console.log("   " + kleur.cyan("[1] cloud") + "  Use Replicate for heavy backends.  ~$0.06/min");
  console.log("   " + kleur.cyan("[2] lite") + "   Pure-Node WASM where possible.  Free + offline.  (lands in slice 3)");
  console.log("   " + kleur.cyan("[3] local") + "  Self-host the Docker stack.  Cheapest at scale.");
  console.log("");
  console.log(kleur.gray("   Recommended: " + det.recommendedMode + " — " + det.recommendedReason));
  console.log("");
  const choice = (await prompt("> ")).toLowerCase();
  let mode: Mode;
  if (choice === "1" || choice === "cloud") mode = "cloud";
  else if (choice === "2" || choice === "lite") mode = "lite";
  else if (choice === "3" || choice === "local") mode = "local";
  else mode = det.recommendedMode;
  writeConfig({ mode });
  if (mode === "cloud" && !det.hasCloudKey) {
    console.log("");
    const token = await prompt("Paste your Replicate API token (or press Enter to skip): ");
    if (token) writeConfig({ replicateToken: token });
  }
  markFirstRunComplete();
  invalidateRoutingCache();
  console.log("");
  console.log(kleur.green("✓ ") + `Mode set to ${kleur.cyan(mode)}. Saved to ~/.vzt-video-intel/config.json`);
  console.log("");
}

program
  .command("analyze <source>")
  .description("Run the full pipeline on a video; print the scene graph as JSON")
  .option("--no-keyframes", "skip keyframe extraction")
  .option("--no-entities", "skip entity tracking (faster)")
  .option("--no-actions", "skip action recognition (faster)")
  .option("--mux-urls", "include Mux URLs for timestamp citation")
  .option("-l, --language <iso>", "language hint (e.g. en, es)")
  .option("--max-scenes <n>", "cap scenes returned", (v) => parseInt(v, 10))
  .action(async (source: string, opts) => {
    await runFirstRunWizardIfNeeded();
    await tryOrHelp(async () => {
      const result = await analyzeVideo({
        source,
        includeKeyframes: opts.keyframes !== false,
        trackEntities: opts.entities !== false,
        recognizeActions: opts.actions !== false,
        includeMuxUrls: !!opts.muxUrls,
        language: opts.language,
        maxScenes: opts.maxScenes,
      });
      print(result);
    });
  });

program
  .command("transcribe <source>")
  .description("WhisperX transcription with speaker diarization")
  .option("-l, --language <iso>", "language hint")
  .option("--no-diarize", "disable diarization")
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await transcribe({ source, language: opts.language, diarize: opts.diarize !== false })));
  });

program
  .command("scenes <source>")
  .description("Detect scene boundaries via PySceneDetect")
  .option("-t, --threshold <n>", "content threshold (lower = more sensitive)", (v) => parseFloat(v))
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await detectScenes({ source, threshold: opts.threshold })));
  });

program
  .command("entities <source>")
  .description("Segment + track entities via SAM2")
  .option("--prompt <text>", "filter entity classes via text prompt (e.g. 'football players')")
  .option("--start-ms <n>", "scene start", (v) => parseInt(v, 10))
  .option("--end-ms <n>", "scene end", (v) => parseInt(v, 10))
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await trackEntities({ source, promptText: opts.prompt, sceneStartMs: opts.startMs, sceneEndMs: opts.endMs })));
  });

program
  .command("keyframes <source>")
  .description("Extract per-scene keyframes as base64 JPEGs")
  .option("--interval-ms <n>", "cadence when not per-scene", (v) => parseInt(v, 10))
  .option("--per-scene", "one per detected scene (default)", true)
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await extractKeyframes({ source, perScene: opts.perScene !== false, intervalMs: opts.intervalMs })));
  });

program
  .command("ocr <source>")
  .description("Read on-screen text via EasyOCR")
  .option("--lang <iso...>", "OCR languages", ["en"])
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await ocrOverlay({ source, languages: opts.lang })));
  });

program
  .command("search <source> <query>")
  .description("CLIP-based moment search by natural language")
  .option("-k, --top-k <n>", "top results", (v) => parseInt(v, 10), 10)
  .option("--min-score <n>", "minimum similarity", (v) => parseFloat(v), 0.2)
  .action(async (source: string, query: string, opts) => {
    await tryOrHelp(async () => print(await semanticSearch({ source, query, topK: opts.topK, minScore: opts.minScore })));
  });

program
  .command("chapters <source>")
  .description("Generate chapters via Qwen2.5-VL")
  .option("-n, --count <n>", "target chapter count", (v) => parseInt(v, 10), 8)
  .option("-s, --style <style>", "youtube | course | highlights | meeting", "youtube")
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await generateChapters({ source, targetChapterCount: opts.count, style: opts.style })));
  });

program
  .command("doctor")
  .description("Health-check all 6 local backends (alias of `auto` for backward-compat)")
  .action(async () => {
    const report = await verifyBackends();
    const offline = report.filter((b) => !b.reachable);
    for (const b of report) {
      const icon = b.reachable ? kleur.green("✓") : kleur.red("✖");
      const latency = b.latency_ms !== undefined ? kleur.gray(`(${b.latency_ms}ms)`) : "";
      console.log(`${icon} ${b.name.padEnd(12)} ${b.url} ${latency}${b.error ? "  " + kleur.red(b.error) : ""}`);
    }
    if (offline.length > 0) {
      console.log("");
      console.log(kleur.yellow(`${offline.length}/6 local backends offline. Run ${kleur.cyan("vintel auto")} for a full environment report and mode recommendation.`));
      process.exit(1);
    }
    console.log("");
    console.log(kleur.green("All 6 backends healthy."));
  });

program
  .command("auto")
  .description("Detect environment, recommend the best mode, optionally persist it")
  .option("--apply", "save the recommended mode to ~/.vzt-video-intel/config.json")
  .action(async (opts) => {
    const { mode, detection, routing } = await resolveMode();
    console.log(kleur.bold("Environment:"));
    console.log(`   ${detection.hasGpu ? kleur.green("✓") : kleur.red("✗")} NVIDIA GPU`);
    console.log(`   ${detection.hasDocker ? kleur.green("✓") : kleur.red("✗")} Docker`);
    console.log(`   ${detection.hasFfmpeg ? kleur.green("✓") : kleur.red("✗")} ffmpeg`);
    console.log(`   ${detection.hasCloudKey ? kleur.green("✓") : kleur.red("✗")} REPLICATE_API_TOKEN`);
    console.log(`   ${detection.localBackendsReachable === 6 ? kleur.green("✓") : kleur.red("✗")} Local backends (${detection.localBackendsReachable}/6 reachable)`);
    console.log("");
    console.log(kleur.bold("Resolved mode: ") + kleur.cyan(mode));
    console.log(kleur.gray("   " + detection.recommendedReason));
    console.log("");
    console.log(kleur.bold("Per-stage routing:"));
    for (const [stage, route] of Object.entries(routing)) {
      const color = route === "cloud" ? kleur.cyan : route === "local" ? kleur.magenta : route === "lite" ? kleur.green : kleur.gray;
      console.log(`   ${stage.padEnd(11)} → ${color(route)}`);
    }
    if (opts.apply) {
      writeConfig({ mode });
      invalidateRoutingCache();
      console.log("");
      console.log(kleur.green("✓ ") + `mode=${mode} written to ~/.vzt-video-intel/config.json`);
    }
  });

program
  .command("config [action] [keyValue]")
  .description("Show or edit persisted config. `vintel config` (show), `vintel config set mode=cloud`")
  .action(async (action: string | undefined, keyValue: string | undefined) => {
    if (!action || action === "show") {
      const cfg = readConfig();
      const redacted = { ...cfg, replicateToken: cfg.replicateToken ? "***" + cfg.replicateToken.slice(-4) : undefined };
      console.log(JSON.stringify(redacted, null, 2));
      return;
    }
    if (action === "set" && keyValue) {
      const [key, ...rest] = keyValue.split("=");
      const value = rest.join("=");
      if (!key || value === undefined) {
        console.error("usage: vintel config set <key>=<value>");
        process.exit(1);
      }
      const allowedKeys = ["mode", "cloudProvider", "replicateToken", "muxBase"];
      if (!allowedKeys.includes(key)) {
        console.error(`unknown key: ${key}. allowed: ${allowedKeys.join(", ")}`);
        process.exit(1);
      }
      writeConfig({ [key]: value });
      invalidateRoutingCache();
      console.log(kleur.green("✓ ") + `${key} updated`);
      return;
    }
    console.error("usage: vintel config | vintel config set <key>=<value>");
    process.exit(1);
  });

program
  .command("login [token]")
  .description("Store a Replicate API token to ~/.vzt-video-intel/config.json")
  .action(async (tokenArg: string | undefined) => {
    let token = tokenArg;
    if (!token) {
      token = await prompt("Paste your Replicate API token: ");
    }
    if (!token) {
      console.error(kleur.red("✖ ") + "no token provided");
      process.exit(1);
    }
    writeConfig({ replicateToken: token, mode: readConfig().mode ?? "cloud" });
    invalidateRoutingCache();
    console.log(kleur.green("✓ ") + "Token saved. Mode set to cloud (if it wasn't already).");
    console.log(kleur.gray("   Get a token at https://replicate.com/account/api-tokens"));
  });

program
  .command("up")
  .description("Boot the docker-compose stack with all 6 backends")
  .option("--profile <profile>", "compose profile: cpu | gpu", "gpu")
  .option("--detach", "run detached (background)", true)
  .action((opts) => {
    if (!existsSync(join(DOCKER_DIR, "docker-compose.yml"))) {
      console.error(kleur.red("✖ docker/docker-compose.yml not found at ") + DOCKER_DIR);
      process.exit(1);
    }
    const args = ["compose", "-f", join(DOCKER_DIR, "docker-compose.yml"), "--profile", opts.profile, "up"];
    if (opts.detach !== false) args.push("-d");
    console.log(kleur.cyan("→ ") + "docker " + args.join(" "));
    const child = spawn("docker", args, { stdio: "inherit", env: process.env });
    child.on("exit", (code) => process.exit(code ?? 0));
  });

program
  .command("down")
  .description("Stop the docker-compose stack")
  .action(() => {
    const args = ["compose", "-f", join(DOCKER_DIR, "docker-compose.yml"), "down"];
    const child = spawn("docker", args, { stdio: "inherit", env: process.env });
    child.on("exit", (code) => process.exit(code ?? 0));
  });

program
  .command("init")
  .description("First-run setup wizard — creates .env, prints next steps")
  .option("--mcp-config", "also write a Claude Code MCP config snippet to stdout")
  .action((opts) => {
    const envExample = join(DOCKER_DIR, ".env.example");
    const envTarget = join(DOCKER_DIR, ".env");
    if (existsSync(envExample) && !existsSync(envTarget)) {
      copyFileSync(envExample, envTarget);
      console.log(kleur.green("✓ ") + "Wrote " + kleur.cyan(envTarget));
    } else if (existsSync(envTarget)) {
      console.log(kleur.gray("- .env already exists, leaving untouched"));
    }

    // Per-user MCP server config — handy for Claude Code users
    const claudeDir = process.env.HOME ? join(process.env.HOME, ".claude") : null;
    if (claudeDir && existsSync(claudeDir)) {
      mkdirSync(join(claudeDir, "mcp"), { recursive: true });
    }

    console.log("");
    console.log(kleur.bold("Next steps:"));
    console.log("  1. " + kleur.cyan("vzt-video-intel up") + "        boot the 6 backends (Docker required)");
    console.log("  2. " + kleur.cyan("vzt-video-intel doctor") + "    verify everything is healthy");
    console.log("  3. " + kleur.cyan("vzt-video-intel analyze ./your-video.mp4") + "  run the pipeline");
    console.log("");
    if (opts.mcpConfig) {
      console.log(kleur.bold("Claude Code MCP config (add to ~/.claude.json or .mcp.json):"));
      console.log(JSON.stringify({
        mcpServers: {
          "vzt-video-intel": {
            command: "npx",
            args: ["vzt-video-intel", "mcp"],
          },
        },
      }, null, 2));
    }
  });

program
  .command("mcp")
  .description("Run as an MCP stdio server (for Claude Code, Cursor, OpenCode)")
  .action(async () => {
    try {
      await startMcpServer();
    } catch (err) {
      console.error("MCP server failed:", err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
