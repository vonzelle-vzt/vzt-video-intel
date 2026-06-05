# Integrations

How to wire VZT Video-Intel into the AI tools you already use.

## Fastest path — `vintel install`

One command merges the MCP server into your editor's config (right file, right
format, preserving any servers already there):

```bash
npx vzt-video-intel install claude          # Claude Code  → ~/.claude.json
npx vzt-video-intel install claude-desktop  # Claude Desktop
npx vzt-video-intel install cursor          # Cursor       → ~/.cursor/mcp.json
npx vzt-video-intel install codex           # Codex        → ~/.codex/config.toml
npx vzt-video-intel install antigravity     # Antigravity
npx vzt-video-intel install copilot         # VS Code Copilot → .vscode/mcp.json
npx vzt-video-intel install all             # all of the above

npx vzt-video-intel install copilot --global   # VS Code user-level instructions
npx vzt-video-intel install claude --print     # show the snippet, write nothing
```

Run `vintel login` once and every editor inherits cloud mode from
`~/.vzt-video-intel/config.json` — no per-editor token (or pass `--token <r8_…>`
to embed one explicitly). The manual recipes below are the same thing by hand.

## Claude Code (MCP)

### Option 1 — `~/.claude.json` (global)

```json
{
  "mcpServers": {
    "vzt-video-intel": {
      "command": "npx",
      "args": ["vzt-video-intel", "mcp"],
      "env": {
        "REPLICATE_API_TOKEN": "r8_..."
      }
    }
  }
}
```

Set `REPLICATE_API_TOKEN` to enable cloud-mode adapters for heavy stages. Omit it to run in lite mode (free, offline, skips entities + actions).

### Option 2 — project-local `.mcp.json`

```json
{
  "mcpServers": {
    "vzt-video-intel": {
      "type": "stdio",
      "command": "npx",
      "args": ["vzt-video-intel", "mcp"]
    }
  }
}
```

Then in Claude Code:
> *"Analyze ./game.mp4 and tell me what happens at the 2-minute mark."*

Claude calls `analyze_video`, gets the scene graph, cites timestamps.

## Cursor

Add to `.cursor/rules/vzt-video-intel.mdc`:

```yaml
---
description: VZT Video-Intel temporal scene-graph MCP server
globs:
  - "**/*.mp4"
  - "**/*.mov"
keywords:
  - video analysis
  - scene graph
---

When the user asks about video content, invoke the vzt-video-intel MCP server
via `npx vzt-video-intel mcp`. The server exposes `analyze_video`,
`observe_video`, `index_corpus`, `search_corpus`, `extract_transcript`,
`semantic_search`, and 5 more tools.

Always cite timestamps by `start_ms`/`end_ms` from the returned scene graph.
```

## OpenCode

`.opencode/skill/video-intel/SKILL.md`:

```yaml
---
name: video-intel
description: "Temporal scene-graph extraction for videos"
version: "1.6.0"
triggers:
  - video
  - clip
  - footage
  - transcribe
---

# Video Intel skill

Run `npx vzt-video-intel mcp` to expose 11 tools for video analysis — including
`index_corpus` / `search_corpus` for searching across a whole library of clips.
See https://github.com/vonzelle-vzt/vzt-video-intel for full schema.
```

## Factory Droid

`.factory/droids/video-intel.md`:

```yaml
---
name: video-intel
description: "Video analysis via VZT Video-Intel MCP server"
model: inherit
tools: ["mcp__vzt-video-intel__*"]
---

When a video file path or URL appears in your task, call analyze_video
and reason over the returned scene graph. Cite specific moments by timestamp.
```

## Programmatic (Node)

```ts
import { analyzeVideo } from "vzt-video-intel/pipeline/orchestrator";
import { semanticSearch } from "vzt-video-intel/backends/clip";

// Mode is resolved automatically from ~/.vzt-video-intel/config.json or
// from the VZT_MODE env var. Set VZT_MODE=cloud + REPLICATE_API_TOKEN to
// force cloud mode regardless of persisted config.

const graph = await analyzeVideo({ source: "./game.mp4", trackEntities: true });
const goals = await semanticSearch({ source: "./game.mp4", query: "ball crossing goal line", topK: 20 });
```

## NextPlay (sports film analysis)

```ts
import { analyzeVideo } from "vzt-video-intel/pipeline/orchestrator";
import { semanticSearch } from "vzt-video-intel/backends/clip";

const graph = await analyzeVideo({ source: gameFilm.muxUrl, trackEntities: true });
const goals = await semanticSearch({ source: gameFilm.muxUrl, query: "ball crossing goal line", topK: 20 });

const highlights = goals.hits.map((hit) => {
  const scene = graph.scenes.find((s) => hit.t_ms >= s.start_ms && hit.t_ms <= s.end_ms);
  return { ...hit, scene_id: scene?.id, duration_ms: scene ? scene.end_ms - scene.start_ms : 5000 };
});
```

## MTM Thesis Agent (chart videos)

```ts
import { generateChapters } from "vzt-video-intel/backends/qwen-vl";

// Requires cloud mode (Qwen2.5-VL doesn't run on CPU WASM)
const chapters = await generateChapters({
  source: thesisVideo.mp4Url,
  targetChapterCount: 10,
  style: "course",
});
```

## TX3 / call recordings

```bash
# Lite mode: free, offline transcription
vintel transcribe ./call.m4a | \
  jq '.segments[] | "\(.start_ms): \(.text)"' \
  > transcript.txt
```
