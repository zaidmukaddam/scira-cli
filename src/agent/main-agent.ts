import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ToolLoopAgent, isLoopFinished, type ToolSet } from "ai";
import { Spinner } from "picospinner";
import { SciraConfig } from "../types/index.js";
import { getLanguageModel, requireLlmKeys, isHarnessProvider } from "../providers/llm/registry.js";
import { createHarnessBundle } from "./harness-agent.js";
import { createResearchTools, createOneShotTools, createCodingTools, wrapToolsForPlanMode, ApprovalCallback, EscalateCallback, type GetPlanMode } from "../tools/agent-tools.js";
import { SKILL_CATALOG } from "./skills.js";
import { createMcpBridge } from "../tools/mcp-bridge.js";
import { type BackgroundTaskManager, createBackgroundTaskManager } from "../tools/background-tasks.js";

/**
 * Minimal streaming surface the TUI's `consume()` loop drives — exactly the
 * `stream` method of `ToolLoopAgent`. The harness chat adapter implements the
 * same signature, so both kinds of bundle are interchangeable here.
 */
export type StreamingChatAgent = Pick<ToolLoopAgent<never, ToolSet>, "stream">;

export type AgentBundle = {
  agent: StreamingChatAgent;
  close: () => Promise<void>;
};

export type AgentOptions = {
  workspacePath?: string;
  /** @deprecated use getPlanMode for live toggles during a turn */
  planMode?: boolean;
  getPlanMode?: GetPlanMode;
  backgroundTasks?: BackgroundTaskManager;
};

function resolvePlanMode(options: AgentOptions): boolean {
  return options.getPlanMode ? options.getPlanMode() : (options.planMode ?? false);
}

function planModeBlock(active: boolean): string {
  if (!active) return "";
  return `

PLAN MODE (active):
You are in plan mode. Explore and plan before making changes.
- Use readFile, grepWorkspace, listWorkspaceDir, webSearch, and readUrl to understand the task
- Use the todo tool to break work into trackable steps (create, mark in_progress when starting, completed when done)
- Write or update plan.md with your approach (harness file, bare name)
- Do NOT use writeFile or editFile except plan.md, and do not use bash action=run/background
- Do NOT use MCP or browser tools while plan mode is active
- Read-only bash is OK: ls, cat, git status, git log, git diff, find, grep (workspace-relative paths only)
- When the plan is ready, summarize it and tell the user to type /plan to exit plan mode and begin execution`;
}

function instructions(goal: string, config: SciraConfig, options: AgentOptions = {}): string {
  const { workspacePath } = options;
  const planMode = resolvePlanMode(options);
  const now = new Date();
  const temporalContext = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const citationRule = config.citationPolicy === "strict"
    ? "Citation policy (strict): every non-trivial statement in report.md MUST cite a source ID. Do not include any uncited claims — move anything you cannot cite to an Open Questions section."
    : "Citation policy (balanced): cite source IDs for all major claims; minor background context may be uncited but must not be overstated.";
  
  const codingSection = workspacePath ? `

PROJECT LAYOUT:
- Project root (codebase): ${workspacePath}
- Run harness (.scira/runs/…): plan.md, notes.md, report.md, sources.jsonl, claims.jsonl, todos.json

FILE TOOLS:
- readFile / writeFile / editFile route automatically:
  - Harness files by bare name: plan.md, notes.md, report.md, sources.jsonl → stored under .scira/runs/
  - Everything else (src/…, package.json, …) → project root
- Never write source code under .scira. Never put harness files at the project root.

CODING TOOLS:
- listWorkspaceDir, grepWorkspace: explore the codebase
- bash: shell in the project root. action=run (default), action=background for dev servers, action=list/output/kill for background tasks
- runBash: shell in the run harness directory for grepping or listing harness artifacts (notes.md, sources.jsonl, etc.)
- todo: structured task list (create, edit, mark, remove, rewrite, list)

When the task involves code:
- Use todo to track multi-step work
- Use grepWorkspace and readFile to understand the codebase
- Use editFile for precise changes, writeFile for new source files (paths like src/foo.ts)
- Run tests/builds with bash; use bash action=background for servers then action=output to check logs
- Match existing code style and patterns` : "";

  return `You are Scira AI CLI, made by Zaid Mukaddam, an autonomous research ${workspacePath ? "and coding " : ""}agent.${workspacePath ? " Source code lives at the project root; harness artifacts live under .scira/runs/." : " You operate inside a single run directory on the user's machine."}

Your goal:
${goal}

Temporal context:
Today is ${temporalContext}. Treat dates relative to this date: distinguish past, current, and future events; verify date-sensitive claims with sources instead of relying on model memory.

${citationRule}
Gather at most ${config.maxSources} high-quality sources — prefer depth and primary sources over volume.

You have shell, file, search, skill${config.files ? ", and local files" : ""}${workspacePath ? ", and workspace coding" : ""} tools. Work like an engineer running a research harness:${config.files ? `\n\nLocal files directory (${config.files.dir}):\nUse listFiles / searchFiles to enumerate documents, getFile to read them, and fileExists to confirm a file is present. Prefer local files as primary sources before falling back to the web. moveFile and deleteFile require user approval.` : ""}${codingSection}
0. Bootstrap: these built-in research skills are available — pull the relevant ones with readSkill before you begin. This is mandatory — skills contain concrete tactics for search, source quality, claim verification, and report writing.
${SKILL_CATALOG}
1. Plan: write a short plan.md outlining your approach (use the research-plan skill as a template).
2. Gather: use webSearch with 3-5 parallel query variations to find real, citable sources, then readUrl to read the most relevant ones. Use xSearch for current reactions, announcements, and real-time opinions on X/Twitter (requires XAI_API_KEY). Record findings in notes.md as you go. Never invent sources or URLs.
3. Extract claims: after reading each source, use createClaim to record significant findings. Assign a short ID like claim_001, set confidence, and link source IDs.
4. Verify: once all claims are recorded, use verifyClaim to update each claim's status (verified / weak / contradicted / needs_review). Be honest — flag weak or vendor-only evidence.
5. Record sources: write all sources you actually used to sources.jsonl (include the snapshotPath reported by readUrl for each one) — STRICT JSONL rules: one compact JSON object per line, no literal newlines inside string values, no trailing commas. Use writeFile to write the entire file at once.
6. Synthesize: write a clear, well-structured report.md grounded in verified claims (use the report-structure skill for the section layout). Cite source IDs inline. Mark vendor/marketing claims as such.
7. Finish: when report.md is complete and accurate, stop and give the user a 2-4 sentence summary of what you found.

Rules:
- Prefer primary sources. Cross-check important claims across multiple sources.
${workspacePath ? "- Harness files (plan.md, notes.md, report.md, sources.jsonl) go in the run directory. All source code changes go under the project root." : "- Keep files inside the run directory (paths are relative to it)."}
- Be terse in your narration between tool calls — say what you're doing and why in one line.
- Do not claim something is done before you have actually written report.md.
- Re-read a skill with readSkill any time you are uncertain how to proceed.${planModeBlock(planMode ?? false)}`;
}

