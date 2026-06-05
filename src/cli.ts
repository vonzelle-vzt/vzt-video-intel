#!/usr/bin/env node
// VZT Video-Intel — CLI entry point.
//
// Subcommands:
//   analyze       Run the full pipeline on a video, print the scene graph as JSON
//   observe       Watch + listen — fuse all senses into one perception timeline
//   transcribe    Whisper transcription
//   scenes        Scene boundary detection (ffmpeg-static)
//   entities      Entity tracking (cloud SAM2 — needs Replicate token)
//   keyframes     Per-scene keyframe extraction (ffmpeg-static)
//   ocr           On-screen text extraction (tesseract.js or cloud)
//   search        Cross-video corpus search (1 arg) OR single-video CLIP search (2 args)
//   index         Build a cross-video corpus from a directory of videos
//   eval          Score the pipeline against gold fixtures (WER / F1 / OCR recall)
//   chapters      Chapter generation (cloud Qwen2.5-VL — needs Replicate token)
//   auto          Detect environment + pick best mode (cloud / lite)
//   config        Show or set persisted configuration
//   cache         Inspect / clear the persistent scene-graph store
//   login         Store cloud API token
//   install       Wire the MCP server into an AI editor (Claude/Cursor/Codex/Copilot/Antigravity)
//   mcp           Run as an MCP stdio server (Claude Code/Desktop, Cursor, Codex, Copilot, Antigravity, OpenCode)

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kleur from "kleur";

import { analyzeVideo } from "./pipeline/orchestrator.js";
import { observeVideo, renderPerceptionText } from "./pipeline/observe.js";
import { indexCorpus, searchCorpus } from "./pipeline/corpus.js";
import { runEval } from "./eval/run.js";
import { transcribe } from "./backends/whisperx.js";
import { detectScenes, extractKeyframes } from "./backends/scene-detect.js";
import { trackEntities } from "./backends/sam2.js";
import { ocrOverlay } from "./backends/easyocr.js";
import { semanticSearch } from "./backends/clip.js";
import { generateChapters } from "./backends/qwen-vl.js";
import { startMcpServer } from "./index.js";
import { installEditor, normalizeEditor, EDITORS } from "./install.js";
import { detect, resolveMode } from "./runtime/auto.js";
import { readConfig, writeConfig, isFirstRun, markFirstRunComplete } from "./runtime/cache.js";
import { invalidateRoutingCache } from "./runtime/mode.js";
import { listGraphs, clearGraphs, graphCacheDir } from "./runtime/graph-cache.js";
import type { Mode } from "./lib/env.js";

const program = new Command();
program
  .name("vzt-video-intel")
  .description("VZT Video-Intel — temporal scene-graph CLI + MCP server. Gives Claude video understanding.")
  .version("1.6.0");

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function renderEvalScorecard(result: import("./eval/run.js").EvalResult): void {
  if (result.fixtures.length === 0) {
    console.log(kleur.gray(`no gold fixtures found in ${result.fixturesDir}`));
    console.log(kleur.gray("   add a <name>.gold.json (see docs/EVAL.md), or pass a directory: vintel eval <dir>"));
    return;
  }
  console.log(kleur.bold(`Eval — ${result.fixtures.length} fixture(s) in ${result.fixturesDir}`));
  for (const fx of result.fixtures) {
    console.log("");
    console.log(kleur.cyan(fx.source));
    if (fx.error) {
      console.log("   " + kleur.red("✖ analyze failed: ") + fx.error);
      continue;
    }
    for (const s of fx.scores) {
      const mark = s.pass ? kleur.green("✓") : kleur.red("✖");
      const value = s.metric === "delta_ms" ? `${s.value}ms` : s.value.toFixed(3);
      console.log(`   ${mark} ${s.dimension.padEnd(9)} ${s.metric} = ${value}  ${kleur.gray(s.detail)}`);
    }
  }
  console.log("");
  console.log(result.passed ? kleur.green("✓ all gated dimensions passed") : kleur.red("✖ one or more dimensions regressed"));
}

