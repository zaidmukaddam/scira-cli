import { displayWidth } from "./utils.js";

export type MdSeg = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; dim?: boolean; color?: string; url?: string };

export function parseInlineMarkdown(text: string): MdSeg[] {
  const segs: MdSeg[] = [];
  const re = /(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) segs.push({ text: tok.slice(1, -1), color: "#FFE0C2" });
    else if (tok.startsWith("**") || tok.startsWith("__")) segs.push({ text: tok.slice(2, -2), bold: true });
    else if (tok.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(tok);
      segs.push({ text: link ? link[1] : tok, color: "#FFE0C2", underline: true, url: link ? link[2] : undefined });
    } else segs.push({ text: tok.slice(1, -1), italic: true });
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs.length > 0 ? segs : [{ text: "" }];
}

export function wrapSegments(segs: MdSeg[], width: number): MdSeg[][] {
  const w = Math.max(10, width);
  const lines: MdSeg[][] = [];
  let line: MdSeg[] = [];
  let len = 0;
  const flush = () => { lines.push(line); line = []; len = 0; };
  for (const seg of segs) {
    for (const part of seg.text.split(/(\s+)/u)) {
      if (part === "") continue;
      if (/^\s+$/u.test(part)) {
        if (len === 0) continue;
        if (len + 1 <= w) { line.push({ ...seg, text: " " }); len += 1; } else flush();
        continue;
      }
      let word = part;
      while (displayWidth(word) > w) {
        if (len > 0) flush();
        let cells = 0; let chars = 0;
        for (const ch of word) {
          const cw = displayWidth(ch);
          if (cells + cw > w) break;
          cells += cw; chars += ch.length;
        }
        line.push({ ...seg, text: word.slice(0, chars) });
        len = w; flush();
        word = word.slice(chars);
      }
      const wordW = displayWidth(word);
      if (len > 0 && len + wordW > w) flush();
      line.push({ ...seg, text: word });
      len += wordW;
    }
  }
  if (line.length > 0) flush();
  return lines.length > 0 ? lines : [[]];
}

export function parseMarkdownTable(lines: string[], start: number): { rows: string[][]; end: number } | null {
  const header = lines[start];
  const divider = lines[start + 1];
  if (!header || !divider) return null;
  const isRow = (line: string) => /^\s*\|.*\|\s*$/u.test(line);
  const isDivider = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);
  if (!isRow(header) || !isDivider(divider)) return null;
  const split = (line: string) => {
    const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
    const cells: string[] = [];
    let current = "";
    let inCode = false;
    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      const prev = trimmed[i - 1];
      if (ch === "`" && prev !== "\\") inCode = !inCode;
      if (ch === "|" && prev !== "\\" && !inCode) {
        cells.push(current.trim().replace(/\\\|/gu, "|"));
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim().replace(/\\\|/gu, "|"));
    return cells;
  };
  const rows = [split(header)];
  let i = start + 2;
  while (i < lines.length && isRow(lines[i])) {
    rows.push(split(lines[i]));
    i += 1;
  }
  return { rows, end: i };
}

export function segsTextLength(segs: MdSeg[]): number {
  return segs.reduce((n, seg) => n + displayWidth(seg.text), 0);
}

export function truncateSegs(segs: MdSeg[], width: number): MdSeg[] {
  if (segsTextLength(segs) <= width) return segs;
  const out: MdSeg[] = [];
  let remaining = Math.max(0, width - 1);
  for (const seg of segs) {
    if (remaining <= 0) break;
    const segW = displayWidth(seg.text);
    if (segW <= remaining) {
      out.push(seg);
      remaining -= segW;
    } else {
      let cells = 0; let chars = 0;
      for (const ch of seg.text) {
        const cw = displayWidth(ch);
        if (cells + cw > remaining) break;
        cells += cw; chars += ch.length;
      }
      out.push({ ...seg, text: seg.text.slice(0, chars) });
      remaining = 0;
    }
  }
  out.push({ text: "…", color: "gray", dim: true });
  return out;
}

