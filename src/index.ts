#!/usr/bin/env node
// VZT Video-Intel — MCP server entry point.
//
// Boots the stdio MCP server with 9 tools backed by the orchestrator and
// per-backend clients. Designed to be called via the CLI (`vzt-video-intel mcp`)
// or directly by an MCP host (Claude Code, Cursor, OpenCode).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { analyzeVideo } from "./pipeline/orchestrator.js";
import { observeVideo } from "./pipeline/observe.js";
import { transcribe } from "./backends/whisperx.js";
import { detectScenes, extractKeyframes } from "./backends/scene-detect.js";
import { trackEntities } from "./backends/sam2.js";
import { ocrOverlay } from "./backends/easyocr.js";
import { semanticSearch } from "./backends/clip.js";
import { generateChapters } from "./backends/qwen-vl.js";

function wrap<T>(fn: (params: T) => Promise<unknown> | unknown) {
  return async (params: T) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await fn(params), null, 2) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hint = message.includes("REPLICATE_API_TOKEN")
        ? " — run `vintel login` to add a token, or `vintel config set mode=lite` for free offline mode."
        : "";
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message + hint }) }],
        isError: true,
      };
    }
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "vzt-video-intel", version: "1.3.0" });

  server.tool(
    "analyze_video",
    "Run the full Video-Intel pipeline. Returns a structured scene graph: scenes, transcript, entities, actions, OCR, keyframes — every element timestamped (start_ms/end_ms). Optional Mux URLs for moment citation.",
    {
      source: z.string().describe("Video file path or URL (mp4, mov, webm, m3u8)"),
      includeKeyframes: z.boolean().default(true),
      includeMuxUrls: z.boolean().default(false),
      language: z.string().optional().describe("ISO 639-1 hint"),
      maxScenes: z.number().int().positive().default(200),
      trackEntities: z.boolean().default(true),
      recognizeActions: z.boolean().default(true),
    },
    wrap(analyzeVideo),
  );

  server.tool(
    "observe_video",
    "Watch AND listen: returns a single time-sorted perception track fusing spoken audio (hear), visual scene captions (see), on-screen text (read), and scene cuts (scene). Each event is timestamped (t_ms/end_ms). This is the closest thing to a human description of the video — use it when you want to know what happens, not just raw tracks.",
    {
      source: z.string().describe("Video file path or URL (mp4, mov, webm, m3u8)"),
      language: z.string().optional().describe("ISO 639-1 hint"),
      maxScenes: z.number().int().positive().default(200),
      sceneMarkers: z.boolean().default(true).describe("Include scene-boundary events in the track"),
    },
    wrap(observeVideo),
  );

  server.tool(
    "extract_transcript",
    "Transcribe a video/audio with speaker diarization (WhisperX + Pyannote). Segments include start_ms/end_ms, speaker, confidence.",
    {
      source: z.string(),
      language: z.string().optional(),
      diarize: z.boolean().default(true),
      minSpeakers: z.number().int().min(1).optional(),
      maxSpeakers: z.number().int().max(20).optional(),
    },
    wrap(transcribe),
  );

  server.tool(
    "detect_scenes",
    "Detect scene boundaries (PySceneDetect content-aware). Returns scenes with start_ms/end_ms.",
    {
      source: z.string(),
      threshold: z.number().positive().default(27),
      minSceneLengthMs: z.number().int().positive().default(1000),
    },
    wrap(detectScenes),
  );

  server.tool(
    "track_entities",
    "Segment and track entities (SAM2). Each entity has a stable tracking_id across the clip.",
    {
      source: z.string(),
      sceneStartMs: z.number().int().nonnegative().optional(),
      sceneEndMs: z.number().int().positive().optional(),
      promptText: z.string().optional(),
      sampleEveryMs: z.number().int().positive().default(500),
    },
    wrap(trackEntities),
  );

  server.tool(
    "extract_keyframes",
    "Extract representative keyframes per scene or at a fixed cadence. Returns base64 JPEGs + timestamps.",
    {
      source: z.string(),
      perScene: z.boolean().default(true),
      intervalMs: z.number().int().positive().default(2000),
      quality: z.number().int().min(1).max(100).default(85),
    },
    wrap(extractKeyframes),
  );

  server.tool(
    "ocr_overlay",
    "Read on-screen text overlays (captions, scoreboards, banners) via EasyOCR. Returns text regions with bbox + timestamps.",
    {
      source: z.string(),
      languages: z.array(z.string()).default(["en"]),
      sampleEveryMs: z.number().int().positive().default(1000),
    },
    wrap(ocrOverlay),
  );

  server.tool(
    "semantic_search",
    "Find moments by natural-language description across a video (CLIP). E.g. 'goal scored', 'whiteboard with diagram'.",
    {
      source: z.string(),
      query: z.string(),
      topK: z.number().int().positive().max(50).default(10),
      minScore: z.number().min(0).max(1).default(0.2),
    },
    wrap(semanticSearch),
  );

  server.tool(
    "generate_chapters",
    "Generate human-friendly chapters from transcript + scenes (Qwen2.5-VL). Styles: youtube, course, highlights, meeting.",
    {
      source: z.string(),
      targetChapterCount: z.number().int().positive().default(8),
      style: z.enum(["youtube", "course", "highlights", "meeting"]).default("youtube"),
    },
    wrap(generateChapters),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Allow `node dist/index.js` to boot the MCP server directly
const isDirect = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("index.js");
if (isDirect) {
  startMcpServer().catch((err) => {
    console.error("vzt-video-intel MCP server failed:", err);
    process.exit(1);
  });
}
