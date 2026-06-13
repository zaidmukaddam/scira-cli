import { readFileSync } from "node:fs";
import * as Bun from "bun";
import { writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ModelUsage, type TurnUsage, type SessionUsage } from "../types.js";
import { FULL_MODE_TRIGGERS } from "../constants.js";

export const pkgVersion = (JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../package.json"), "utf8")
) as { version: string }).version;

/** Pipe text to the OS clipboard (pbcopy / clip / xclip). Resolves false when unavailable. */
export async function copyToClipboard(text: string): Promise<boolean> {
  const cmd = process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";
  const args = cmd === "xclip" ? ["-selection", "clipboard"] : [];
  try {
    const proc = Bun.spawn([cmd, ...args], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(text);
    await proc.stdin.end();
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

function historyFile(runDirectory: string): string {
  return resolve(process.cwd(), runDirectory, "..", "input-history.json");
}

export async function loadInputHistory(runDirectory: string): Promise<string[]> {
  try {
    const parsed: unknown = await Bun.file(historyFile(runDirectory)).json();
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(-50) : [];
  } catch {
    return [];
  }
}

export async function saveInputHistory(runDirectory: string, history: string[]): Promise<void> {
  try {
    const file = historyFile(runDirectory);
    await mkdir(dirname(file), { recursive: true });
    await Bun.write(file, JSON.stringify(history.slice(-50), null, 2));
  } catch { /* non-fatal */ }
}

export const CWD_DISPLAY = (() => {
  const home = homedir();
  const cwd = process.cwd();
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
})();

export function prettifyModelId(id: string): string {
  const slug = id.includes("/") ? id.split("/").pop()! : id;
  return slug
    .split(/[-_]/u)
    .map((w) => (/^[0-9]/u.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Terminal-cell width of a string (CJK/emoji aware, strips ANSI). */
export function displayWidth(text: string): number {
  return Bun.stringWidth(text);
}

/** Longest prefix of `text` whose terminal-cell width fits in `width`; returns its char length. */
function fitChars(text: string, width: number): number {
  if (Bun.stringWidth(text) === text.length) return Math.min(text.length, width);
  let cells = 0;
  let chars = 0;
  for (const ch of text) {
    const w = Bun.stringWidth(ch);
    if (cells + w > width) break;
    cells += w;
    chars += ch.length;
  }
  return chars;
}

export function wrapText(text: string, width: number): string[] {
  const w = Math.max(20, width);
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw;
    if (line.length === 0) { out.push(""); continue; }
    while (displayWidth(line) > w) {
      const fit = fitChars(line, w);
      const slice = line.slice(0, fit);
      const sp = slice.lastIndexOf(" ");
      if (sp > fit * 0.5) {
        out.push(line.slice(0, sp));
        line = line.slice(sp + 1);
      } else {
        out.push(slice);
        line = line.slice(fit);
      }
    }
    out.push(line);
  }
  return out;
}

export function formatTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return "0s";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return rem === 0 ? `${m}m` : `${m}m${rem}s`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Compact relative time, e.g. "now", "5m", "3h", "2d", "3w". */
export function relativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(ms).toLocaleDateString();
}

/** Wrap text in an OSC 8 terminal hyperlink (clickable in supported terminals). */
export type LineLink = { start: number; end: number; url: string };

function colorToAnsi(color?: string): number[] {
  if (!color) return [];
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = hex[1];
    return [38, 2, parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  }
  const ansi256 = /^ansi256\((\d+)\)$/i.exec(color);
  if (ansi256) return [38, 5, parseInt(ansi256[1], 10)];
  const named: Record<string, number> = {
    red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36,
    gray: 90, white: 97, black: 30,
  };
  const code = named[color.toLowerCase()];
  return code ? [code] : [];
}

/** OSC 8 link with inline ANSI styling — avoids Ink Text props breaking the escape sequence. */
export function ansiHyperlink(
  text: string,
  url: string,
  style?: { color?: string; bold?: boolean; underline?: boolean; dim?: boolean; italic?: boolean },
): string {
  const params: number[] = [];
  if (style?.bold) params.push(1);
  if (style?.dim) params.push(2);
  if (style?.italic) params.push(3);
  if (style?.underline !== false) params.push(4);
  params.push(...colorToAnsi(style?.color));
  const styled = params.length > 0 ? `\x1b[${params.join(";")}m${text}\x1b[0m` : text;
  return `\x1b]8;;${url}\x1b\\${styled}\x1b]8;;\x1b\\`;
}

export function hyperlink(text: string, url?: string): string {
  if (!url) return text;
  return ansiHyperlink(text, url, { underline: true });
}

export function computeLineLinks(segs: ReadonlyArray<{ text: string; url?: string }>, prefixCols = 0): LineLink[] {
  const links: LineLink[] = [];
  let col = prefixCols;
  for (const s of segs) {
    const w = displayWidth(s.text);
    if (s.url && w > 0) links.push({ start: col, end: col + w - 1, url: s.url });
    col += w;
  }
  return links;
}

/** Match an SGR mouse column (1-based) against link regions from computeLineLinks. */
export function linkAtMouseColumn(links: ReadonlyArray<LineLink>, x: number): string | undefined {
  for (const l of links) {
    if (x >= l.start + 1 && x <= l.end + 1) return l.url;
  }
  return undefined;
}

/** Open a URL in the system browser. */
export async function openExternalUrl(url: string): Promise<boolean> {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const proc = Bun.spawn([cmd, ...args], { stdout: "ignore", stderr: "ignore" });
    proc.unref();
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/** True if the prompt clearly asks for full, report-grade research. */
export function wantsFullResearch(prompt: string): boolean {
  const p = prompt.toLowerCase();
  return FULL_MODE_TRIGGERS.some((kw) => p.includes(kw));
}

/** Word-wrap input text and locate the caret in the wrapped output (no cursor char injection). */
export function wrapInputWithCursor(
  text: string,
  width: number,
  caretPos: number,
): { lines: string[]; cursorLine: number; cursorCol: number } {
  const w = Math.max(1, width);
  const lines: string[] = [];
  let cursorLine = 0;
  let cursorCol = 0;
  let i = 0;
  while (i < text.length || lines.length === 0) {
    const remaining = text.slice(i);
    if (remaining.length === 0) { lines.push(""); break; }
    let lineEnd: number;
    if (remaining.length <= w) {
      lineEnd = remaining.length;
    } else {
      const slice = remaining.slice(0, w);
      const sp = slice.lastIndexOf(" ");
      lineEnd = sp > Math.floor(w * 0.4) ? sp : w;
    }
    const line = remaining.slice(0, lineEnd);
    if (caretPos >= i && caretPos <= i + lineEnd) { cursorLine = lines.length; cursorCol = caretPos - i; }
    lines.push(line);
    const skipSpace = text[i + lineEnd] === " " ? 1 : 0;
    i += lineEnd + skipSpace;
  }
  if (caretPos >= text.length && lines.length > 0) {
    cursorLine = lines.length - 1;
    cursorCol = lines[lines.length - 1].length;
  }
  return { lines: lines.length ? lines : [""], cursorLine, cursorCol };
}

export function aggregateTurns(turns: TurnUsage[]): SessionUsage {
  const byModel: Record<string, ModelUsage> = {};
  const total = { input: 0, output: 0, total: 0 };
  for (const t of turns) {
    const cur = byModel[t.model] ?? { input: 0, output: 0, total: 0, turns: 0 };
    byModel[t.model] = { input: cur.input + t.input, output: cur.output + t.output, total: cur.total + t.total, turns: cur.turns + 1 };
    total.input += t.input;
    total.output += t.output;
    total.total += t.total;
  }
  return { total, byModel, turns };
}

function oneLine(text: string, max: number): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, max);
}

function toolOutputText(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

// Harness/CLI tool names mapped to Scira renderer keys. Kept local to avoid a
// circular import with tool-result.ts (which imports from this file).
const HARNESS_TOOL_PREFIX = "mcp__harness-tools__";
const SUMMARY_CANONICAL: Record<string, string> = {
  multiWebSearch: "webSearch",
  Read: "readFile", Write: "writeFile", Edit: "editFile", MultiEdit: "editFile", NotebookEdit: "editFile",
  Bash: "bash", BashOutput: "bash", shell: "bash",
  Grep: "grepWorkspace", Glob: "listWorkspaceDir", LS: "listWorkspaceDir",
  TodoWrite: "todo", WebFetch: "readUrl", WebSearch: "webSearch",
};

export function summarizeToolInput(rawName: string, input: unknown): string {
  const stripped = rawName.startsWith(HARNESS_TOOL_PREFIX) ? rawName.slice(HARNESS_TOOL_PREFIX.length) : rawName;
  const name = SUMMARY_CANONICAL[stripped] ?? stripped;
  const obj = (input ?? {}) as Record<string, unknown>;
  const path = obj.path ?? obj.file_path ?? obj.notebook_path;
  if (name === "bash" || name === "runBash" || name === "runWorkspaceCommand") {
    const action = obj.action;
    if (action && action !== "run") return `${action}${obj.taskId ? ` ${obj.taskId}` : ""}`;
    return String(obj.command ?? "");
  }
  if (name === "todo") {
    if (Array.isArray(obj.todos)) return `${(obj.todos as unknown[]).length} item(s)`;
    return `${String(obj.action ?? "list")}${obj.id ? ` ${obj.id}` : ""}`;
  }
  if (name === "webSearch" || name === "xSearch") {
    const queries = Array.isArray(obj.queries) ? (obj.queries as string[]) : [];
    return queries.length > 0 ? queries.slice(0, 2).join(" · ") + (queries.length > 2 ? ` +${queries.length - 2}` : "") : String(obj.query ?? "");
  }
  if (name === "readUrl") return String(obj.url ?? "");
  if (name === "writeFile" || name === "editFile" || name === "readFile" || name === "readWorkspaceFile" || name === "writeWorkspaceFile" || name === "editWorkspaceFile") {
    return String(path ?? "");
  }
  if (name === "listWorkspaceDir" || name === "grepWorkspace") return String(obj.pattern ?? path ?? "");
  if (name === "readSkill" || name === "listSkills") return String(obj.name ?? obj.skill ?? "");
  if (name === "createClaim" || name === "verifyClaim") return String(obj.id ?? "");
  if (stripped === "ToolSearch") return String(obj.query ?? "");
  if (stripped === "Task" || stripped === "Agent") return String(obj.description ?? obj.subagent_type ?? "");
  try {
    return JSON.stringify(obj).slice(0, 80);
  } catch {
    return "";
  }
}

/** Short one-line summary of a completed tool's output for the feed. */
export function summarizeToolOutput(name: string, output: unknown): string {
  const text = toolOutputText(output);

  if (name === "webSearch") {
    try {
      const parsed = JSON.parse(text) as Array<{ results?: Array<{ title?: string }> }>;
      if (Array.isArray(parsed)) {
        const total = parsed.reduce((n, s) => n + (s.results?.length ?? 0), 0);
        const titles = parsed
          .flatMap((s) => (s.results ?? []).slice(0, 2).map((r) => r.title?.trim()).filter(Boolean))
          .slice(0, 3) as string[];
        const head = total > 0 ? `${total} result${total === 1 ? "" : "s"}` : "no results";
        return titles.length > 0 ? `${head} · ${titles.join(" · ")}` : head;
      }
    } catch { /* fall through */ }
  }

  if (name === "xSearch") {
    try {
      const parsed = JSON.parse(text) as Array<{ posts?: Array<{ handle?: string }> }>;
      if (Array.isArray(parsed)) {
        const posts = parsed.flatMap((s) => s.posts ?? []);
        const total = posts.length;
        if (total === 0) return "no posts";
        const handles = posts
          .map((p) => p.handle)
          .filter((h): h is string => Boolean(h))
          .slice(0, 3)
          .map((h) => `@${h}`);
        const head = `${total} post${total === 1 ? "" : "s"}`;
        return handles.length > 0 ? `${head} · ${handles.join(", ")}` : head;
      }
    } catch { /* fall through */ }
  }

  if (name === "readUrl") {
    const titleMatch = text.match(/^#\s+(.+)/m);
    if (titleMatch?.[1]) return titleMatch[1].trim();
    const snapshot = text.match(/\(snapshot saved to ([^)]+)\)/);
    if (snapshot?.[1]) return `snapshot ${snapshot[1]}`;
    return oneLine(text, 160);
  }

  if (name === "listSkills") {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return "no skills";
    const preview = lines.slice(0, 2).map((l) => l.split(":")[0]?.trim() || l).join(", ");
    return `${lines.length} skill${lines.length === 1 ? "" : "s"} · ${preview}${lines.length > 2 ? ", …" : ""}`;
  }

  if (name === "readFile" || name === "readWorkspaceFile") {
    const lineCount = text.split("\n").length;
    const preview = oneLine(text.split("\n")[0] ?? "", 60);
    return `${lineCount} line${lineCount === 1 ? "" : "s"}${preview ? ` · ${preview}` : ""}`;
  }

  if (name === "writeFile" || name === "writeWorkspaceFile" || name === "editFile" || name === "editWorkspaceFile") {
    return oneLine(text, 120) || "ok";
  }

  if (name === "bash" || name === "runBash" || name === "runWorkspaceCommand") {
    if (text.startsWith("Started background task")) return oneLine(text, 120);
    if (text.startsWith("No background tasks") || text.includes("[running]") || text.includes("[exited]")) {
      return oneLine(text.split("\n")[0] ?? text, 120);
    }
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return "done";
    return lines.slice(-3).map((l) => oneLine(l, 80)).join(" · ").slice(0, 200);
  }

  if (name === "todo") {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return "no todos";
    const active = lines.filter((l) => l.includes("[ ]") || l.includes("[~]")).length;
    return `${lines.length} todo${lines.length === 1 ? "" : "s"}${active > 0 ? ` · ${active} open` : ""}`;
  }

  if (name === "listWorkspaceDir") {
    const lines = text.split("\n").filter((l) => l.trim());
    const preview = lines.slice(0, 3).map((l) => oneLine(l, 40)).join(", ");
    const head = `${lines.length} entr${lines.length === 1 ? "y" : "ies"}`;
    return preview ? `${head} · ${preview}${lines.length > 3 ? ", …" : ""}` : head;
  }

  if (name === "grepWorkspace") {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return "no matches";
    return `${lines.length} match${lines.length === 1 ? "" : "es"} · ${oneLine(lines[0], 80)}`;
  }

  return oneLine(text, 200);
}