// The single-entry block for VS Code's user-level "servers" object (copilot --global).
function buildCopilotEntry(token?: string): string {
  const entry: Record<string, unknown> = { type: "stdio", command: "npx", args: ["vzt-video-intel", "mcp"] };
  if (token) entry.env = { REPLICATE_API_TOKEN: token };
  return JSON.stringify({ "vzt-video-intel": entry }, null, 2);
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
  console.log(`   ${det.hasFfmpeg ? kleur.green("✓") : kleur.red("✗")} ffmpeg`);
  console.log(`   ${det.hasCloudKey ? kleur.green("✓") : kleur.red("✗")} REPLICATE_API_TOKEN`);
  console.log("");
  console.log(kleur.bold("🤔 Pick a mode:"));
  console.log("   " + kleur.cyan("[1] cloud") + "  Use Replicate for heavy backends.  ~$0.06/min");
  console.log("   " + kleur.cyan("[2] lite") + "   Pure-Node WASM where possible.  Free + offline.");
  console.log("");
  console.log(kleur.gray("   Recommended: " + det.recommendedMode + " — " + det.recommendedReason));
  console.log("");
  const choice = (await prompt("> ")).toLowerCase();
  let mode: Mode;
  if (choice === "1" || choice === "cloud") mode = "cloud";
  else if (choice === "2" || choice === "lite") mode = "lite";
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
  .option("--refresh", "ignore any cached scene graph and re-run the full pipeline")
  .option("--no-cache", "skip the persistent graph cache (don't read or write)")
  .option("--stream", "emit each track as JSONL the moment it's produced (one JSON object per line)")
  .action(async (source: string, opts) => {
    await runFirstRunWizardIfNeeded();
    await tryOrHelp(async () => {
      const streaming = !!opts.stream;
      const result = await analyzeVideo({
        source,
        includeKeyframes: opts.keyframes !== false,
        trackEntities: opts.entities !== false,
        recognizeActions: opts.actions !== false,
        includeMuxUrls: !!opts.muxUrls,
        language: opts.language,
        maxScenes: opts.maxScenes,
        refresh: !!opts.refresh,
        noCache: opts.cache === false,
        onCacheHit: () => console.error(kleur.gray("(from cache — use --refresh to re-run)")),
        // In stream mode, write one JSON object per line as each track lands.
        onEvent: streaming ? (e) => process.stdout.write(JSON.stringify(e) + "\n") : undefined,
      });
      // Streaming already wrote everything incrementally; don't re-dump the graph.
      if (!streaming) print(result);
    });
  });

program
  .command("observe <source>")
  .description("Watch AND listen — fuse transcript, visual captions, on-screen text + scenes into one timeline")
  .option("-l, --language <iso>", "language hint (e.g. en, es)")
  .option("--max-scenes <n>", "cap scenes analyzed", (v) => parseInt(v, 10))
  .option("--no-scene-markers", "omit scene-boundary events from the track")
  .option("-f, --format <fmt>", "output format: json | text", "json")
  .option("--refresh", "ignore any cached scene graph and re-run the full pipeline")
  .option("--no-cache", "skip the persistent graph cache (don't read or write)")
  .action(async (source: string, opts) => {
    await runFirstRunWizardIfNeeded();
    await tryOrHelp(async () => {
      const result = await observeVideo({
        source,
        language: opts.language,
        maxScenes: opts.maxScenes,
        sceneMarkers: opts.sceneMarkers !== false,
        refresh: !!opts.refresh,
        noCache: opts.cache === false,
        onCacheHit: () => console.error(kleur.gray("(from cache — use --refresh to re-run)")),
      });
      if (opts.format === "text") {
        process.stdout.write(renderPerceptionText(result) + "\n");
      } else {
        print(result);
      }
    });
  });

program
  .command("transcribe <source>")
  .description("Whisper transcription")
  .option("-l, --language <iso>", "language hint")
  .option("--no-diarize", "disable diarization (cloud only — lite has no diarization yet)")
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await transcribe({ source, language: opts.language, diarize: opts.diarize !== false })));
  });

program
  .command("scenes <source>")
  .description("Detect scene boundaries via ffmpeg")
  .option("-t, --threshold <n>", "content threshold (lower = more sensitive)", (v) => parseFloat(v))
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await detectScenes({ source, threshold: opts.threshold })));
  });

program
  .command("entities <source>")
  .description("Segment + track entities (cloud SAM2; requires Replicate token)")
  .option("--prompt <text>", "filter entity classes via text prompt (e.g. 'football players')")
  .option("--start-ms <n>", "scene start", (v) => parseInt(v, 10))
  .option("--end-ms <n>", "scene end", (v) => parseInt(v, 10))
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await trackEntities({ source, promptText: opts.prompt, sceneStartMs: opts.startMs, sceneEndMs: opts.endMs })));
  });

program
  .command("keyframes <source>")
  .description("Extract per-scene keyframes as base64 JPEGs (ffmpeg)")
  .option("--interval-ms <n>", "cadence when not per-scene", (v) => parseInt(v, 10))
  .option("--per-scene", "one per detected scene (default)", true)
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await extractKeyframes({ source, perScene: opts.perScene !== false, intervalMs: opts.intervalMs })));
  });

