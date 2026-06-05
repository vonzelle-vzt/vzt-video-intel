// `vintel install <editor>` — wire the MCP server into an AI editor's config.
//
// Each editor reads MCP servers from a different file, in a different format,
// under a different root key. This module hides those differences: it merges a
// single `vzt-video-intel` stdio entry into the target config, creating the
// file + parent dirs if absent and preserving any servers already there.
//
// Idempotent — re-running writes the same entry (and reports it was already
// present). `--print` returns the snippet without touching disk, which is also
// the escape hatch for editors we don't write directly (OpenCode, Factory Droid).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const SERVER_KEY = "vzt-video-intel";

export type Editor =
  | "claude"
  | "claude-desktop"
  | "cursor"
  | "codex"
  | "antigravity"
  | "copilot";

export const EDITORS: Editor[] = [
  "claude",
  "claude-desktop",
  "cursor",
  "codex",
  "antigravity",
  "copilot",
];

const ALIASES: Record<string, Editor> = {
  "claude-code": "claude",
  claudecode: "claude",
  "claude_desktop": "claude-desktop",
  claudedesktop: "claude-desktop",
  "github-copilot": "copilot",
  "vscode": "copilot",
};

export function normalizeEditor(input: string): Editor | null {
  const v = ALIASES[input] ?? input;
  return (EDITORS as string[]).includes(v) ? (v as Editor) : null;
}

export interface InstallOptions {
  token?: string;
  print?: boolean;
}

export interface InstallResult {
  editor: Editor;
  file: string;
  snippet: string; // the block we wrote / would write, ready to show the user
  written: boolean;
  alreadyPresent: boolean;
  invoke: string; // one-line "how to use it now" hint
}

function home(...parts: string[]): string {
  return join(homedir(), ...parts);
}

// ---- target resolution -------------------------------------------------------

function claudeDesktopConfigPath(): string {
  const p = platform();
  if (p === "win32") {
    const appData = process.env.APPDATA ?? home("AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  if (p === "darwin") {
    return home("Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return home(".config", "Claude", "claude_desktop_config.json");
}

interface JsonTarget {
  kind: "json";
  file: string;
  rootKey: "mcpServers" | "servers";
  withType: boolean; // Copilot (VS Code) needs "type": "stdio"
  invoke: string;
}

interface TomlTarget {
  kind: "toml";
  file: string;
  invoke: string;
}

type Target = JsonTarget | TomlTarget;

function resolveTarget(editor: Editor): Target {
  switch (editor) {
    case "claude":
      return {
        kind: "json",
        file: home(".claude.json"),
        rootKey: "mcpServers",
        withType: false,
        invoke: 'in Claude Code, ask: "Analyze ./clip.mp4 and tell me what happens at 0:30."',
      };
    case "claude-desktop":
      return {
        kind: "json",
        file: claudeDesktopConfigPath(),
        rootKey: "mcpServers",
        withType: false,
        invoke: "restart Claude Desktop, then ask it to analyze a video file.",
      };
    case "cursor":
      return {
        kind: "json",
        file: home(".cursor", "mcp.json"),
        rootKey: "mcpServers",
        withType: false,
        invoke: "open Cursor → Settings → MCP (should be green), then ask the agent about a video.",
      };
    case "antigravity":
      return {
        kind: "json",
        file: home(".gemini", "config", "mcp_config.json"),
        rootKey: "mcpServers",
        withType: false,
        invoke: "Antigravity auto-reloads MCP config; open an Agent session and ask about a video.",
      };
    case "copilot":
      return {
        kind: "json",
        file: join(process.cwd(), ".vscode", "mcp.json"),
        rootKey: "servers",
        withType: true,
        invoke: "in VS Code, switch Copilot Chat to Agent mode, then ask it to analyze a video.",
      };
    case "codex":
      return {
        kind: "toml",
        file: home(".codex", "config.toml"),
        invoke: "run `codex`, then `/mcp` to confirm the server, or just ask it about a video.",
      };
  }
}

// ---- server entry shape ------------------------------------------------------

function jsonEntry(withType: boolean, token?: string): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  if (withType) entry.type = "stdio";
  entry.command = "npx";
  entry.args = ["vzt-video-intel", "mcp"];
  if (token) entry.env = { REPLICATE_API_TOKEN: token };
  return entry;
}

function tomlBlock(token?: string): string {
  const lines = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = "npx"`,
    `args = ["vzt-video-intel", "mcp"]`,
  ];
  if (token) {
    lines.push("", `[mcp_servers.${SERVER_KEY}.env]`, `REPLICATE_API_TOKEN = "${token}"`);
  }
  return lines.join("\n") + "\n";
}

// ---- read / merge / write ----------------------------------------------------

function readJson(file: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, "utf-8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Corrupt/partial config — start fresh rather than crash. The user's other
    // servers may be lost, but a malformed file already broke their editor.
    return {};
  }
}

function ensureDir(file: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Build the config block for an editor without touching disk. */
export function buildSnippet(editor: Editor, opts: InstallOptions = {}): InstallResult {
  const target = resolveTarget(editor);
  const snippet =
    target.kind === "toml"
      ? tomlBlock(opts.token)
      : JSON.stringify(
          { [target.rootKey]: { [SERVER_KEY]: jsonEntry(target.withType, opts.token) } },
          null,
          2,
        ) + "\n";
  return {
    editor,
    file: target.file,
    snippet,
    written: false,
    alreadyPresent: false,
    invoke: target.invoke,
  };
}

/** Merge the entry into the editor's real config (or print-only with opts.print). */
export function installEditor(editor: Editor, opts: InstallOptions = {}): InstallResult {
  const base = buildSnippet(editor, opts);
  if (opts.print) return base;

  const target = resolveTarget(editor);

  if (target.kind === "toml") {
    const existing = existsSync(target.file) ? readFileSync(target.file, "utf-8") : "";
    if (existing.includes(`[mcp_servers.${SERVER_KEY}]`)) {
      return { ...base, alreadyPresent: true, written: false };
    }
    ensureDir(target.file);
    const sep = existing ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
    writeFileSync(target.file, existing + sep + tomlBlock(opts.token));
    return { ...base, written: true };
  }

  const doc = readJson(target.file);
  const existingRoot = doc[target.rootKey];
  const root =
    existingRoot && typeof existingRoot === "object"
      ? (existingRoot as Record<string, unknown>)
      : {};
  const alreadyPresent = Object.prototype.hasOwnProperty.call(root, SERVER_KEY);
  root[SERVER_KEY] = jsonEntry(target.withType, opts.token);
  doc[target.rootKey] = root;
  ensureDir(target.file);
  writeFileSync(target.file, JSON.stringify(doc, null, 2) + "\n");
  return { ...base, written: true, alreadyPresent };
}
