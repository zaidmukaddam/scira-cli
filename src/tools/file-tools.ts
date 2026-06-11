import { tool } from "ai";
import { z } from "zod";
import { Files, type StoredFile } from "files-sdk";
import { fs } from "files-sdk/fs";
import { SciraConfig } from "../types/index.js";
import { logEvent } from "../storage/run-store.js";

const MAX_CONTENT = 8000;

function truncate(text: string, max = MAX_CONTENT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

async function takeAsync<T>(iter: AsyncIterable<T>, max: number): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iter) {
    results.push(item);
    if (results.length >= max) break;
  }
  return results;
}

type FileEntry = { key: string; size: number; lastModified: Date | string | undefined };

type GateCallback = (toolName: string, description: string) => Promise<boolean>;

export function createFileTools(
  runPath: string,
  config: SciraConfig,
  onApprovalRequired?: GateCallback
) {
  const dir = config.files!.dir;
  const files = new Files({ adapter: fs({ root: dir }) });

  async function gate(toolName: string, description: string): Promise<boolean> {
    if (config.approvalMode === "auto" || !onApprovalRequired) return true;
    return onApprovalRequired(toolName, description);
  }

  return {
    listFiles: tool({
      description:
        "List files in the configured files directory. Use to enumerate available documents before reading them.",
      inputSchema: z.object({
        prefix: z.string().optional().describe("Key prefix to filter results (e.g. 'reports/')."),
        maxResults: z.number().int().min(1).max(200).optional().describe("Max files to return (default 50).")
      }),
      execute: async ({ prefix, maxResults = 50 }) => {
        const items = await takeAsync(files.listAll({ prefix }) as AsyncIterable<FileEntry>, maxResults);
        await logEvent(runPath, "file.list", { prefix, count: items.length });
        return JSON.stringify(
          items.map((f) => ({ key: f.key, size: f.size, lastModified: f.lastModified })),
          null,
          2
        );
      }
    }),

    searchFiles: tool({
      description:
        "Search the files directory by glob pattern, substring, or /regex/ string. " +
        "Glob examples: '**/*.pdf', 'reports/*.md'. Wrap in slashes for regex: '/error|panic/'.",
      inputSchema: z.object({
        pattern: z.string().describe("Glob (default), substring, or /regex/ string to match against file keys."),
        prefix: z.string().optional().describe("Limit the search to keys with this prefix."),
        maxResults: z.number().int().min(1).max(100).optional().describe("Max results (default 20).")
      }),
      execute: async ({ pattern, prefix, maxResults = 20 }) => {
        const patternArg: string | RegExp =
          pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2
            ? new RegExp(pattern.slice(1, -1))
            : pattern;
        const items = await takeAsync(
          files.search(patternArg, { prefix, maxResults }) as AsyncIterable<FileEntry>,
          maxResults
        );
        await logEvent(runPath, "file.search", { pattern, count: items.length });
        return JSON.stringify(
          items.map((f) => ({ key: f.key, size: f.size, lastModified: f.lastModified })),
          null,
          2
        );
      }
    }),

    getFile: tool({
      description:
        "Read the text content of a file from the files directory. " +
        "Returns the file content (truncated if large). Binary files return a content-type notice.",
      inputSchema: z.object({
        key: z.string().describe("File key — path relative to the files directory root.")
      }),
      execute: async ({ key }) => {
        let stored: StoredFile;
        try {
          stored = await files.download(key);
        } catch (error) {
          return `Could not read "${key}": ${(error as Error).message}`;
        }
        const contentType = stored.type ?? "application/octet-stream";
        if (
          contentType.startsWith("image/") ||
          contentType.startsWith("video/") ||
          contentType.startsWith("audio/") ||
          contentType === "application/octet-stream"
        ) {
          await logEvent(runPath, "file.read", { key, binary: true, contentType });
          return `Binary file (${contentType}) — cannot display as text.`;
        }
        const text = await stored.text();
        await logEvent(runPath, "file.read", { key, chars: text.length });
        return truncate(text);
      }
    }),

    fileExists: tool({
      description: "Check whether a file exists in the files directory.",
      inputSchema: z.object({
        key: z.string().describe("File key to check.")
      }),
      execute: async ({ key }) => {
        const exists = await files.exists(key);
        return exists
          ? `"${key}" exists.`
          : `"${key}" does not exist.`;
      }
    }),

    moveFile: tool({
      description:
        "Move (rename) a file within the files directory. Requires user approval.",
      inputSchema: z.object({
        source: z.string().describe("Current file key."),
        destination: z.string().describe("Target file key.")
      }),
      execute: async ({ source, destination }) => {
        if (!await gate("moveFile", `Move file:\n  ${source} → ${destination}`)) {
          return "Move rejected by user.";
        }
        await files.move(source, destination);
        await logEvent(runPath, "file.move", { source, destination });
        return `Moved "${source}" → "${destination}"`;
      }
    }),

    deleteFile: tool({
      description:
        "Delete a file from the files directory. Requires user approval.",
      inputSchema: z.object({
        key: z.string().describe("File key to delete.")
      }),
      execute: async ({ key }) => {
        if (!await gate("deleteFile", `Delete file: "${key}"`)) {
          return "Delete rejected by user.";
        }
        await files.delete(key);
        await logEvent(runPath, "file.delete", { key });
        return `Deleted "${key}".`;
      }
    })
  };
}
