import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { SciraConfig, Claim } from "../types/index.js";
import { multiSearchWeb } from "../tools/search-web.js";
import { openUrl, writeSnapshot } from "../tools/open-url.js";
import { appendJsonl, readJsonl } from "../storage/jsonl.js";
import { logEvent } from "../storage/run-store.js";
import { diffLines } from "diff";
import { SKILL_NAMES, getSkill } from "./skills.js";
import { createFileTools } from "../tools/file-tools.js";

/** Called before a gated tool executes. Return true to approve, false to reject. */
export type ApprovalCallback = (toolName: string, description: string) => Promise<boolean>;

const execAsync = promisify(exec);

const MAX_OUTPUT = 8000;

function truncate(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/** Derive a stable, filesystem-safe snapshot filename slug from a URL. */
function snapshotSlug(url: string): string {
  return url.replace(/^https?:\/\//u, "").replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "page";
}

/**
 * Resolve a model-provided path against the run directory and refuse to escape it.
 */
export function resolveInsideRun(runPath: string, candidate: string): string {
  const abs = isAbsolute(candidate) ? candidate : resolve(runPath, candidate);
  const rel = relative(runPath, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path "${candidate}" is outside the run directory and is not allowed.`);
  }
  return abs;
}

export function createResearchTools(
  runPath: string,
  config: SciraConfig,
  onApprovalRequired?: ApprovalCallback
) {
  /** Gate a tool behind user approval unless approvalMode is "auto". */
  async function gate(toolName: string, description: string): Promise<boolean> {
    if (config.approvalMode === "auto" || !onApprovalRequired) return true;
    return onApprovalRequired(toolName, description);
  }

  const claimsPath = join(runPath, "claims.jsonl");

  return {
    bash: tool({
      description:
        "Run a shell command inside the run directory. Use for listing files, grepping notes, running scripts, git, etc. Returns combined stdout/stderr.",
      inputSchema: z.object({
        command: z.string().describe("The shell command to execute."),
        timeoutMs: z.number().int().positive().max(120000).optional().describe("Optional timeout in ms (default 60000).")
      }),
      execute: async ({ command, timeoutMs }) => {
        if (!await gate("bash", command)) return "Command rejected by user.";
        // Block commands that attempt to leave the run directory.
        const escapesRunDir = /(?:^|[;&|`\n])\s*cd\s+[^.]/u.test(command)
          || /\.\.\/\.\.\//u.test(command)
          || /~[/\\]/u.test(command)
          || /\$HOME/u.test(command);
        if (escapesRunDir) {
          return "Command rejected: navigating outside the run directory is not allowed.";
        }
        await logEvent(runPath, "tool.bash", { command });
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: runPath,
            timeout: timeoutMs ?? 60000,
            maxBuffer: 10 * 1024 * 1024,
            shell: "/bin/bash"
          });
          const out = [stdout, stderr].filter(Boolean).join("\n").trim();
          return truncate(out || "(no output)");
        } catch (error) {
          const err = error as { stdout?: string; stderr?: string; message?: string };
          const out = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").trim();
          return truncate(`Command failed:\n${out}`);
        }
      }
    }),

    writeFile: tool({
      description:
        "Create or overwrite a file inside the run directory (e.g. plan.md, notes.md, report.md, sources.jsonl). Paths are relative to the run directory.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the run directory."),
        content: z.string().describe("Full file content to write.")
      }),
      execute: async ({ path, content }) => {
        const isPlanOrReport = path === "plan.md" || path === "report.md";
        if (isPlanOrReport) {
          let description: string;
          if (path === "report.md") {
            const abs = resolveInsideRun(runPath, path);
            const existing = await readFile(abs, "utf8").catch(() => "");
            const parts = diffLines(existing, content);
            const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
            const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
            const diffPreview = parts
              .filter((p) => p.added || p.removed)
              .flatMap((p) => p.value.split("\n").filter(Boolean).map((l) => `${p.added ? "+" : "-"} ${l}`))
              .slice(0, 20)
              .join("\n");
            description = `report.md  (+${added} / -${removed} lines)\n\n${diffPreview}`;
          } else {
            description = `${path}\n\n${content.length > 600 ? `${content.slice(0, 600)}\n…` : content}`;
          }
          if (!await gate("writeFile", description)) return `Write to ${path} rejected by user.`;
        }
        const abs = resolveInsideRun(runPath, path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content);
        const eventType = path === "report.md" ? "report.updated" : path === "plan.md" ? "plan.updated" : "file.written";
        await logEvent(runPath, eventType, { path, chars: content.length });
        return `Wrote ${content.length} chars to ${path}`;
      }
    }),

    editFile: tool({
      description:
        "Replace an exact string in an existing file inside the run directory. The oldString must match exactly and be unique.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the run directory."),
        oldString: z.string().describe("Exact text to replace."),
        newString: z.string().describe("Replacement text.")
      }),
      execute: async ({ path, oldString, newString }) => {
        const abs = resolveInsideRun(runPath, path);
        const current = await readFile(abs, "utf8");
        const occurrences = current.split(oldString).length - 1;
        if (occurrences === 0) {
          return `No match for the given oldString in ${path}. No changes made.`;
        }
        if (occurrences > 1) {
          return `oldString matched ${occurrences} times in ${path}; provide more context to make it unique. No changes made.`;
        }
        await writeFile(abs, current.replace(oldString, newString));
        await logEvent(runPath, "file.edited", { path });
        return `Edited ${path}`;
      }
    }),

    createClaim: tool({
      description: "Record a structured research claim into claims.jsonl. Call after reading a source to track a significant finding.",
      inputSchema: z.object({
        id: z.string().describe("Unique claim ID, e.g. claim_001."),
        text: z.string().describe("The claim statement."),
        confidence: z.enum(["low", "medium", "high"]).describe("Confidence level."),
        sourceIds: z.array(z.string()).describe("Source IDs supporting this claim."),
        reason: z.string().describe("Why these sources support the claim.")
      }),
      execute: async ({ id, text, confidence, sourceIds, reason }) => {
        const claim: Claim = { id, text, confidence, status: "draft", sourceIds, reason, createdAt: new Date().toISOString() };
        await appendJsonl(claimsPath, claim);
        await logEvent(runPath, "claim.created", { id, confidence, sourceIds });
        return `Claim ${id} recorded.`;
      }
    }),

    verifyClaim: tool({
      description: "Update a claim's verification status after checking its evidence. Call after confirming or questioning a claim.",
      inputSchema: z.object({
        id: z.string().describe("Claim ID to update."),
        status: z.enum(["verified", "weak", "contradicted", "needs_review"]).describe("New verification status."),
        reason: z.string().describe("Explanation of the verification result.")
      }),
      execute: async ({ id, status, reason }) => {
        const claims = await readJsonl<Claim>(claimsPath);
        const idx = claims.findIndex((c) => c.id === id);
        if (idx === -1) {
          return `Claim "${id}" not found. Present IDs: ${claims.map((c) => c.id).join(", ") || "none"}`;
        }
        claims[idx] = { ...claims[idx], status, reason };
        await mkdir(dirname(claimsPath), { recursive: true });
        await writeFile(claimsPath, claims.map((c) => JSON.stringify(c)).join("\n") + "\n");
        await logEvent(runPath, "claim.verified", { id, status });
        return `Claim ${id} → ${status}`;
      }
    }),

    readFile: tool({
      description: "Read a file inside the run directory.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the run directory.")
      }),
      execute: async ({ path }) => {
        const abs = resolveInsideRun(runPath, path);
        return truncate(await readFile(abs, "utf8"));
      }
    }),

    webSearch: tool({
      description: `Search the web with multiple parallel queries. Always use 3-5 queries per call to cover the topic from different angles.
- Include date context in queries: "${new Date().getFullYear()}", "latest", "recent".
- Use topic:"news" for breaking events, quality:"best" only when depth is essential.
- Never invent sources — only cite URLs returned by this tool.`,
      inputSchema: z.object({
        queries: z.array(z.string()).min(3).max(10).describe("3-5 search queries covering different angles of the topic."),
        maxResults: z.array(z.number().int().min(1).max(20)).max(10).optional().describe("Max results per query (default 10)."),
        topics: z.array(z.enum(["general", "news"])).optional().describe("Topic type per query. Default: general."),
        quality: z.array(z.enum(["default", "best"])).optional().describe("Search quality per query. Use best sparingly."),
        startDates: z.array(z.string().nullable().optional()).optional().describe("ISO date filter per query (YYYY-MM-DD). Omit for no filter.")
      }),
      execute: async ({ queries, maxResults, topics, quality, startDates }) => {
        const perQuery = queries.map((_, i) => ({
          maxResults: maxResults?.[i] ?? 10,
          topic: (topics?.[i] ?? "general") as "general" | "news",
          quality: (quality?.[i] ?? "default") as "default" | "best",
          startDate: startDates?.[i] ?? null
        }));
        const searches = await multiSearchWeb(queries, perQuery, config);
        await logEvent(runPath, "tool.search", { queries, resultCount: searches.reduce((n, s) => n + s.results.length, 0) });
        return JSON.stringify(
          searches.map((s) => ({
            query: s.query,
            results: s.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet, publishedDate: r.publishedDate }))
          })),
          null,
          2
        );
      }
    }),

    readUrl: tool({
      description: "Fetch and extract the readable content of a web page so you can read and cite it.",
      inputSchema: z.object({
        url: z.string().describe("The URL to open and extract.")
      }),
      execute: async ({ url }) => {
        const page = await openUrl(url, config);
        const snapshotPath = await writeSnapshot(join(runPath, "snapshots"), snapshotSlug(url), page);
        const snapshotRel = relative(runPath, snapshotPath);
        await logEvent(runPath, "tool.open_url", { url, title: page.title, snapshot: snapshotRel });
        return truncate(`# ${page.title}\n(snapshot saved to ${snapshotRel} — record this as snapshotPath in sources.jsonl)\n\n${page.text}`);
      }
    }),

    listSkills: tool({
      description: "List the names and one-line summaries of all built-in research skills.",
      inputSchema: z.object({}),
      execute: async () => {
        return SKILL_NAMES.map((n) => {
          const s = getSkill(n);
          return `${n}: ${s?.summary ?? ""}`;
        }).join("\n");
      }
    }),

    readSkill: tool({
      description:
        "Read the full content of a built-in research skill by name. " +
        "The available skill names are listed in your instructions.",
      inputSchema: z.object({
        name: z.string().describe("Skill name exactly as listed in the instructions.")
      }),
      execute: async ({ name }) => {
        const skill = getSkill(name);
        if (!skill) {
          return `Unknown skill "${name}". Available: ${SKILL_NAMES.join(", ")}`;
        }
        return skill.content;
      }
    }),
    ...(config.files ? createFileTools(runPath, config, onApprovalRequired) : {})
  };
}

