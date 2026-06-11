import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import stringWidth from "string-width";
import { type ModelUsage, type TurnUsage, type SessionUsage } from "../types.js";
import { FULL_MODE_TRIGGERS } from "../constants.js";

export const pkgVersion = (JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../package.json"), "utf8")
) as { version: string }).version;

/** Pipe text to the OS clipboard (pbcopy / clip / xclip). Resolves false when unavailable. */
export function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((res) => {
    const cmd = process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";
    const args = cmd === "xclip" ? ["-selection", "clipboard"] : [];
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => res(false));
    child.on("close", (code) => res(code === 0));
    child.stdin.write(text);
    child.stdin.end();
  });
}

function historyFile(runDirectory: string): string {
  return resolve(process.cwd(), runDirectory, "..", "input-history.json");
}

export async function loadInputHistory(runDirectory: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(historyFile(runDirectory), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(-50) : [];
  } catch {
    return [];
  }
}

export async function saveInputHistory(runDirectory: string, history: string[]): Promise<void> {
  try {
    const file = historyFile(runDirectory);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(history.slice(-50), null, 2));
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
  return stringWidth(text);
}

/** Longest prefix of `text` whose terminal-cell width fits in `width`; returns its char length. */
function fitChars(text: string, width: number): number {
  if (stringWidth(text) === text.length) return Math.min(text.length, width);
  let cells = 0;
  let chars = 0;
  for (const ch of text) {
    const w = stringWidth(ch);
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
export function hyperlink(text: string, url?: string): string {
  if (!url) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
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

export function summarizeToolInput(name: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  if (name === "bash") return String(obj.command ?? "");
  if (name === "webSearch") {
    const queries = Array.isArray(obj.queries) ? (obj.queries as string[]) : [];
    return queries.length > 0 ? queries.slice(0, 2).join(" · ") + (queries.length > 2 ? ` +${queries.length - 2}` : "") : String(obj.query ?? "");
  }
  if (name === "readUrl") return String(obj.url ?? "");
  if (name === "writeFile" || name === "editFile" || name === "readFile") return String(obj.path ?? "");
  try {
    return JSON.stringify(obj).slice(0, 80);
  } catch {
    return "";
  }
}

