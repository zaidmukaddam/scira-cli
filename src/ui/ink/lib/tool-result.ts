import type { ThemeColors } from "../theme.js";
import type { MdSeg } from "./markdown.js";
import { markdownToSegLines } from "./markdown.js";
import { wrapText } from "./utils.js";

type SearchHit = { title?: string; url?: string; snippet?: string; publishedDate?: string };
type SearchGroup = { query?: string; results?: SearchHit[] };

/** Tools that start collapsed in the timeline (long output). */
export const DEFAULT_COLLAPSED_TOOLS = new Set([
  "readUrl",
  "readFile",
  "readWorkspaceFile",
  "readSkill",
  "bash",
  "runWorkspaceCommand",
  "grepWorkspace",
]);

export function feedToolItemId(feedIndex: number, toolCallId?: string): string {
  return toolCallId ?? `feed-${feedIndex}`;
}

export function isCollapsibleToolName(name: string): boolean {
  return name.length > 0;
}

export function defaultCollapsedToolName(name: string): boolean {
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
  if (queries.length === 0) return "";
  return `## Queries\n\n${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
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
  if (!result.trim()) return [[seg("(no output)", { dim: true, color: theme.textDim })]];
  return result.split("\n").flatMap((line) => plainLines(line, width, { color: theme.textDim }));
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

function formatBody(
  name: string,
  result: string,
  width: number,
  theme: ThemeColors,
): MdSeg[][] {
  switch (name) {
    case "webSearch":
      return formatWebSearch(result, width, theme);
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
  name: string,
  inputSummary: string,
  result: string | undefined,
  status: "running" | "done" | "error",
): string {
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

/** Multi-line formatted tool output for the feed panel. */
export function formatToolResultLines(
  name: string,
  inputSummary: string,
  result: string | undefined,
  status: "running" | "done" | "error",
  contentWidth: number,
  theme: ThemeColors,
  expanded = true,
): MdSeg[][] {
  if (!expanded) return [];
  const width = Math.max(16, contentWidth);
  const lines: MdSeg[][] = [];
  const input = inputSummary.replace(/\s+/gu, " ").trim();

  const skipInput = name === "webSearch" && status === "done" && Boolean(result?.trim());

  if (input && !skipInput) {
    if (name === "bash" || name === "runWorkspaceCommand") {
      lines.push([seg("$ ", { color: theme.accent }), seg(input, { color: theme.text })]);
    } else if (name === "webSearch") {
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