/** Called when the model's escalation request is approved by the user. */
export type EscalateCallback = () => void;

/**
 * Lightweight toolset for quick one-shot answers: web search + page reading,
 * plus a single escalation tool the model can call (with user approval) to
 * switch into the full research harness.
 */
export function createOneShotTools(
  runPath: string,
  config: SciraConfig,
  onApprovalRequired?: ApprovalCallback,
  onEscalate?: EscalateCallback
) {
  const all = createResearchTools(runPath, config, onApprovalRequired);
  async function gate(toolName: string, description: string): Promise<boolean> {
    if (config.approvalMode === "auto" || !onApprovalRequired) return true;
    return onApprovalRequired(toolName, description);
  }
  return {
    webSearch: all.webSearch,
    readUrl: all.readUrl,
    requestFullResearch: tool({
      description:
        "Escalate from quick one-shot mode to the FULL research harness (skills, plan.md, claims, verification, sources.jsonl, report.md). " +
        "You MUST call this if the user's goal involves research, deep dives, analysis, comparisons, history, or any topic that would benefit from structured multi-source research. " +
        "For simple factual questions (e.g. 'what is the capital of France?') do NOT call this — just answer directly.",
      inputSchema: z.object({
        reason: z.string().describe("One sentence on why full research is warranted.")
      }),
      execute: async ({ reason }) => {
        const approved = await gate("requestFullResearch", `Escalate to the full research harness?\n\nReason: ${reason}`);
        if (!approved) {
          return "User declined escalation. Answer the question concisely now using webSearch and readUrl only — do not ask again.";
        }
        onEscalate?.();
        return "Approved. Stop now and do not call more tools — the full research harness will take over and complete the work.";
      }
    })
  };
}