function devtoolsInstructionsBlock(toolNames: string[]): string {
  if (toolNames.length === 0) return "";
  return `

Browser tools (Chrome DevTools MCP)
You have access to a real Chromium browser via Chrome DevTools MCP. The available tool names are:
${toolNames.map((n) => `  - ${n}`).join("\n")}

DevTools is not only for debugging. Treat it as a research evidence tool for rendered, interactive, current, or runtime-dependent web sources. The built-in skill "browser-research" explains the workflow; read it with readSkill before using DevTools in a full research run.

These tools drive a live browser session and roughly cover four capabilities (exact names depend on the MCP server):
  - Navigation & input: open URLs, click, type, fill forms, scroll, wait for selectors, navigate history.
  - DOM & content: read the rendered DOM, accessibility tree, computed styles, and text content of elements.
  - Console & network: list console messages, errors, and network requests/responses (status, headers, timing, payloads).
  - Performance & diagnostics: capture screenshots, run performance traces / Core Web Vitals, and inspect runtime state.

When to use them (in priority order):
  1. The research question asks what a live page currently shows: pricing, product availability, UI copy, feature lists, status pages, rankings, maps, app-store pages, dashboards, search pages, or docs portals.
  2. The page is JS-heavy, gated, paginated, tabbed, filtered, infinite-scroll, or \`readUrl\` returns empty/garbled/incomplete text.
  3. The claim depends on runtime behavior — redirects, loaded API payloads, console errors, network calls, client-rendered data, layout, screenshots, or performance.
  4. You need to verify something only visible after interaction: clicking tabs, expanding accordions, selecting filters, scrolling, entering public search terms, or opening a modal.
  5. The user explicitly asks to inspect Chrome/browser/devtools/live page/screenshot/console/network/rendered page behavior.

When NOT to use them:
  - For static articles, papers, docs, blog posts, or anything \`webSearch\` + \`readUrl\` already handles cleanly.
  - To "browse around" without a concrete claim or hypothesis to validate — these tools are slow and expensive.

Rules for browser tools:
  - State the hypothesis or claim you are validating in one line before calling a browser tool.
  - Prefer the smallest sequence of calls that resolves the question; close/navigate away when done.
  - Record browser observations in notes.md with URL, access time, observed text/state, and interaction steps.
  - Treat DOM/screenshot/console/network output as evidence for what the page showed at access time: cite the URL you observed it on, and record findings as regular claims with sourceIds pointing to that URL.
  - Browser observations are primary evidence for page state but not independent corroboration; cross-check important factual claims with separate sources.
  - Never paste secrets or credentials into the browser.`;
}