program
  .command("ocr <source>")
  .description("Read on-screen text (Tesseract.js in lite, cloud OCR otherwise)")
  .option("--lang <iso...>", "OCR languages", ["en"])
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await ocrOverlay({ source, languages: opts.lang })));
  });

program
  .command("search <queryOrSource> [query]")
  .description(
    "Search moments. Two forms:\n" +
      "                       vintel search \"<query>\"            cross-video search over the whole indexed corpus\n" +
      "                       vintel search <source> \"<query>\"   CLIP moment search within one video",
  )
  .option("-k, --top-k <n>", "top results", (v) => parseInt(v, 10), 10)
  .option("--min-score <n>", "minimum similarity (single-video CLIP only)", (v) => parseFloat(v), 0.2)
  .option("--kind <kinds>", "(corpus) restrict to track kinds, comma-separated: hear,read,see,entity,chapter")
  .option("--from <sources>", "(corpus) restrict to sources matching these substrings, comma-separated")
  .action(async (queryOrSource: string, query: string | undefined, opts) => {
    await tryOrHelp(async () => {
      // Two args → single-video CLIP search (unchanged). One arg → corpus search.
      if (query !== undefined) {
        print(await semanticSearch({ source: queryOrSource, query, topK: opts.topK, minScore: opts.minScore }));
        return;
      }
      const kinds = opts.kind
        ? (opts.kind.split(",").map((k: string) => k.trim()).filter(Boolean) as ("hear" | "read" | "see" | "entity" | "chapter")[])
        : undefined;
      const sources = opts.from ? opts.from.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined;
      const result = searchCorpus(queryOrSource, { topK: opts.topK, kinds, sources });
      if (result.videos === 0) {
        console.error(kleur.yellow("no indexed videos yet — run `vintel index <dir>` first"));
      }
      print(result);
    });
  });

program
  .command("index <dir>")
  .description("Build a cross-video corpus: analyze every video under <dir> (instant for ones already cached)")
  .option("--no-recursive", "don't descend into subdirectories")
  .option("--entities", "also run entity tracking (cloud SAM2; slower)")
  .option("--no-actions", "skip action/caption recognition (smaller index, less to search)")
  .option("-l, --language <iso>", "language hint for transcription")
  .action(async (dir: string, opts) => {
    await runFirstRunWizardIfNeeded();
    await tryOrHelp(async () => {
      const result = await indexCorpus(dir, {
        recursive: opts.recursive !== false,
        trackEntities: !!opts.entities,
        recognizeActions: opts.actions !== false,
        language: opts.language,
        onVideo: ({ source, status, index, total }) => {
          const mark = status === "failed" ? kleur.red("✖") : status === "cached" ? kleur.gray("•") : kleur.green("✓");
          console.error(`   ${mark} [${index}/${total}] ${status.padEnd(8)} ${source}`);
        },
      });
      const secs = Math.round(result.totalDurationMs / 1000);
      console.error("");
      console.error(
        kleur.bold(`indexed ${result.total} video(s) `) +
          kleur.gray(`(${result.analyzed} analyzed, ${result.fromCache} cached, ${result.failed} failed · ${secs}s total)`),
      );
      console.error(kleur.gray('   query it: vintel search "<what you\'re looking for>"'));
      print(result);
    });
  });

program
  .command("eval [fixturesDir]")
  .description("Score the pipeline against gold fixtures (transcription WER, scene-boundary F1, OCR recall, duration)")
  .option("--ci", "exit non-zero if any gold-gated dimension regresses")
  .option("--json", "print the raw result as JSON instead of a scorecard")
  .action(async (fixturesDir: string | undefined, opts) => {
    const dir = fixturesDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "eval");
    await tryOrHelp(async () => {
      const result = await runEval(dir);
      if (opts.json) {
        print(result);
      } else {
        renderEvalScorecard(result);
      }
      if (opts.ci && !result.passed) process.exit(1);
    });
  });

program
  .command("chapters <source>")
  .description("Generate chapters (cloud Qwen2.5-VL; requires Replicate token)")
  .option("-n, --count <n>", "target chapter count", (v) => parseInt(v, 10), 8)
  .option("-s, --style <style>", "youtube | course | highlights | meeting", "youtube")
  .action(async (source: string, opts) => {
    await tryOrHelp(async () => print(await generateChapters({ source, targetChapterCount: opts.count, style: opts.style })));
  });

