import { diffLines } from "diff";
import type { ThemeColors } from "../theme.js";
import type { MdSeg } from "./markdown.js";
import { markdownToSegLines } from "./markdown.js";
import { wrapText } from "./utils.js";

type SearchHit = { title?: string; url?: string; snippet?: string; publishedDate?: string };
type SearchGroup = { query?: string; results?: SearchHit[]; error?: string };
type XPost = { url: string; id?: string; handle?: string; text?: string };
type XPostGroup = { query?: string; dateRange?: string; posts?: XPost[]; error?: string };

const HARNESS_TOOL_PREFIX = "mcp__harness-tools__";

/** Map Claude Code / Codex built-in (and harness host) tool names onto Scira's renderers. */
const CANONICAL_TOOL: Record<string, string> = {
  // Scira host tools exposed to the CLI
  multiWebSearch: "webSearch",
  // Claude Code built-ins
  Read: "readFile",
  Write: "writeFile",
  Edit: "editFile",
  MultiEdit: "editFile",
  NotebookEdit: "editFile",
  Bash: "bash",
  BashOutput: "bash",
  Grep: "grepWorkspace",
  Glob: "listWorkspaceDir",
  LS: "listWorkspaceDir",
  TodoWrite: "todo",
  WebFetch: "readUrl",
  WebSearch: "webSearch",
  // Codex built-ins
  shell: "bash",
};

/** Strip the harness host-tool MCP prefix so `mcp__harness-tools__readUrl` reads as `readUrl`. */
export function displayToolName(name: string): string {
  return name.startsWith(HARNESS_TOOL_PREFIX) ? name.slice(HARNESS_TOOL_PREFIX.length) : name;
}

/**
 * Resolve a harness/CLI tool name to the Scira renderer key. The harness exposes
 * our host tools as `mcp__harness-tools__*` and the CLIs have their own builtin
 * names (Read, Bash, Grep, …); both should render like Scira's equivalents.
 */
export function canonicalToolName(name: string): string {
  const stripped = displayToolName(name);
  return CANONICAL_TOOL[stripped] ?? stripped;
}

/** Tools that start collapsed in the timeline (long output). */
export const DEFAULT_COLLAPSED_TOOLS = new Set([
  "webSearch",
  "multiWebSearch",
  "readUrl",
  "readFile",
  "readWorkspaceFile",
  "readSkill",
  "bash",
  "runWorkspaceCommand",
  "todo",
  "grepWorkspace",
  "xSearch",
]);

export function feedToolItemId(feedIndex: number, toolCallId?: string): string {
  return toolCallId ?? `feed-${feedIndex}`;
}

export function isCollapsibleToolName(name: string): boolean {
  return name.length > 0;
}

export function defaultCollapsedToolName(name: string): boolean {
  // Chrome DevTools MCP tools (prefixed `devtools_`) produce long browser
  // snapshots/output, so collapse them by default like the built-in tools.
  if (name.startsWith("devtools_")) return true;
  return DEFAULT_COLLAPSED_TOOLS.has(name);
}

export function isToolItemCollapsed(
  id: string,
  name: string,
  status: "running" | "done" | "error",
  expandState: ReadonlyMap<string, boolean>,
): boolean {
  if (status === "running" || !isCollapsibleToolName(name)) return false;
  const override = expandState.get(id);
  if (override === true) return false;
  if (override === false) return true;
  return defaultCollapsedToolName(name);
}

function seg(text: string, style: Partial<MdSeg> = {}): MdSeg {
  return { text, ...style };
}

function blank(): MdSeg[] {
  return [];
}

function plainLines(text: string, width: number, style: Partial<MdSeg> = {}): MdSeg[][] {
  return wrapText(text, width).map((line) => [seg(line, style)]);
}

function tryPrettyJson(text: string, width: number, theme: ThemeColors): MdSeg[][] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const pretty = JSON.stringify(parsed, null, 2);
    return plainLines(pretty, width, { color: theme.textDim });
  } catch {
    return null;
  }
}