export async function createResearchAgent(
  runPath: string,
  goal: string,
  config: SciraConfig,
  onApprovalRequired?: ApprovalCallback,
  options: AgentOptions = {}
): Promise<AgentBundle> {
  requireLlmKeys(config);
  if (isHarnessProvider(config.llmProvider)) {
    return createHarnessBundle({
      runPath,
      provider: config.llmProvider,
      config,
      workspacePath: options.workspacePath ?? process.cwd(),
      instructions: instructions(goal, config, options)
    });
  }
  const bridge = await createMcpBridge(config);
  const getPlanMode = options.getPlanMode ?? (() => options.planMode ?? false);
  const researchTools = createResearchTools(runPath, config, onApprovalRequired, options.workspacePath, getPlanMode);
  const codingTools = options.workspacePath
    ? createCodingTools(options.workspacePath, config, onApprovalRequired, options.backgroundTasks, runPath, getPlanMode)
    : {};
  const tools = { ...researchTools, ...codingTools, ...wrapToolsForPlanMode(bridge.tools, getPlanMode) } as ToolSet;
  const bgContext = options.backgroundTasks ? await options.backgroundTasks.formatContextForAgent() : "";
  const agent = new ToolLoopAgent({
    model: getLanguageModel(config),
    instructions: instructions(goal, config, options) + bgContext + devtoolsInstructionsBlock(bridge.toolNames),
    tools,
    stopWhen: isLoopFinished()
  });
  return { agent, close: bridge.close };
}

function oneShotInstructions(goal: string, hasDevtools: boolean, options: AgentOptions = {}): string {
  const { workspacePath } = options;
  const planMode = resolvePlanMode(options);
  const codingHint = workspacePath ? `

Project root: ${workspacePath}. readFile/writeFile/editFile route code paths to the project root; harness files (plan.md, notes.md, …) stay under .scira/runs/.
- listWorkspaceDir, grepWorkspace, bash (with background tasks), todo
Use them for code questions, debugging, and implementation tasks.` : "";
  const now = new Date();
  const temporalContext = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const browserHint = hasDevtools
    ? `

Browser-tool routing (IMPORTANT):
- If the user explicitly mentions "chrome", "browser", "devtools", "live page", "render", "screenshot", "console", or "network", you MUST use the devtools_* tools instead of webSearch/readUrl. Open the relevant URL with devtools_navigate_page (or devtools_new_page), then take a snapshot/screenshot or read console/network as needed.
- Use devtools_* for research questions about what a live/current/interactive page shows: pricing pages, product pages, status pages, app-store pages, docs portals, rankings, maps, client-rendered dashboards, or pages with tabs/filters/infinite scroll.
- Also use devtools_* when readUrl already failed or returned empty/garbled/incomplete text on a JS-heavy page.
- Otherwise, default to webSearch + readUrl as below.`
    : "";
  return `You are Scira in quick one-shot mode. Your job is to either answer the user's question directly OR escalate to the full research harness.

Temporal context:
Today is ${temporalContext}. Treat dates relative to this date — don't rely on model memory for date-sensitive facts.

Built-in research skills available in full research mode:
${SKILL_CATALOG}

Question:
${goal}

Step 1 — Decide the depth required:
- If the user asks for "research," "deep dive," "analysis," "comparison," "history," or anything that would benefit from >3 sources, structured claims, and a written report → you MUST call requestFullResearch first. Do NOT try to answer it yourself.
- If the user asks for research that depends on rendered/live/interactive web evidence and DevTools are available, prefer requestFullResearch so the full agent can read the browser-research skill, record observations, and create claims.
- If the user asks a simple, narrow, or factual question (e.g. "what is the capital of France?", "what time is it in Tokyo?") → answer directly with 1-2 web searches.
- When in doubt, escalate.${browserHint}

Step 2 — If you decide to answer directly:
- Default path: use webSearch (2-3 query variations) to find relevant, recent sources, then readUrl to read the best 1-2. Use xSearch to surface real-time X posts when the question involves public reactions, announcements, or social discussions.
- Browser path (only if the routing rules above triggered): use the devtools_* tools to drive a real Chromium session, then summarize what you observed (cite the URL you visited).
- Synthesize a clear, direct answer in a few short paragraphs. Cite sources inline as [title](url). Never invent sources or URLs.
- Do NOT write files, create claims, or produce a formal report — just answer in chat.${codingHint}${planModeBlock(planMode ?? false)}`;
}