program
  .command("auto")
  .description("Detect environment, recommend the best mode, optionally persist it")
  .option("--apply", "save the recommended mode to ~/.vzt-video-intel/config.json")
  .action(async (opts) => {
    const { mode, detection, routing } = await resolveMode();
    console.log(kleur.bold("Environment:"));
    console.log(`   ${detection.hasFfmpeg ? kleur.green("✓") : kleur.red("✗")} ffmpeg`);
    console.log(`   ${detection.hasCloudKey ? kleur.green("✓") : kleur.red("✗")} REPLICATE_API_TOKEN`);
    console.log("");
    console.log(kleur.bold("Resolved mode: ") + kleur.cyan(mode));
    console.log(kleur.gray("   " + detection.recommendedReason));
    console.log("");
    console.log(kleur.bold("Per-stage routing:"));
    for (const [stage, route] of Object.entries(routing)) {
      const color = route === "cloud" ? kleur.cyan : route === "lite" ? kleur.green : kleur.gray;
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
  .command("cache [action]")
  .description("Inspect the persistent scene-graph store. `vintel cache` (list), `vintel cache clear`, `vintel cache path`")
  .action(async (action: string | undefined) => {
    if (action === "clear") {
      const n = clearGraphs();
      console.log(kleur.green("✓ ") + `cleared ${n} cached scene graph${n === 1 ? "" : "s"}`);
      return;
    }
    if (action === "path") {
      console.log(graphCacheDir());
      return;
    }
    if (!action || action === "list") {
      const graphs = listGraphs();
      if (graphs.length === 0) {
        console.log(kleur.gray("no cached scene graphs yet — run `vintel analyze <source>`"));
        return;
      }
      console.log(
        kleur.bold(`${graphs.length} cached scene graph${graphs.length === 1 ? "" : "s"} `) +
          kleur.gray(`(${graphCacheDir()})`),
      );
      for (const g of graphs) {
        const kb = (g.sizeBytes / 1024).toFixed(0);
        console.log(`   ${kleur.cyan(g.key)}  ${g.source}`);
        console.log(`   ${kleur.gray(`v${g.version} · ${g.generatedAt} · ${kb} KB`)}`);
      }
      return;
    }
    console.error("usage: vintel cache | vintel cache clear | vintel cache path");
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
  .command("install <editor>")
  .description(
    "Wire the MCP server into an AI editor: claude | claude-desktop | cursor | codex | antigravity | copilot | all",
  )
  .option("--token <token>", "embed a Replicate API token in the editor config (optional — see note)")
  .option("--print", "print the config snippet instead of writing any file")
  .option("--global", "(copilot) print the VS Code user-config instructions instead of writing .vscode/mcp.json")
  .action(async (editor: string, opts) => {
    const raw = editor.toLowerCase();

    if (raw === "copilot" && opts.global && !opts.print) {
      console.log(kleur.bold("GitHub Copilot — global (user) install:"));
      console.log("  1. VS Code → Command Palette (Ctrl/Cmd+Shift+P)");
      console.log("  2. Run " + kleur.cyan('"MCP: Open User Configuration"'));
      console.log("  3. Paste this into the " + kleur.cyan('"servers"') + " object:");
      console.log("");
      console.log(buildCopilotEntry(opts.token));
      return;
    }

    const targets = raw === "all" ? EDITORS : [normalizeEditor(raw)];
    if (targets.some((t) => t === null)) {
      console.error(kleur.red("✖ ") + `unknown editor: ${editor}`);
      console.error("   supported: " + EDITORS.join(", ") + ", all");
      process.exit(1);
    }

    for (const ed of targets) {
      const r = installEditor(ed!, { token: opts.token, print: !!opts.print });
      if (opts.print) {
        console.log(kleur.bold(`# ${r.editor} → ${r.file}`));
        console.log(r.snippet);
      } else {
        const verb = r.alreadyPresent ? "updated" : "added";
        console.log(kleur.green("✓ ") + `${verb} ${kleur.cyan("vzt-video-intel")} in ${r.file}`);
        console.log(kleur.gray("   next: " + r.invoke));
      }
    }

    if (!opts.print && !opts.token) {
      console.log("");
      console.log(
        kleur.gray(
          "tip: run `vintel login` once — the MCP server reads your Replicate token from\n" +
            "     ~/.vzt-video-intel/config.json, so every editor inherits cloud mode with no\n" +
            "     per-editor token. Pass --token only if you prefer an explicit env var.",
        ),
      );
    }
  });

program
  .command("mcp")
  .description("Run as an MCP stdio server (Claude Code/Desktop, Cursor, Codex, Copilot, Antigravity, OpenCode)")
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
