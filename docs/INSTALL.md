# Install

Two modes, one CLI. Pick whichever matches your machine + budget.

## TL;DR

```
npm install -g vzt-video-intel
vintel analyze <video>
```

The first run asks you to pick a mode and persists your choice to `~/.vzt-video-intel/config.json`.

## Lite mode (free, offline)

Everything runs in Node — Whisper-tiny via WASM, ffmpeg-static for scene detection + keyframes, Tesseract.js for OCR, CLIP via ONNX. The first run downloads ~150 MB of model weights to `~/.cache/`.

```bash
npm install -g vzt-video-intel
vintel analyze ./demo.mp4   # first run prompts you to pick a mode; pick lite
```

Heavy backends (Qwen-VL action recognition, SAM2 entity tracking) skip gracefully. You still get transcript, scenes, OCR, semantic search, and keyframes.

Cost: zero. Speed: ~3–5× real-time on a modern laptop CPU.

## Cloud mode (full pipeline)

Zero local compute for the heavy stages. Heavy backends run on Replicate.

```bash
npm install -g vzt-video-intel
vintel login                # paste your Replicate token
vintel analyze https://example.com/clip.mp4
```

Get a Replicate API token at https://replicate.com/account/api-tokens. Free tier covers occasional dev work; pay-per-second for production.

Cost: ~$0.06/min of video for the full pipeline (Qwen2.5-VL + SAM2 dominate).

## Hybrid auto

`vintel auto` inspects the machine and picks the best per-stage routing. For example: ffmpeg scenes + Tesseract OCR locally + Replicate Qwen-VL for actions + lite Whisper for transcript.

```bash
vintel auto                 # print recommendation
vintel auto --apply         # persist it
```

The orchestrator dispatches per-stage at runtime based on the persisted config — you can run in mixed mode without setting env vars.

## Connect to an AI assistant (MCP)

Connecting the MCP server lets you *ask* an assistant about a video instead of running CLI commands — it calls the tools and answers with real timestamps. Supported: **Claude Code, Claude Desktop, Cursor, Codex, GitHub Copilot, Antigravity**.

### One command per app

```bash
vintel install claude          # Claude Code      → ~/.claude.json
vintel install claude-desktop  # Claude Desktop   → per-OS app config (see paths below)
vintel install cursor          # Cursor           → ~/.cursor/mcp.json
vintel install codex           # Codex            → ~/.codex/config.toml
vintel install antigravity     # Antigravity      → ~/.gemini/config/mcp_config.json
vintel install copilot         # VS Code Copilot  → .vscode/mcp.json (current project)
vintel install all             # all of the above except project-local copilot
```

Flags:
- `--print` — show the config snippet without writing anything (also the way to set up editors we don't write directly, e.g. OpenCode).
- `--global` — (copilot only) print the VS Code **user-level** setup steps instead of a project file.
- `--token r8_…` — embed an explicit Replicate token in that app's config. **Usually unnecessary** — see token handling below.

`install` is idempotent and **non-destructive**: it merges the `vzt-video-intel` entry into the existing config, keeping any other MCP servers you already have. Re-running it just refreshes the one entry.

### Claude Desktop config paths

| OS | File |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

### Activate it

| App | Action |
|---|---|
| Claude Code | reloads automatically |
| **Claude Desktop** | **fully quit (system-tray → Quit) and reopen** — closing the window won't reload config |
| Cursor | open Settings → MCP (server should show green) |
| Codex | run `codex`, then `/mcp` to confirm |
| Antigravity | auto-reloads; open an Agent session |

Then ask, e.g.: *"Analyze ./game.mp4 and tell me what happens at 0:30"* or *"Index ./clips and find every mention of pricing."*

### Windows launch form (handled automatically)

Windows GUI apps spawn the server without a shell, and `npx` is a `.cmd` shim — spawning it directly is the most common "MCP server won't start on Windows" failure. So on Windows, `vintel install` automatically writes the safe form:

```json
{ "command": "cmd", "args": ["/c", "vzt-video-intel", "mcp"] }
```

On macOS/Linux it writes `{ "command": "npx", "args": ["vzt-video-intel", "mcp"] }`. You don't choose — `install` picks the right one for your OS.

### Token handling (important)

By default **no token is written into any editor config.** The MCP server reads your Replicate token from `~/.vzt-video-intel/config.json`, so:

```bash
vintel login   # once — paste your Replicate token
```

…and **every** connected app inherits cloud mode, with the secret kept in one place, out of all the editor config files. Without a token, the assistant runs in free **lite mode**. Only pass `--token` if you specifically want an explicit env var in one app's config.

### Manual setup

Prefer to wire it by hand? Add the snippet below to `~/.claude.json` (or the app's config). On **Windows**, use `"command": "cmd", "args": ["/c", "vzt-video-intel", "mcp"]` instead.

```json
{
  "mcpServers": {
    "vzt-video-intel": {
      "command": "npx",
      "args": ["vzt-video-intel", "mcp"]
    }
  }
}
```

The MCP server respects the same persisted mode as the CLI — so the assistant gets whatever execution path (lite / cloud / hybrid) you configured.

See [INTEGRATIONS.md](INTEGRATIONS.md) for per-app config formats and copy-paste recipes.