export async function createOneShotAgent(
  runPath: string,
  goal: string,
  config: SciraConfig,
  onApprovalRequired?: ApprovalCallback,
  onEscalate?: EscalateCallback,
  options: AgentOptions = {}
): Promise<AgentBundle> {
  requireLlmKeys(config);
  if (isHarnessProvider(config.llmProvider)) {
    return createHarnessBundle({
      runPath,
      provider: config.llmProvider,
      config,
      workspacePath: options.workspacePath ?? process.cwd(),
      instructions: oneShotInstructions(goal, false, options)
    });
  }
  const bridge = await createMcpBridge(config);
  const getPlanMode = options.getPlanMode ?? (() => options.planMode ?? false);
  const tools = {
    ...createOneShotTools(
      runPath,
      config,
      onApprovalRequired,
      onEscalate,
      options.workspacePath,
      options.backgroundTasks,
      getPlanMode
    ),
    ...wrapToolsForPlanMode(bridge.tools, getPlanMode)
  } as ToolSet;
  const bgContext = options.backgroundTasks ? await options.backgroundTasks.formatContextForAgent() : "";
  const agent = new ToolLoopAgent({
    model: getLanguageModel(config),
    instructions: oneShotInstructions(goal, bridge.toolNames.length > 0, options) + bgContext + devtoolsInstructionsBlock(bridge.toolNames),
    tools,
    stopWhen: isLoopFinished()
  });
  return { agent, close: bridge.close };
}

/**
 * Run the research agent headlessly, streaming a compact timeline to stdout.
 */
export async function runResearchAgent(runPath: string, goal: string, config: SciraConfig, workspacePath?: string): Promise<void> {
  const options: AgentOptions = {
    ...(workspacePath
      ? {
          workspacePath,
          backgroundTasks: createBackgroundTaskManager(runPath, workspacePath)
        }
      : {}),
    getPlanMode: () => false
  };
  const spinner = new Spinner();

  const onApprovalRequired: ApprovalCallback = async (toolName, description) => {
    spinner.stop();
    console.error(`\n⚠  ${toolName} needs approval`);
    console.error("-".repeat(60));
    console.error(description.slice(0, 800));
    console.error("-".repeat(60));
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question("\nApprove? [y/N] ");
    rl.close();
    const approved = answer.trim().toLowerCase() === "y";
    if (approved) spinner.start();
    return approved;
  };

  const bundle = await createResearchAgent(runPath, goal, config, onApprovalRequired, options);
  try {
    const result = await bundle.agent.stream({ prompt: goal });

    for await (const part of result.fullStream) {
    if (part.type === "tool-call") {
      spinner.setText(`${CODING_ICONS[part.toolName] ?? TOOL_ICONS[part.toolName] ?? "•"} ${part.toolName}  ${summarize(part.input)}`);
      spinner.start();
    } else if (part.type === "tool-result") {
      spinner.succeed(`${part.toolName}`);
    } else if (part.type === "tool-error") {
      spinner.fail(`${part.toolName}  ${String((part as { error?: unknown }).error).slice(0, 80)}`);
    } else if (part.type === "reasoning-delta") {
      spinner.stop();
      // dim the model's reasoning so it's visually distinct from the answer
      process.stdout.write(`\x1b[2m${part.text}\x1b[22m`);
    } else if (part.type === "text-delta") {
      spinner.stop();
      process.stdout.write(part.text);
    } else if (part.type === "error") {
      spinner.fail(String((part as { error?: unknown }).error));
    }
    }

    spinner.stop();
    process.stdout.write("\n");
  } finally {
    await bundle.close();
  }
}

const TOOL_ICONS: Record<string, string> = {
  bash: "⌘",
  writeFile: "✎",
  editFile: "✎",
  readFile: "▤",
  createClaim: "◎",
  verifyClaim: "✓",
  webSearch: "⌕",
  xSearch: "𝕏",
  readUrl: "↗",
  listSkills: "★",
  readSkill: "★",
  listFiles: "▤",
  searchFiles: "⌕",
  getFile: "▤",
  fileExists: "▤",
  moveFile: "✎",
  deleteFile: "✗",
  todo: "☐"
};

function summarize(input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  if (obj.action && obj.action !== "run") {
    return `${obj.action}${obj.taskId ? ` ${obj.taskId}` : ""}`.slice(0, 100);
  }
  if (Array.isArray(obj.queries)) {
    const qs = obj.queries as string[];
    return (qs.slice(0, 2).join(" · ") + (qs.length > 2 ? ` +${qs.length - 2}` : "")).slice(0, 100);
  }
  return String(obj.command ?? obj.query ?? obj.url ?? obj.path ?? obj.key ?? obj.pattern ?? obj.source ?? obj.action ?? "").slice(0, 100);
}

const CODING_ICONS: Record<string, string> = {
  readWorkspaceFile: "▤",
  writeWorkspaceFile: "✎",
  editWorkspaceFile: "✎",
  listWorkspaceDir: "▤",
  grepWorkspace: "⌕"
};
