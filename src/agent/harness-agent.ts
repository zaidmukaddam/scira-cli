import { promises as fs } from "node:fs";
import path from "node:path";
import { ToolLoopAgent, type ModelMessage, type ToolSet } from "ai";
import { HarnessAgent, type HarnessAgentSession, type HarnessAgentPermissionMode, type HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import { SciraConfig } from "../types/index.js";
import { type HarnessProvider } from "../providers/llm/registry.js";
import { createLocalSandbox } from "../providers/harness/local-sandbox.js";
import { createResearchTools } from "../tools/agent-tools.js";

/** Resolve a promise but never hang the caller longer than `ms`. Clears the timer when settled so it can't keep the event loop alive (e.g. delaying quit). */
function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(timer)),
    timeout,
  ]);
}

type StreamArgs = Parameters<ToolLoopAgent<never, ToolSet>["stream"]>[0];
type StreamReturn = ReturnType<ToolLoopAgent<never, ToolSet>["stream"]>;

function permissionModeFor(provider: HarnessProvider, config: SciraConfig): HarnessAgentPermissionMode {
  // Codex has no built-in tool-approval flow; it only runs under allow-all.
  if (provider === "codex") return "allow-all";
  switch (config.approvalMode) {
    case "manual": return "allow-reads";
    case "auto": return "allow-all";
    default: return "allow-edits"; // "suggest"
  }
}

// With no explicit `auth`, the adapters auto-detect credentials from the host
// env (gateway key first, then provider key / base URL / org). To force the
// bundled CLI onto the user's local OAuth login instead, we strip every env var
// those resolvers read or emit — covering both the host-inherited copy and the
// adapter-injected copy (the local sandbox strips after merging the spawn env).
const GATEWAY_ENV = ["AI_GATEWAY_API_KEY", "AI_GATEWAY_BASE_URL"];
const STRIP_ENV: Record<HarnessProvider, string[]> = {
  "claude-code": [...GATEWAY_ENV, "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"],
  codex: [...GATEWAY_ENV, "OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORGANIZATION", "OPENAI_PROJECT"]
};

function buildAgent(provider: HarnessProvider, config: SciraConfig, workspacePath: string, instructions: string, runPath: string): HarnessAgent {
  const sandbox = createLocalSandbox({ rootDir: workspacePath, stripEnv: STRIP_ENV[provider] });
  const permissionMode = permissionModeFor(provider, config);
  const model = config.model.trim() || undefined; // empty = CLI default
  // Give the harness Scira's own multi-query web search + page reader as host
  // tools, so it grounds answers through our search pipeline instead of the
  // CLI's built-in web tools.
  const { webSearch, readUrl } = createResearchTools(runPath, config, undefined, workspacePath, () => false);
  // Use a non-colliding name. Claude Code ships a built-in `webSearch` (single
  // query); naming ours the same lets the built-in shadow it, so the model ends
  // up doing single-query searches. `multiWebSearch` can't be shadowed.
  // Cast bridges the project's `ai` Tool type to the harness's bundled-`ai`
  // ToolSet (same runtime shape, different package versions).
  const tools = { multiWebSearch: webSearch, readUrl } as unknown as Record<string, never>;
  // Positive, authoritative steering pointing at the unique tool name.
  const fullInstructions = `${instructions}\n\nWEB ACCESS: For any web search use the \`multiWebSearch\` tool and pass 3-5 query variations in a single call (it searches them in parallel). Use \`readUrl\` to read a specific page. These are your only web tools.`;
  // No `auth`: the bundled CLI authenticates with the user's local login
  // (`claude login` → ~/.claude, `codex login` → ~/.codex). We never pass an
  // API key, so a Pro/Max/ChatGPT subscription session is used as-is.
  const harness = provider === "claude-code"
    ? createClaudeCode({
        model,
        thinking: config.harness.thinking,
        maxTurns: config.harness.maxTurns
      })
    : createCodex({
        model,
        reasoningEffort: config.harness.reasoningEffort,
        // Built-in harness web search is always disabled.
        webSearch: false
      });
  return new HarnessAgent({ harness, sandbox, permissionMode, instructions: fullInstructions, tools });
}

type SessionEntry = { agent: HarnessAgent; session: HarnessAgentSession; provider: HarnessProvider; fingerprint: string };

/** Settings that, if changed, require rebuilding the session (not just the prompt). */
function settingsFingerprint(provider: HarnessProvider, config: SciraConfig): string {
  return JSON.stringify([provider, config.model, config.approvalMode, config.harness]);
}

// One live harness session per run directory, reused across turns so the
// underlying CLI keeps its native conversation/workspace state.
const sessions = new Map<string, SessionEntry>();

function messageText(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function lastUserText(args: StreamArgs): string {
  const { prompt, messages } = args as { prompt?: unknown; messages?: ModelMessage[] };
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messageText(messages[i].content);
    }
  }
  return "";
}

// --- Cross-process resume state, persisted per run directory ---

