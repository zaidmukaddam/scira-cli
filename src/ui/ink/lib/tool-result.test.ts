import { describe, expect, it } from "bun:test";
import { DARK_THEME } from "../theme.js";
import {
  formatToolResultLines, formatToolResultPreview, isToolItemCollapsed, defaultCollapsedToolName,
} from "./tool-result.js";

function textOf(lines: ReturnType<typeof formatToolResultLines>): string {
  return lines.map((row) => row.map((s) => s.text).join("")).join("\n");
}

describe("formatToolResultLines", () => {
  it("shows queries then a flat sources list", () => {
    const result = JSON.stringify([
      {
        query: "ai news",
        results: [
          { title: "Alpha", url: "https://a.com", snippet: "First hit snippet." },
          { title: "Beta", url: "https://b.com", snippet: "Second hit snippet." },
        ],
      },
      {
        query: "ai frameworks",
        results: [
          { title: "Alpha", url: "https://a.com", snippet: "Duplicate should drop." },
          { title: "Gamma", url: "https://c.com", snippet: "Third hit snippet." },
        ],
      },
    ]);
    const out = textOf(formatToolResultLines("webSearch", "ai news · ai frameworks", result, "done", 80, DARK_THEME));
    expect(out.indexOf("Queries")).toBeLessThan(out.indexOf("Sources"));
    expect(out).toContain("ai news");
    expect(out).toContain("ai frameworks");
    expect(out).toContain("Sources (3)");
    expect(out).toContain("Alpha");
    expect(out).toContain("First hit snippet.");
    expect(out).toContain("Gamma");
    expect(out).not.toContain("Duplicate should drop");
  });

  it("shows shell command and full output", () => {
    const out = textOf(formatToolResultLines("bash", "ls -la", "total 0\nfile.txt", "done", 80, DARK_THEME));
    expect(out).toContain("$ ls -la");
    expect(out).toContain("total 0");
    expect(out).toContain("file.txt");
  });

  it("shows readUrl title and body when expanded", () => {
    const result = "# Example\n(snapshot saved to snapshots/example.md)\n\nBody paragraph here.";
    const out = textOf(formatToolResultLines("readUrl", "https://example.com", result, "done", 80, DARK_THEME, true));
    expect(out).toContain("Example");
    expect(out).toContain("snapshots/example.md");
    expect(out).toContain("Body paragraph here.");
  });

  it("hides readUrl body when collapsed", () => {
    const result = "# Example\n(snapshot saved to snapshots/example.md)\n\nBody paragraph here.";
    expect(formatToolResultLines("readUrl", "https://example.com", result, "done", 80, DARK_THEME, false)).toEqual([]);
    expect(formatToolResultPreview("readUrl", "https://example.com", result, "done")).toContain("Example");
  });

  it("defaults readUrl and webSearch collapsed", () => {
    expect(defaultCollapsedToolName("readUrl")).toBe(true);
    expect(defaultCollapsedToolName("webSearch")).toBe(true);
    expect(isToolItemCollapsed("id", "readUrl", "done", new Map())).toBe(true);
    expect(isToolItemCollapsed("id", "webSearch", "done", new Map())).toBe(true);
    expect(isToolItemCollapsed("id", "readUrl", "done", new Map([["id", true]]))).toBe(false);
  });
});