/**
 * Workspace-aware tools for coding agent capabilities.
 * Unlike research tools, these operate on the full workspace, not just the run directory.
 */
export function createCodingTools(
  workspacePath: string,
  config: SciraConfig,
  onApprovalRequired?: ApprovalCallback
) {
  async function gate(toolName: string, description: string): Promise<boolean> {
    if (config.approvalMode === "auto" || !onApprovalRequired) return true;
    return onApprovalRequired(toolName, description);
  }

  function resolveWorkspacePath(candidate: string): string {
    return isAbsolute(candidate) ? candidate : resolve(workspacePath, candidate);
  }

  return {
    readWorkspaceFile: tool({
      description: "Read a file from the workspace. Use for examining code, configs, or any workspace file.",
      inputSchema: z.object({
        path: z.string().describe("File path (absolute or relative to workspace root).")
      }),
      execute: async ({ path }) => {
        const abs = resolveWorkspacePath(path);
        const content = await readFile(abs, "utf8");
        return truncate(content);
      }
    }),

    writeWorkspaceFile: tool({
      description: "Create or overwrite a file in the workspace. Requires approval for safety.",
      inputSchema: z.object({
        path: z.string().describe("File path (absolute or relative to workspace root)."),
        content: z.string().describe("Full file content to write.")
      }),
      execute: async ({ path, content }) => {
        const abs = resolveWorkspacePath(path);
        const preview = content.length > 800 ? `${content.slice(0, 800)}\n…[${content.length} total chars]` : content;
        if (!await gate("writeWorkspaceFile", `Write to ${path}:\n\n${preview}`)) {
          return `Write to ${path} rejected by user.`;
        }
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content);
        return `Wrote ${content.length} chars to ${path}`;
      }
    }),

    editWorkspaceFile: tool({
      description: "Replace an exact string in a workspace file. The oldString must match exactly and be unique.",
      inputSchema: z.object({
        path: z.string().describe("File path (absolute or relative to workspace root)."),
        oldString: z.string().describe("Exact text to replace."),
        newString: z.string().describe("Replacement text.")
      }),
      execute: async ({ path, oldString, newString }) => {
        const abs = resolveWorkspacePath(path);
        const current = await readFile(abs, "utf8");
        const occurrences = current.split(oldString).length - 1;
        if (occurrences === 0) {
          return `No match for the given oldString in ${path}. No changes made.`;
        }
        if (occurrences > 1) {
          return `oldString matched ${occurrences} times in ${path}; provide more context to make it unique. No changes made.`;
        }
        const diff = diffLines(current, current.replace(oldString, newString));
        const preview = diff
          .filter((p) => p.added || p.removed)
          .flatMap((p) => p.value.split("\n").filter(Boolean).map((l) => `${p.added ? "+" : "-"} ${l}`))
          .slice(0, 15)
          .join("\n");
        if (!await gate("editWorkspaceFile", `Edit ${path}:\n\n${preview}`)) {
          return `Edit to ${path} rejected by user.`;
        }
        await writeFile(abs, current.replace(oldString, newString));
        return `Edited ${path}`;
      }
    }),

    listWorkspaceDir: tool({
      description: "List files and directories in a workspace directory.",
      inputSchema: z.object({
        path: z.string().describe("Directory path (absolute or relative to workspace root)."),
        recursive: z.boolean().optional().describe("Recursively list subdirectories (default false).")
      }),
      execute: async ({ path, recursive }) => {
        const abs = resolveWorkspacePath(path);
        const cmd = recursive ? `find "${abs}" -type f -o -type d | head -200` : `ls -lah "${abs}"`;
        try {
          const { stdout } = await execAsync(cmd, { maxBuffer: 5 * 1024 * 1024 });
          return truncate(stdout.trim());
        } catch (error) {
          const err = error as { stderr?: string; message?: string };
          return `Failed to list ${path}: ${err.stderr ?? err.message}`;
        }
      }
    }),

    grepWorkspace: tool({
      description: "Search for a pattern across workspace files using grep. Essential for finding code references.",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern (regex supported)."),
        path: z.string().optional().describe("Directory to search (default: workspace root)."),
        filePattern: z.string().optional().describe("File pattern to include (e.g., '*.ts', '*.{js,jsx}').")
      }),
      execute: async ({ pattern, path, filePattern }) => {
        const searchPath = path ? resolveWorkspacePath(path) : workspacePath;
        const fileArg = filePattern ? `--include="${filePattern}"` : "";
        const cmd = `grep -rn ${fileArg} -E "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -100`;
        try {
          const { stdout } = await execAsync(cmd, { maxBuffer: 5 * 1024 * 1024 });
          const result = stdout.trim() || `No matches found for pattern: ${pattern}`;
          return truncate(result);
        } catch (error) {
          const err = error as { stdout?: string };
          const result = err.stdout?.trim() || `No matches found for pattern: ${pattern}`;
          return truncate(result);
        }
      }
    }),

    runWorkspaceCommand: tool({
      description: "Execute a shell command in the workspace. Use for builds, tests, package installs, git, etc. Requires approval.",
      inputSchema: z.object({
        command: z.string().describe("The shell command to execute."),
        cwd: z.string().optional().describe("Working directory (default: workspace root)."),
        timeoutMs: z.number().int().positive().max(300000).optional().describe("Timeout in ms (default 60000, max 300000).")
      }),
      execute: async ({ command, cwd, timeoutMs }) => {
        const workDir = cwd ? resolveWorkspacePath(cwd) : workspacePath;
        if (!await gate("runWorkspaceCommand", `Run command in ${relative(workspacePath, workDir) || "."}:\n\n${command}`)) {
          return "Command rejected by user.";
        }
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: workDir,
            timeout: timeoutMs ?? 60000,
            maxBuffer: 10 * 1024 * 1024,
            shell: "/bin/bash"
          });
          const out = [stdout, stderr].filter(Boolean).join("\n").trim();
          return truncate(out || "(no output)");
        } catch (error) {
          const err = error as { stdout?: string; stderr?: string; message?: string };
          const out = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").trim();
          return truncate(`Command failed:\n${out}`);
        }
      }
    })
  };
}
