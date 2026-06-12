import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { SciraConfig, Claim } from "../types/index.js";
import { multiSearchWeb } from "./search-web.js";
import { createXSearchTool } from "./x-search.js";
import { openUrl, writeSnapshot } from "./open-url.js";
import { appendJsonl, readJsonl } from "../storage/jsonl.js";
import { logEvent } from "../storage/run-store.js";
import { diffLines } from "diff";
import { SKILL_NAMES, getSkill } from "../agent/skills.js";
import { createFileTools } from "./file-tools.js";
import { type BackgroundTaskManager } from "./background-tasks.js";
import { createTodoTool } from "./todos.js";
import { resolveToolPath, resolveInsideWorkspace, harnessBasename } from "./workspace.js";

export { resolveInsideRun } from "./workspace.js";

/** Called before a gated tool executes. Return true to approve, false to reject. */
export type ApprovalCallback = (toolName: string, description: string) => Promise<boolean>;

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 8000;

function truncate(text: string, max = MAX_OUTPUT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/** Derive a stable, filesystem-safe snapshot filename slug from a URL. */
function snapshotSlug(url: string): string {
  return url.replace(/^https?:\/\//u, "").replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "page";
}

export const PLAN_MODE_MSG = "Plan mode is active. Exit plan mode (/plan) before making changes.";

export type GetPlanMode = () => boolean;

const FIND_MUTATING_FLAGS = /\s-(?:delete|exec|execdir|ok|okdir|fprintf|fls|fprint)\b/u;

/** Reject parent refs, absolute paths, and home expansion in plan-mode bash. */
function bashPathsStayInCwd(command: string): boolean {
  if (/\.\./u.test(command)) return false;
  if (/\.\/\//u.test(command)) return false;
  if (/(?:^|\s)\//u.test(command)) return false;
  if (/~[/\\]/u.test(command) || /\$HOME/u.test(command)) return false;
  return true;
}

const BASH_PRIVILEGED_FLAGS = /--(?:extcmd|ext-diff|pre)\b/u;

/** Read-only / self-gated tools that must stay available while plan mode is active. */
const PLAN_MODE_UNRESTRICTED = new Set([
  "webSearch",
  "xSearch",
  "readUrl",
  "readFile",
  "readWorkspaceFile",
  "listWorkspaceDir",
  "grepWorkspace",
  "listSkills",
  "readSkill",
  "bash",
  "runWorkspaceCommand",
  "todo"
]);

/** Block MCP and mutating tools while plan mode is active. */
export function wrapToolsForPlanMode(tools: ToolSet, getPlanMode?: GetPlanMode): ToolSet {
  if (!getPlanMode) return tools;
  const wrapped: ToolSet = {};
  for (const [name, entry] of Object.entries(tools)) {
    if (!entry || typeof entry !== "object" || !("execute" in entry) || typeof entry.execute !== "function") {
      wrapped[name] = entry;
      continue;
    }
    if (PLAN_MODE_UNRESTRICTED.has(name)) {
      wrapped[name] = entry;
      continue;
    }
    const original = entry.execute;
    wrapped[name] = {
      ...entry,
      execute: async (input, options) => {
        if (getPlanMode()) return PLAN_MODE_MSG;
        return original(input, options);
      }
    };
  }
  return wrapped;
}

/** Bash commands allowed during plan mode (exploration only). */
export function isReadOnlyBashCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  if (/[\r\n]/u.test(c)) return false;
  if (/[;&|`$<>]|\$\(/u.test(c)) return false;
  if (BASH_PRIVILEGED_FLAGS.test(c)) return false;
  if (!bashPathsStayInCwd(c)) return false;
  const parts = c.split(/\s+/u);
  const bin = parts[0]?.replace(/^\.\//u, "") ?? "";
  if (bin === "find") return !FIND_MUTATING_FLAGS.test(c);
  const readOnlyBins = new Set(["ls", "cat", "head", "tail", "wc", "grep", "rg", "pwd", "file", "stat", "tree", "which"]);
  if (readOnlyBins.has(bin)) return true;
  if (bin === "git") {
    if (/\s-(?:c|config)\b/u.test(c)) return false;
    const sub = parts[1] ?? "";
    return ["status", "log", "diff", "show", "rev-parse", "describe", "shortlog"].includes(sub);
  }
  return false;
}

function planModeActive(getPlanMode?: GetPlanMode): boolean {
  return getPlanMode?.() ?? false;
}

async function listWorkspaceRecursive(root: string, limit: number): Promise<string[]> {
  const results: string[] = [];
  const queue = [root];
  while (queue.length > 0 && results.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= limit) break;
      const full = join(dir, entry.name);
      results.push(full);
      if (entry.isDirectory()) queue.push(full);
    }
  }
  return results;
}

/** Plan mode: workspace mutations blocked; harness writes limited to plan.md. */
function planModeBlocksWrite(
  getPlanMode: GetPlanMode | undefined,
  scope: "run" | "workspace",
  harnessName: string | null
): string | null {
  if (!planModeActive(getPlanMode)) return null;
  if (scope === "workspace") return PLAN_MODE_MSG;
  if (harnessName === "plan.md") return null;
  return PLAN_MODE_MSG;
}

function planModeBlocksEdit(
  getPlanMode: GetPlanMode | undefined,
  scope: "run" | "workspace",
  harnessName: string | null
): string | null {
  if (!planModeActive(getPlanMode)) return null;
  if (scope === "workspace") return PLAN_MODE_MSG;
  if (harnessName === "plan.md") return null;
  return PLAN_MODE_MSG;
}

export function createResearchTools(
  runPath: string,
  config: SciraConfig,
  onApprovalRequired?: ApprovalCallback,
  workspacePath?: string,
  getPlanMode?: GetPlanMode
) {
  /** Gate a tool behind user approval unless approvalMode is "auto". */
  async function gate(toolName: string, description: string): Promise<boolean> {
    if (config.approvalMode === "auto" || !onApprovalRequired) return true;
    return onApprovalRequired(toolName, description);
  }

  const claimsPath = join(runPath, "claims.jsonl");
  const filePathHint = workspacePath
    ? "Project source paths (src/foo.ts, package.json, …) are relative to the project root. Harness files (plan.md, notes.md, report.md, sources.jsonl) live in the run directory — use those bare names."
    : "Paths are relative to the run directory.";

  const runBash = tool({
    description:
      "Run a shell command inside the run harness directory (.scira/runs/…). Use for grepping notes.md, listing run artifacts, etc. Returns combined stdout/stderr.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute."),
      timeoutMs: z.number().int().positive().max(120000).optional().describe("Optional timeout in ms (default 60000).")
    }),
    execute: async ({ command, timeoutMs }) => {
      if (planModeActive(getPlanMode) && !isReadOnlyBashCommand(command)) return PLAN_MODE_MSG;
      if (!await gate("bash", command)) return "Command rejected by user.";
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
  });

  return {
    ...(workspacePath ? { runBash } : { bash: runBash }),

    writeFile: tool({
      description:
        `Create or overwrite a file. ${filePathHint}`,
      inputSchema: z.object({
        path: z.string().describe("File path."),
        content: z.string().describe("Full file content to write.")
      }),
      execute: async ({ path, content }) => {
        const resolved = resolveToolPath(runPath, workspacePath, path);
        const harnessName = resolved.scope === "run" ? harnessBasename(resolved.displayPath) : null;
        if (harnessName === "background-tasks.json") {
          return "background-tasks.json is managed by bash background tasks. Do not write it directly.";
        }
        const blocked = planModeBlocksWrite(getPlanMode, resolved.scope, harnessName);
        if (blocked) return blocked;
        const needsApproval =
          resolved.scope === "workspace"
          || harnessName === "plan.md"
          || harnessName === "report.md";
        if (needsApproval) {
          let description: string;
          if (harnessName === "report.md" && resolved.scope === "run") {
            const existing = await readFile(resolved.abs, "utf8").catch(() => "");
            const parts = diffLines(existing, content);
            const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
            const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
            const diffPreview = parts
              .filter((p) => p.added || p.removed)
              .flatMap((p) => p.value.split("\n").filter(Boolean).map((l) => `${p.added ? "+" : "-"} ${l}`))
              .slice(0, 20)
              .join("\n");
            description = `report.md  (+${added} / -${removed} lines)\n\n${diffPreview}`;
          } else if (resolved.scope === "workspace") {
            const preview = content.length > 800 ? `${content.slice(0, 800)}\n…[${content.length} total chars]` : content;
            description = `Write to ${resolved.displayPath}:\n\n${preview}`;
          } else {
            description = `${path}\n\n${content.length > 600 ? `${content.slice(0, 600)}\n…` : content}`;
          }
          if (!await gate("writeFile", description)) return `Write to ${resolved.displayPath} rejected by user.`;
        }
        await mkdir(dirname(resolved.abs), { recursive: true });
        await writeFile(resolved.abs, content);
        const eventType = harnessName === "report.md" ? "report.updated" : harnessName === "plan.md" ? "plan.updated" : "file.written";
        await logEvent(runPath, eventType, { path: resolved.displayPath, scope: resolved.scope, chars: content.length });
        const where = resolved.scope === "workspace" ? "workspace" : "run";
        return `Wrote ${content.length} chars to ${resolved.displayPath} (${where})`;
      }
    }),

    editFile: tool({
      description:
        `Replace an exact string in an existing file. ${filePathHint} The oldString must match exactly and be unique.`,
      inputSchema: z.object({
        path: z.string().describe("File path."),
        oldString: z.string().describe("Exact text to replace."),
        newString: z.string().describe("Replacement text.")
      }),
      execute: async ({ path, oldString, newString }) => {
        const resolved = resolveToolPath(runPath, workspacePath, path);
        const harnessName = resolved.scope === "run" ? harnessBasename(resolved.displayPath) : null;
        const blocked = planModeBlocksEdit(getPlanMode, resolved.scope, harnessName);
        if (blocked) return blocked;
        const current = await readFile(resolved.abs, "utf8");
        const occurrences = current.split(oldString).length - 1;
        if (occurrences === 0) {
          return `No match for the given oldString in ${resolved.displayPath}. No changes made.`;
        }
        if (occurrences > 1) {
          return `oldString matched ${occurrences} times in ${resolved.displayPath}; provide more context to make it unique. No changes made.`;
        }
        if (resolved.scope === "workspace") {
          const diff = diffLines(current, current.replace(oldString, newString));
          const preview = diff
            .filter((p) => p.added || p.removed)
            .flatMap((p) => p.value.split("\n").filter(Boolean).map((l) => `${p.added ? "+" : "-"} ${l}`))
            .slice(0, 15)
            .join("\n");
          if (!await gate("editFile", `Edit ${resolved.displayPath}:\n\n${preview}`)) {
            return `Edit to ${resolved.displayPath} rejected by user.`;
          }
        }
        await writeFile(resolved.abs, current.replace(oldString, newString));
        await logEvent(runPath, "file.edited", { path: resolved.displayPath, scope: resolved.scope });
        return `Edited ${resolved.displayPath}`;
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
        if (planModeActive(getPlanMode)) return PLAN_MODE_MSG;
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
        if (planModeActive(getPlanMode)) return PLAN_MODE_MSG;
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
      description: `Read a file. ${filePathHint}`,
      inputSchema: z.object({
        path: z.string().describe("File path.")
      }),
      execute: async ({ path }) => {
        const resolved = resolveToolPath(runPath, workspacePath, path);
        return truncate(await readFile(resolved.abs, "utf8"));
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
        const resultCount = searches.reduce((n, s) => n + s.results.length, 0);
        const errors = searches.map((s) => s.error).filter((e): e is string => Boolean(e));
        await logEvent(runPath, "tool.search", { queries, resultCount, errors: errors.length > 0 ? errors : undefined });
        if (resultCount === 0 && errors.length > 0) {
          throw new Error(`Web search returned no results: ${errors.join(" | ")}`);
        }
        return JSON.stringify(
          searches.map((s) => ({
            query: s.query,
            ...(s.error ? { error: s.error } : {}),
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

    todo: createTodoTool(runPath),

    ...(process.env.XAI_API_KEY ? { xSearch: createXSearchTool(runPath) } : {}),

    ...(config.files ? createFileTools(runPath, config, onApprovalRequired, getPlanMode) : {})
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
  onEscalate?: EscalateCallback,
  workspacePath?: string,
  backgroundTasks?: BackgroundTaskManager,
  getPlanMode?: GetPlanMode
) {
  const all = createResearchTools(runPath, config, onApprovalRequired, workspacePath, getPlanMode);
  const coding = workspacePath
    ? createCodingTools(workspacePath, config, onApprovalRequired, backgroundTasks, runPath, getPlanMode)
    : {};
  async function gate(toolName: string, description: string): Promise<boolean> {
    if (config.approvalMode === "auto" || !onApprovalRequired) return true;
    return onApprovalRequired(toolName, description);
  }
  return {
    webSearch: all.webSearch,
    ...(all.xSearch ? { xSearch: all.xSearch } : {}),
    readUrl: all.readUrl,
    readFile: all.readFile,
    writeFile: all.writeFile,
    editFile: all.editFile,
    todo: all.todo,
    ...coding,
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
          return "User declined escalation. Answer the question concisely now using your available read/search tools — do not ask to escalate again.";
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
  onApprovalRequired?: ApprovalCallback,
  backgroundTasks?: BackgroundTaskManager,
  runPath?: string,
  getPlanMode?: GetPlanMode
) {
  async function gate(toolName: string, description: string): Promise<boolean> {
    if (config.approvalMode === "auto" || !onApprovalRequired) return true;
    return onApprovalRequired(toolName, description);
  }

  function resolveWorkspacePath(candidate: string): string {
    return resolveInsideWorkspace(workspacePath, candidate);
  }

  return {
    listWorkspaceDir: tool({
      description: "List files and directories in the project workspace.",
      inputSchema: z.object({
        path: z.string().describe("Directory path (absolute or relative to workspace root)."),
        recursive: z.boolean().optional().describe("Recursively list subdirectories (default false).")
      }),
      execute: async ({ path, recursive }) => {
        const abs = resolveWorkspacePath(path);
        try {
          if (recursive) {
            const lines = await listWorkspaceRecursive(abs, 200);
            return truncate(lines.join("\n") || "(empty)");
          }
          const { stdout } = await execFileAsync("ls", ["-lah", abs], { maxBuffer: 5 * 1024 * 1024 });
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
        const args = ["-rn"];
        if (filePattern) args.push(`--include=${filePattern}`);
        args.push("-E", pattern, "--", searchPath);
        try {
          const { stdout } = await execFileAsync("grep", args, { maxBuffer: 5 * 1024 * 1024 });
          const lines = stdout.trim().split("\n").filter(Boolean).slice(0, 100);
          const result = lines.join("\n") || `No matches found for pattern: ${pattern}`;
          return truncate(result);
        } catch (error) {
          const err = error as { stdout?: string; code?: string };
          if (err.code === "1") return `No matches found for pattern: ${pattern}`;
          const result = err.stdout?.trim() || `No matches found for pattern: ${pattern}`;
          return truncate(result);
        }
      }
    }),

    bash: tool({
      description:
        "Run shell commands in the workspace. " +
        "Actions: run (foreground, default), background (start a long-running process like a dev server), list (show background tasks), output (read task logs), kill (stop a background task). " +
        "Use background for servers and watchers; the task id and output remain available across turns.",
      inputSchema: z.object({
        action: z
          .enum(["run", "background", "list", "output", "kill"])
          .optional()
          .describe("run=foreground (default), background=spawn detached, list/output/kill manage background tasks."),
        command: z.string().optional().describe("Shell command for run or background."),
        taskId: z.string().optional().describe("Task id for output or kill."),
        cwd: z.string().optional().describe("Working directory (default: workspace root)."),
        timeoutMs: z.number().int().positive().max(300000).optional().describe("Timeout for foreground run (default 60000)."),
        tailLines: z.number().int().positive().max(200).optional().describe("Lines of output for action=output (default 50).")
      }),
      execute: async ({ action, command, taskId, cwd, timeoutMs, tailLines }) => {
        const act = action ?? "run";
        const workDir = cwd ? resolveWorkspacePath(cwd) : workspacePath;

        if (act === "list") {
          if (!backgroundTasks) return "No background task manager available.";
          const tasks = await backgroundTasks.list();
          if (tasks.length === 0) return "No background tasks.";
          return tasks
            .map((t) => `${t.id} [${t.status}] pid=${t.pid} ${t.command}`)
            .join("\n");
        }

        if (act === "output") {
          if (!backgroundTasks) return "No background task manager available.";
          if (!taskId) return "output requires taskId.";
          return truncate(await backgroundTasks.getOutput(taskId, tailLines ?? 50));
        }

        if (act === "kill") {
          if (!backgroundTasks) return "No background task manager available.";
          if (!taskId) return "kill requires taskId.";
          const task = await backgroundTasks.getTask(taskId);
          if (!task) return `Task "${taskId}" not found.`;
          const killPreview = [
            "Kill background task?",
            "",
            `ID: ${task.id}`,
            `PID: ${task.pid}`,
            `CWD: ${task.cwd}`,
            `Command: ${task.command}`
          ].join("\n");
          if (!await gate("bash", killPreview)) return "Kill rejected by user.";
          return await backgroundTasks.kill(taskId);
        }

        if (!command) return `${act} requires command.`;

        if (planModeActive(getPlanMode) && act === "background") return PLAN_MODE_MSG;
        if (planModeActive(getPlanMode) && act === "run" && !isReadOnlyBashCommand(command)) return PLAN_MODE_MSG;

        if (act === "background") {
          if (!backgroundTasks) return "Background tasks not available in this session.";
          if (!await gate("bash", `Start background in ${relative(workspacePath, workDir) || "."}:\n\n${command}`)) {
            return "Command rejected by user.";
          }
          const task = await backgroundTasks.spawn(command, workDir);
          if (runPath) await logEvent(runPath, "tool.bash.background", { taskId: task.id, command });
          return `Started background task ${task.id} (pid ${task.pid}): ${command}\nUse bash action=output taskId=${task.id} to read output.`;
        }

        if (!await gate("bash", `Run in ${relative(workspacePath, workDir) || "."}:\n\n${command}`)) {
          return "Command rejected by user.";
        }
        if (runPath) await logEvent(runPath, "tool.bash", { command, cwd: workDir });
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