function dedupeSearchHits(groups: SearchGroup[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const group of groups) {
    for (const hit of group.results ?? []) {
      const key = hit.url?.trim().toLowerCase() || `${hit.title ?? ""}:${hit.snippet ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
  }
  return out;
}

function mdLinkLabel(text: string): string {
  return text.replace(/\\/gu, "\\\\").replace(/\[/gu, "\\[").replace(/\]/gu, "\\]");
}

function searchHitToMarkdown(hit: SearchHit): string {
  const title = hit.title?.trim() || hit.url || "(no title)";
  const url = hit.url?.trim() ?? "";
  let block = url ? `- [${mdLinkLabel(title)}](${url})` : `- ${mdLinkLabel(title)}`;
  if (hit.publishedDate) block += ` — *${hit.publishedDate}*`;
  if (hit.snippet) {
    const snippet = hit.snippet.replace(/\s+/gu, " ").trim();
    if (snippet) block += `\n  *${snippet}*`;
  }
  return block;
}

function webSearchQueriesMarkdown(groups: SearchGroup[]): string {
  const queries = groups.map((g) => g.query?.trim()).filter((q): q is string => Boolean(q));
  const errors = groups.map((g) => g.error?.trim()).filter((e): e is string => Boolean(e));
  const parts: string[] = [];
  if (queries.length > 0) {
    parts.push(`## Queries\n\n${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
  }
  if (errors.length > 0) {
    parts.push(`## Errors\n\n${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

function webSearchSourcesMarkdown(hits: SearchHit[]): string {
  if (hits.length === 0) return "";
  return `## Sources (${hits.length})\n\n${hits.map(searchHitToMarkdown).join("\n\n")}`;
}

function webSearchToMarkdown(groups: SearchGroup[]): string {
  const queries = webSearchQueriesMarkdown(groups);
  const sources = webSearchSourcesMarkdown(dedupeSearchHits(groups));
  if (!queries && !sources) return "";
  if (!queries) return sources;
  if (!sources) return queries;
  return `${queries}\n\n${sources}`;
}

function parseInputQueries(input: string): string[] {
  return input
    .split(" · ")
    .map((part) => part.replace(/\s+\+\d+$/u, "").trim())
    .filter(Boolean);
}

function webSearchRunningMarkdown(input: string): string {
  const queries = parseInputQueries(input);
  if (queries.length === 0) return `## Queries\n\n${input}`;
  return `## Queries\n\n${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
}

function formatWebSearch(result: string, width: number, theme: ThemeColors): MdSeg[][] {
  try {
    const groups = JSON.parse(result) as SearchGroup[];
    if (!Array.isArray(groups)) return plainLines(result, width, { color: theme.textDim });

    const md = webSearchToMarkdown(groups);
    if (!md.trim()) return plainLines(result, width, { color: theme.textDim });
    return markdownToSegLines(md, width, theme);
  } catch {
    return plainLines(result, width, { color: theme.textDim });
  }
}

function formatReadUrl(result: string, width: number, theme: ThemeColors): MdSeg[][] {
  const lines: MdSeg[][] = [];
  const titleMatch = result.match(/^#\s+(.+)/m);
  const snapshotMatch = result.match(/\(snapshot saved to ([^)]+)\)/);

  if (titleMatch?.[1]) {
    lines.push([seg(titleMatch[1].trim(), { bold: true, color: theme.text })]);
  }
  if (snapshotMatch?.[1]) {
    lines.push([
      seg("saved ", { dim: true, color: theme.textDim }),
      seg(snapshotMatch[1], { color: theme.accent }),
    ]);
  }

  const bodyMarker = result.indexOf("\n\n");
  const body = bodyMarker >= 0 ? result.slice(bodyMarker + 2).trim() : result.trim();
  if (body) {
    if (lines.length > 0) lines.push(blank());
    lines.push(...plainLines(body, width, { color: theme.textDim }));
  }
  return lines.length > 0 ? lines : plainLines(result, width, { color: theme.textDim });
}

function formatListSkills(result: string, width: number, theme: ThemeColors): MdSeg[][] {
  const rows = result.split("\n").map((l) => l.trim()).filter(Boolean);
  if (rows.length === 0) return [ [seg("no skills", { dim: true, color: theme.textDim })] ];

  return rows.flatMap((row, idx) => {
    const colon = row.indexOf(":");
    const name = colon >= 0 ? row.slice(0, colon).trim() : row;
    const desc = colon >= 0 ? row.slice(colon + 1).trim() : "";
    const prefix = `${idx + 1}. `;
    if (!desc) {
      return [[seg(prefix, { dim: true, color: theme.textDim }), seg(name, { bold: true, color: theme.text })]];
    }
    const out: MdSeg[][] = [[
      seg(prefix, { dim: true, color: theme.textDim }),
      seg(name, { bold: true, color: theme.text }),
      seg(": ", { color: theme.textDim }),
    ]];
    for (const part of wrapText(desc, width - prefix.length - name.length - 2)) {
      out.push([seg("   ", {}), seg(part, { color: theme.textDim })]);
    }
    return out;
  });
}

function formatShellOutput(result: string, width: number, theme: ThemeColors): MdSeg[][] {
  // Codex returns `{ exitCode, output }`; Claude returns the output string directly.
  let text = result;
  const obj = parseObj(result);
  if (obj && typeof obj.output === "string") {
    text = typeof obj.exitCode === "number" && obj.exitCode !== 0 ? `[exit ${obj.exitCode}]\n${obj.output}` : obj.output;
  }
  if (!text.trim()) return [[seg("(no output)", { dim: true, color: theme.textDim })]];
  return text.split("\n").flatMap((line) => plainLines(line, width, { color: theme.textDim }));
}

function formatFileContent(result: string, width: number, theme: ThemeColors): MdSeg[][] {
  const rows = result.split("\n");
  const numbered = rows.map((line, i) => {
    const n = String(i + 1).padStart(String(rows.length).length, " ");
    return `${n} │ ${line}`;
  });
  return numbered.flatMap((line) => plainLines(line, width, { color: theme.textDim }));
}

function formatGrep(result: string, width: number, theme: ThemeColors): MdSeg[][] {
  const rows = result.split("\n").filter((l) => l.trim());
  if (rows.length === 0) return [[seg("no matches", { dim: true, color: theme.textDim })]];
  return rows.flatMap((row) => {
    const colon = row.indexOf(":");
    if (colon > 0) {
      return [[
        seg(row.slice(0, colon + 1), { color: theme.accent }),
        seg(row.slice(colon + 1), { color: theme.textDim }),
      ]];
    }
    return plainLines(row, width, { color: theme.textDim });
  });
}

function xPostToMarkdown(p: XPost): string {
  const label = p.handle ? `@${p.handle}` : p.url;
  let line = `- [${label}](${p.url})`;
  if (p.text) {
    const snippet = p.text.replace(/\s+/gu, " ").trim();
    if (snippet) line += `\n  *${snippet}*`;
  }
  return line;
}

function xSearchPostsMarkdown(groups: XPostGroup[]): string {
  const queries = groups.map((g) => g.query?.trim()).filter((q): q is string => Boolean(q));
  const errors = groups.map((g) => g.error?.trim()).filter((e): e is string => Boolean(e));
  const allPosts = groups.flatMap((g) => g.posts ?? []);
  const dateRange = groups[0]?.dateRange;
  const parts: string[] = [];
  if (queries.length > 0) {
    parts.push(`## Queries\n\n${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`);
  }
  if (dateRange) {
    parts.push(`*${dateRange}*`);
  }
  if (errors.length > 0) {
    parts.push(`## Errors\n\n${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}`);
  }
  if (allPosts.length > 0) {
    const postLines = allPosts.map(xPostToMarkdown).join("\n\n");
    parts.push(`## Posts (${allPosts.length})\n\n${postLines}`);
  }
  return parts.join("\n\n");
}

function formatXSearch(result: string, width: number, theme: ThemeColors): MdSeg[][] {
  try {
    const groups = JSON.parse(result) as XPostGroup[];
    if (!Array.isArray(groups)) return plainLines(result, width, { color: theme.textDim });
    const md = xSearchPostsMarkdown(groups);
    if (!md.trim()) return plainLines(result, width, { color: theme.textDim });
    return markdownToSegLines(md, width, theme);
  } catch {
    return plainLines(result, width, { color: theme.textDim });
  }
}

function formatBody(
  name: string,
  result: string,
  width: number,
  theme: ThemeColors,
): MdSeg[][] {
  switch (name) {
    case "webSearch":
      return formatWebSearch(result, width, theme);
    case "xSearch":
      return formatXSearch(result, width, theme);
    case "readUrl":
      return formatReadUrl(result, width, theme);
    case "listSkills":
      return formatListSkills(result, width, theme);
    case "bash":
    case "runWorkspaceCommand":
      return formatShellOutput(result, width, theme);
    case "readFile":
    case "readWorkspaceFile":
      return formatFileContent(result, width, theme);
    case "grepWorkspace":
      return formatGrep(result, width, theme);
    case "writeFile":
    case "writeWorkspaceFile":
    case "editFile":
    case "editWorkspaceFile":
    case "createClaim":
    case "verifyClaim":
    case "requestFullResearch":
    case "readSkill":
      return plainLines(result, width, { color: theme.text });
    default: {
      const json = tryPrettyJson(result, width, theme);
      return json ?? plainLines(result, width, { color: theme.textDim });
    }
  }
}

/** One-line preview for a collapsed tool header. */
export function formatToolResultPreview(
  rawName: string,
  inputSummary: string,
  result: string | undefined,
  status: "running" | "done" | "error",
): string {
  const name = canonicalToolName(rawName);
  const input = inputSummary.replace(/\s+/gu, " ").trim();
  if (status === "running") return input ? `${input} · running…` : "running…";
  if (status === "error") return input || "failed";
  if (!result?.trim()) return input || "done";

  if (name === "readUrl") {
    const titleMatch = result.match(/^#\s+(.+)/m);
    const snapshotMatch = result.match(/\(snapshot saved to ([^)]+)\)/);
    const title = titleMatch?.[1]?.trim();
    const snap = snapshotMatch?.[1];
    if (title && snap) return `${title} · ${snap}`;
    if (title) return title;
    return input || (result.split("\n")[0]?.slice(0, 120) ?? "page loaded");
  }

  if (name === "webSearch") {
    try {
      const groups = JSON.parse(result) as SearchGroup[];
      if (Array.isArray(groups)) {
        const queries = groups.map((g) => g.query?.trim()).filter(Boolean);
        const total = dedupeSearchHits(groups).length;
        const q = queries.length > 0 ? queries.slice(0, 2).join(" · ") + (queries.length > 2 ? ` +${queries.length - 2}` : "") : input;
        return q ? `${q} · ${total} sources` : `${total} sources`;
      }
    } catch { /* fall through */ }
  }

  if (name === "xSearch") {
    try {
      const groups = JSON.parse(result) as XPostGroup[];
      if (Array.isArray(groups)) {
        const queries = groups.map((g) => g.query?.trim()).filter(Boolean);
        const total = groups.reduce((n, g) => n + (g.posts?.length ?? 0), 0);
        const q = queries.length > 0 ? queries.slice(0, 2).join(" · ") + (queries.length > 2 ? ` +${queries.length - 2}` : "") : input;
        return q ? `${q} · ${total} posts` : `${total} posts`;
      }
    } catch { /* fall through */ }
  }

  if (name === "readFile" || name === "readWorkspaceFile") {
    const lines = result.split("\n").length;
    return input ? `${input} · ${lines} lines` : `${lines} lines`;
  }

  if (name === "bash" || name === "runWorkspaceCommand") {
    const tail = result.split("\n").filter((l) => l.trim()).slice(-1)[0] ?? "";
    return input ? `$ ${input}` : tail.slice(0, 100) || "done";
  }

  const first = result.replace(/\s+/gu, " ").trim();
  return first.length > 140 ? `${first.slice(0, 137)}…` : first;
}

// --- Dedicated renderers for Claude Code / Codex built-in tools ---

function parseObj(s?: string): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Unified-ish diff between two strings: removed lines red, added green, a little context dim. */
function diffSegLines(oldStr: string, newStr: string, width: number, theme: ThemeColors): MdSeg[][] {
  const parts = diffLines(oldStr ?? "", newStr ?? "");
  const out: MdSeg[][] = [];
  const MAX = 60;
  let count = 0;
  for (const part of parts) {
    const sign = part.added ? "+" : part.removed ? "-" : " ";
    const color = part.added ? theme.success : part.removed ? theme.error : theme.textDim;
    const linesIn = part.value.replace(/\n$/u, "").split("\n");
    for (const ln of linesIn) {
      if (count >= MAX) {
        out.push([seg("… diff truncated", { dim: true, color: theme.textDim })]);
        return out;
      }
      for (const wrapped of wrapText(`${sign} ${ln}`, width)) {
        out.push([seg(wrapped, { color, dim: !part.added && !part.removed })]);
      }
      count++;
    }
  }
  return out;
}

function pathHeader(p: unknown, theme: ThemeColors): MdSeg[] {
  return [seg("path  ", { dim: true, color: theme.textDim }), seg(String(p ?? ""), { color: theme.text })];
}

/** Edit / MultiEdit → file path + colored diff(s). */
function formatEditBody(input: Record<string, unknown>, width: number, theme: ThemeColors): MdSeg[][] {
  const lines: MdSeg[][] = [pathHeader(input.file_path ?? input.notebook_path, theme)];
  const edits = Array.isArray(input.edits)
    ? (input.edits as Record<string, unknown>[])
    : [{ old_string: input.old_string, new_string: input.new_string }];
  edits.forEach((e, i) => {
    if (edits.length > 1) lines.push([seg(`edit ${i + 1}`, { dim: true, color: theme.textDim })]);
    lines.push(...diffSegLines(String(e.old_string ?? ""), String(e.new_string ?? input.new_source ?? ""), width, theme));
  });
  return lines;
}

/** TodoWrite → checklist with status glyphs. */
function formatTodoBody(input: Record<string, unknown>, width: number, theme: ThemeColors): MdSeg[][] {
  const todos = Array.isArray(input.todos) ? (input.todos as Record<string, unknown>[]) : [];
  if (todos.length === 0) return [[seg("(no todos)", { dim: true, color: theme.textDim })]];
  return todos.flatMap((t) => {
    const status = String(t.status ?? "pending");
    const glyph = status === "completed" ? "☑" : status === "in_progress" ? "◐" : "☐";
    const color = status === "completed" ? theme.success : status === "in_progress" ? theme.warning : theme.textDim;
    const text = String(t.content ?? t.activeForm ?? "");
    const wrapped = wrapText(text, Math.max(8, width - 2));
    return wrapped.map((w, i) => [seg(i === 0 ? `${glyph} ` : "  ", { color }), seg(w, { color: status === "completed" ? theme.textDim : theme.text })]);
  });
}

/** Write → file path + content preview. */
function formatWriteBody(input: Record<string, unknown>, width: number, theme: ThemeColors): MdSeg[][] {
  const lines: MdSeg[][] = [pathHeader(input.file_path, theme), blank()];
  const allLines = String(input.content ?? "").split("\n");
  const shown = allLines.slice(0, 40);
  for (const ln of shown) lines.push(...plainLines(ln, width, { color: theme.text }));
  if (allLines.length > shown.length) lines.push([seg(`… +${allLines.length - shown.length} more lines`, { dim: true, color: theme.textDim })]);
  return lines;
}

/** WebFetch → url + fetched/answer text. */
function formatWebFetchBody(input: Record<string, unknown> | null, result: string, width: number, theme: ThemeColors): MdSeg[][] {
  const lines: MdSeg[][] = [];
  const url = input?.url;
  if (url) lines.push([seg("url  ", { dim: true, color: theme.textDim }), seg(String(url), { color: theme.accent, underline: true, url: String(url) })]);
  if (result.trim()) {
    if (lines.length > 0) lines.push(blank());
    lines.push(...plainLines(result, width, { color: theme.text }));
  }
  return lines;
}

/** Task / Agent (subagent) → description + output. */
function formatSubagentBody(input: Record<string, unknown> | null, result: string, width: number, theme: ThemeColors): MdSeg[][] {
  const lines: MdSeg[][] = [];
  const desc = input?.description ?? input?.subagent_type;
  if (desc) lines.push([seg("task  ", { dim: true, color: theme.textDim }), seg(String(desc), { color: theme.text })]);
  if (result.trim()) {
    if (lines.length > 0) lines.push(blank());
    lines.push(...markdownToSegLines(result, width, theme));
  }
  return lines;
}

/** ToolSearch → query + which tool reference it loaded. */
function formatToolSearchBody(input: Record<string, unknown> | null, result: string, width: number, theme: ThemeColors): MdSeg[][] {
  const lines: MdSeg[][] = [];
  if (input?.query) lines.push([seg("query  ", { dim: true, color: theme.textDim }), seg(String(input.query), { color: theme.text })]);
  const ref = parseObj(result);
  if (ref?.tool_name) lines.push([seg("loaded  ", { dim: true, color: theme.textDim }), seg(String(ref.tool_name), { color: theme.accent })]);
  else if (result.trim()) lines.push(...plainLines(result, width, { color: theme.textDim }));
  return lines;
}

/**
 * Dedicated body for a Claude Code / Codex built-in tool, keyed by its real
 * (un-prefixed) name. Returns null to fall through to the generic renderer.
 */
function formatBuiltinBody(real: string, rawInput: string | undefined, result: string, width: number, theme: ThemeColors): MdSeg[][] | null {
  const input = parseObj(rawInput);
  switch (real) {
    case "Edit": case "edit": case "MultiEdit": case "NotebookEdit":
      return input ? formatEditBody(input, width, theme) : null;
    case "TodoWrite":
      return input ? formatTodoBody(input, width, theme) : null;
    case "Write": case "write":
      return input ? formatWriteBody(input, width, theme) : null;
    case "WebFetch":
      return formatWebFetchBody(input, result, width, theme);
    case "Task": case "Agent":
      return formatSubagentBody(input, result, width, theme);
    case "ToolSearch":
      return formatToolSearchBody(input, result, width, theme);
    case "fileChange":
      return formatFileChangeBody(input ?? parseObj(result), theme);
    default:
      return null;
  }
}

/** Codex/Claude file mutation event → a single colored "<event>  <path>" line. */
function formatFileChangeBody(fc: Record<string, unknown> | null, theme: ThemeColors): MdSeg[][] | null {
  if (!fc) return null;
  const event = String(fc.event ?? "change");
  const color = event === "delete" ? theme.error : event === "create" ? theme.success : theme.accent;
  return [[seg(`${event}  `, { color }), seg(String(fc.path ?? ""), { color: theme.text })]];
}

/** Multi-line formatted tool output for the feed panel. */
export function formatToolResultLines(
  rawName: string,
  inputSummary: string,
  rawResult: string | undefined,
  status: "running" | "done" | "error",
  contentWidth: number,
  theme: ThemeColors,
  expanded = true,
  rawInput?: string,
): MdSeg[][] {
  const name = canonicalToolName(rawName);
  const real = displayToolName(rawName);
  if (!expanded) return [];

  // Bound the text we lay out per render — a terminal can't show a 1MB result,
  // and wrapping/parsing that much on every frame is what stalls the renderer.
  // The full result stays in the stored feed; only what we format is capped.
  const MAX_RENDER = 60_000;
  const result = rawResult && rawResult.length > MAX_RENDER
    ? `${rawResult.slice(0, MAX_RENDER)}\n\n… [${rawResult.length - MAX_RENDER} more chars not shown]`
    : rawResult;

  // Dedicated built-in tool rendering (diffs, checklists, …). Input-driven ones
  // (Edit, Write, TodoWrite) render even while the tool is still running.
  if (status !== "error") {
    const builtin = formatBuiltinBody(real, rawInput, result ?? "", Math.max(16, contentWidth), theme);
    if (builtin && builtin.length > 0) {
      if (status === "running" && !result?.trim()) builtin.push([seg("running…", { dim: true, color: theme.textDim })]);
      return builtin;
    }
  }

  const width = Math.max(16, contentWidth);
  const lines: MdSeg[][] = [];
  const input = inputSummary.replace(/\s+/gu, " ").trim();

  const skipInput = (name === "webSearch" || name === "xSearch") && status === "done" && Boolean(result?.trim());

  if (input && !skipInput) {
    if (name === "bash" || name === "runWorkspaceCommand") {
      lines.push([seg("$ ", { color: theme.accent }), seg(input, { color: theme.text })]);
    } else if (name === "webSearch" || name === "xSearch") {
      lines.push(...markdownToSegLines(webSearchRunningMarkdown(input), width, theme));
    } else if (name === "readUrl") {
      lines.push([seg("url  ", { dim: true, color: theme.textDim }), seg(input, { color: theme.accent, underline: true, url: input })]);
    } else if (name === "readFile" || name === "readWorkspaceFile" || name === "writeFile" || name === "writeWorkspaceFile" || name === "editFile" || name === "editWorkspaceFile") {
      lines.push([seg("path  ", { dim: true, color: theme.textDim }), seg(input, { color: theme.text })]);
    } else {
      lines.push([seg(input, { color: theme.textDim })]);
    }
  }

  if (status === "running") {
    lines.push([seg("running…", { dim: true, color: theme.textDim })]);
    return lines;
  }

  if (!result?.trim()) {
    lines.push([seg(status === "error" ? "failed" : "done", { dim: true, color: theme.textDim })]);
    return lines;
  }

  if (status === "error") {
    if (lines.length > 0) lines.push(blank());
    lines.push(...plainLines(result, width, { color: theme.error }));
    return lines;
  }

  if (lines.length > 0) lines.push(blank());
  lines.push(...formatBody(name, result, width, theme));
  return lines;
}