export function tableToSegLines(rows: string[][], width: number): MdSeg[][] {
  const cols = Math.max(...rows.map((row) => row.length));
  const colWidths = Array.from({ length: cols }, (_, col) => Math.max(3, ...rows.map((row) => displayWidth(row[col] ?? ""))));
  const total = colWidths.reduce((n, w) => n + w, 0) + Math.max(0, cols - 1) * 3;
  if (total > width) {
    const scale = Math.max(0.35, (width - Math.max(0, cols - 1) * 3) / Math.max(1, colWidths.reduce((n, w) => n + w, 0)));
    for (let i = 0; i < colWidths.length; i += 1) colWidths[i] = Math.max(3, Math.floor(colWidths[i] * scale));
  }
  const out: MdSeg[][] = [];
  rows.forEach((row, rowIndex) => {
    const segs: MdSeg[] = [];
    for (let col = 0; col < cols; col += 1) {
      const raw = row[col] ?? "";
      const parsed = truncateSegs(parseInlineMarkdown(raw), colWidths[col]);
      const pad = Math.max(0, colWidths[col] - segsTextLength(parsed));
      if (col > 0) segs.push({ text: " │ ", color: "gray", dim: true });
      segs.push(...parsed.map((seg) => ({ ...seg, bold: rowIndex === 0 ? true : seg.bold, color: rowIndex === 0 ? "white" : seg.color })));
      if (pad > 0) segs.push({ text: " ".repeat(pad) });
    }
    out.push(segs);
    if (rowIndex === 0) {
      const rule: MdSeg[] = [];
      for (let col = 0; col < cols; col += 1) {
        if (col > 0) rule.push({ text: "─┼─", color: "gray", dim: true });
        rule.push({ text: "─".repeat(colWidths[col]), color: "gray", dim: true });
      }
      out.push(rule);
    }
  });
  return out;
}

export function markdownToSegLines(text: string, width: number): MdSeg[][] {
  const out: MdSeg[][] = [];
  let inFence = false;
  const normalized = text
    .replace(/(\[[^\]\n]*)\n\s*([^\]\n]*\]\([^)]+\))/gu, "$1 $2")
    .replace(/(\[[^\]]+\])\n\s*(\([^)]+\))/gu, "$1$2");
  const rawLines = normalized.split("\n");
  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const raw = rawLines[lineIndex];
    if (/^\s*```/u.test(raw)) { inFence = !inFence; continue; }
    if (inFence) {
      const gutter: MdSeg = { text: "  │ ", color: "gray", dim: true };
      const wrapped = wrapSegments([{ text: raw || " ", color: "#FFE0C2", dim: true }], width - 4);
      for (const ln of wrapped) out.push([gutter, ...ln]);
      continue;
    }
    const table = parseMarkdownTable(rawLines, lineIndex);
    if (table) {
      out.push(...tableToSegLines(table.rows, width));
      lineIndex = table.end - 1;
      continue;
    }
    if (raw.trim() === "") { out.push([]); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/u.test(raw)) {
      out.push([{ text: "─".repeat(Math.max(3, width - 1)), color: "gray", dim: true }]);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(raw);
    if (heading) {
      const color = heading[1].length <= 2 ? "#FFE0C2" : "white";
      const segs = parseInlineMarkdown(heading[2]).map((s) => ({ ...s, bold: true, color }));
      for (const ln of wrapSegments(segs, width)) out.push(ln);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/u.exec(raw);
    if (quote) {
      const segs = parseInlineMarkdown(quote[1]).map((s) => ({ ...s, dim: true }));
      for (const ln of wrapSegments(segs, width - 2)) out.push([{ text: "│ ", color: "gray", dim: true }, ...ln]);
      continue;
    }
    const list = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/u.exec(raw);
    if (list) {
      const marker = list[2] ? `${list[2]}. ` : "• ";
      const prefix = list[1] + marker;
      const segs = parseInlineMarkdown(list[3]);
      const wrapped = wrapSegments(segs, Math.max(10, width - prefix.length));
      wrapped.forEach((ln, i) => out.push([{ text: i === 0 ? prefix : " ".repeat(prefix.length), color: "#FFE0C2" }, ...ln]));
      continue;
    }
    for (const ln of wrapSegments(parseInlineMarkdown(raw), width)) out.push(ln);
  }
  return out;
}