type PersistedState = { provider: HarnessProvider; fingerprint: string; state: HarnessAgentResumeSessionState };

function stateFile(runPath: string): string {
  return path.join(runPath, "harness-state.json");
}

async function readPersistedState(runPath: string): Promise<PersistedState | null> {
  try {
    return JSON.parse(await fs.readFile(stateFile(runPath), "utf8")) as PersistedState;
  } catch {
    return null;
  }
}

async function clearPersistedState(runPath: string): Promise<void> {
  await fs.rm(stateFile(runPath), { force: true }).catch(() => {});
}

async function acquireSession(
  runPath: string,
  provider: HarnessProvider,
  config: SciraConfig,
  workspacePath: string,
  instructions: string,
  abortSignal?: AbortSignal
): Promise<SessionEntry> {
  const fingerprint = settingsFingerprint(provider, config);
  const existing = sessions.get(runPath);
  // Reuse only if provider/model/approval/harness settings are unchanged.
  if (existing && existing.fingerprint === fingerprint) return existing;
  if (existing) {
    await withTimeout(existing.session.destroy(), 5000).catch(() => {});
    sessions.delete(runPath);
  }

  const agent = buildAgent(provider, config, workspacePath, instructions, runPath);

  // Try to resume the run's prior harness session (across process restarts).
  // Only when the persisted settings match; any failure falls back to fresh.
  let session: HarnessAgentSession | undefined;
  const persisted = await readPersistedState(runPath);
  if (persisted && persisted.provider === provider && persisted.fingerprint === fingerprint) {
    try {
      session = await agent.createSession({ sessionId: runPath, resumeFrom: persisted.state, abortSignal });
    } catch {
      await clearPersistedState(runPath);
      session = undefined;
    }
  }
  if (!session) session = await agent.createSession({ sessionId: runPath, abortSignal });

  const entry: SessionEntry = { agent, session, provider, fingerprint };
  sessions.set(runPath, entry);
  return entry;
}

/**
 * Stop a live session, persisting its resume state so the run can continue in a
 * future process. Falls back to destroy() (and clears stale state) on failure.
 */
async function stopAndPersist(runPath: string, entry: SessionEntry): Promise<void> {
  try {
    // Bounded so a wedged bridge can't hang TUI teardown.
    const state = await withTimeout(entry.session.stop(), 5000);
    if (state === undefined) throw new Error("stop() timed out");
    const payload: PersistedState = { provider: entry.provider, fingerprint: entry.fingerprint, state };
    await fs.writeFile(stateFile(runPath), JSON.stringify(payload), "utf8");
  } catch {
    await withTimeout(entry.session.destroy(), 5000).catch(() => {});
    await clearPersistedState(runPath);
  }
}

/**
 * A ToolLoopAgent-shaped wrapper around a local harness session. `stream()`
 * matches the subset the TUI's `consume()` loop uses, so harness providers drop
 * into the same turn pipeline as the LLM providers.
 */
class HarnessChatAgent {
  constructor(
    private readonly runPath: string,
    private readonly provider: HarnessProvider,
    private readonly config: SciraConfig,
    private readonly workspacePath: string,
    private readonly instructions: string
  ) {}

  async stream(options: StreamArgs): StreamReturn {
    const abortSignal = (options as { abortSignal?: AbortSignal }).abortSignal;
    const { agent, session } = await acquireSession(this.runPath, this.provider, this.config, this.workspacePath, this.instructions, abortSignal);
    const prompt = lastUserText(options);
    const result = await agent.stream({ session, prompt, abortSignal });
    return result as unknown as Awaited<StreamReturn>;
  }
}

export type HarnessBundle = {
  agent: Pick<ToolLoopAgent<never, ToolSet>, "stream">;
  close: () => Promise<void>;
};

/**
 * Build a harness-backed chat bundle for `config.llmProvider` (claude-code /
 * codex). The session persists across turns; `close()` is a no-op so the native
 * CLI state survives. Use {@link closeHarnessSession} on `/new` or teardown.
 */
export function createHarnessBundle(opts: {
  runPath: string;
  provider: HarnessProvider;
  config: SciraConfig;
  workspacePath: string;
  instructions: string;
}): HarnessBundle {
  const agent = new HarnessChatAgent(opts.runPath, opts.provider, opts.config, opts.workspacePath, opts.instructions);
  return { agent, close: async () => {} };
}

/** Stop a run's harness session and persist its resume state. No-op if none. */
export async function closeHarnessSession(runPath: string): Promise<void> {
  const entry = sessions.get(runPath);
  if (!entry) return;
  sessions.delete(runPath);
  await stopAndPersist(runPath, entry);
}

/** Stop every live harness session, persisting resume state. Intended for process shutdown. */
export async function closeAllHarnessSessions(): Promise<void> {
  const entries = [...sessions.entries()];
  sessions.clear();
  await Promise.all(entries.map(([runPath, entry]) => stopAndPersist(runPath, entry)));
}
