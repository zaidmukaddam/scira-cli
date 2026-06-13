import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FILE_MENTION_SKIP, FILE_MENTION_MAX_CHARS } from "../constants.js";

export function listMentionableFiles(root = process.cwd(), max = 300): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    if (out.length >= max) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
      if (out.length >= max || FILE_MENTION_SKIP.has(entry)) continue;
      const abs = join(dir, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (stat.isDirectory()) walk(abs, rel);
      else if (stat.isFile()) out.push(rel);
    }
  };
  walk(root, "");
  return out;
}

export function activeFileMention(input: string): { fragment: string; start: number } | null {
  const match = input.match(/(?:^|\s)@([^\s]*)$/u);
  if (!match || match.index === undefined) return null;
  return { fragment: match[1] ?? "", start: match.index + match[0].indexOf("@") };
}

export function extractFileMentions(input: string): string[] {
  return Array.from(new Set(Array.from(input.matchAll(/(?:^|\s)@([^\s]+)/gu)).map((m) => m[1]).filter(Boolean)));
}

export async function promptWithFileMentions(prompt: string): Promise<{ prompt: string; files: string[] }> {
  const files = extractFileMentions(prompt);
  if (files.length === 0) return { prompt, files: [] };
  const blocks: string[] = [];
  for (const file of files) {
    const abs = join(process.cwd(), file);
    try {
      const content = await Bun.file(abs).text();
      const body = content.length > FILE_MENTION_MAX_CHARS
        ? `${content.slice(0, FILE_MENTION_MAX_CHARS)}\n...[truncated ${content.length - FILE_MENTION_MAX_CHARS} chars]`
        : content;
      blocks.push(`### @${file}\n\n\`\`\`\n${body}\n\`\`\``);
    } catch {
      blocks.push(`### @${file}\n\n[Could not read this file.]`);
    }
  }
  if (blocks.length === 0) return { prompt, files: [] };
  return {
    prompt: `${prompt}\n\nThe user mentioned these project files. Use them as context:\n\n${blocks.join("\n\n")}`,
    files
  };
}
