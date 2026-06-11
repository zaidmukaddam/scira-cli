import React, { useCallback, useRef } from "react";
import { readFile } from "node:fs/promises";
import { SciraConfig, RunState } from "../../../types/index.js";
import { createRun, getRunPaths, setRunTitle } from "../../../storage/run-store.js";
import { readJsonl } from "../../../storage/jsonl.js";
import { type Source, type Claim } from "../../../types/index.js";
import { type FeedItem, type Screen, type ModelUsage, type ApprovalPending } from "../types.js";
import { fmtDuration, fmtTokens, copyToClipboard } from "../lib/utils.js";
import { detachSubscriber, abortSession } from "../session-manager.js";
import { saveGlobalMcpConfig } from "../../../config/load-config.js";

export type SubmitStateOptions = {
  config: SciraConfig;
  currentRunPath: string | undefined;
  sessions: RunState[];
  selectedIdx: number;
  busy: boolean;
  usage: Record<string, ModelUsage>;
  pendingRerun: boolean;
};

export type SubmitRefOptions = {
  queuedPromptRef: React.RefObject<string | null>;
  conversationRef: React.RefObject<{ role: "user" | "assistant"; content: string }[]>;
  feedRef: React.RefObject<FeedItem[]>;
};

export type SubmitSetterOptions = {
  setApprovalPending: React.Dispatch<React.SetStateAction<ApprovalPending | null>>;
  setInputText: (text: string) => void;
  setCursorPos: (pos: number) => void;
  setInputHistory: React.Dispatch<React.SetStateAction<string[]>>;
  setHistoryIndex: (i: number) => void;
  setHelpOpen: (open: boolean) => void;
  setNotice: (text: string) => void;
  setBusy: (busy: boolean) => void;
  setScreen: (screen: Screen) => void;
  setFeed: React.Dispatch<React.SetStateAction<FeedItem[]>>;
  setRunState: React.Dispatch<React.SetStateAction<RunState | null>>;
  setPendingRerun: (pending: boolean) => void;
  setMode: (full: boolean) => void;
  setConfig: (next: SciraConfig) => void;
  setMcpOpen: (open: boolean) => void;
  setHeroHidden: (hidden: boolean) => void;
};

export type SubmitActionOptions = {
  pushFeed: (item: FeedItem) => void;
  refreshSessions: () => Promise<void>;
  openRun: (runPath: string, initialQuestion?: string) => Promise<void>;
  openMenu: (type: "model" | "provider" | "llm") => Promise<void>;
  handleSettings: (text: string) => Promise<string | null>;
  runTurn: (prompt: string) => Promise<void>;
  exit: () => void;
};

type SubmitOptions = {
  state: SubmitStateOptions;
  refs: SubmitRefOptions;
  setters: SubmitSetterOptions;
  actions: SubmitActionOptions;
};

export function useSubmit(o: SubmitOptions): {
  submitHome: (value: string) => Promise<void>;
  submitChat: (value: string) => void;
  stopTurn: () => void;
} {
  const { config, currentRunPath, sessions, selectedIdx, busy, usage, pendingRerun } = o.state;
  const { queuedPromptRef, conversationRef, feedRef } = o.refs;
  const {
    setApprovalPending, setInputText, setCursorPos, setInputHistory, setHistoryIndex, setHelpOpen,
    setNotice, setBusy, setScreen, setFeed, setRunState, setPendingRerun, setMode, setConfig, setMcpOpen,
    setHeroHidden,
  } = o.setters;
  const { pushFeed, refreshSessions, openRun, openMenu, handleSettings, runTurn, exit } = o.actions;

  const rerunConfirmRef = useRef(false);

  const abortTurn = useCallback(() => {
    queuedPromptRef.current = null;
    setApprovalPending((p) => { p?.resolve(false); return null; });
    if (currentRunPath) abortSession(currentRunPath);
  }, [currentRunPath, setApprovalPending]);

  const submitHome = useCallback(async (value: string) => {
    const text = value.trim();
    setInputText("");
    setCursorPos(0);
    if (!text) {
      const selected = sessions[selectedIdx];
      if (selected) void openRun(selected.path);
      return;
    }
    if (text === "q" || text === "/quit" || text === "/q") { exit(); return; }
    if (text === "/help") { setHelpOpen(true); return; }
    if (text === "/back" || text === "/new") { return; }
    if (text === "/home") { setHeroHidden(false); return; }
    if (text === "/model") { void openMenu("model"); return; }
    if (text === "/provider") { void openMenu("provider"); return; }
    if (text === "/llm") { void openMenu("llm"); return; }
    if (text === "/mcp" || text.startsWith("/mcp ")) {
      const sub = text.slice(5).trim();
      if (!sub || sub === "list") {
        setMcpOpen(true);
        return;
      }
      setNotice("Open a research session first to use /mcp enable/disable/add.");
      return;
    }
    if (text.startsWith("/")) {
      const result = await handleSettings(text);
      setNotice(result ?? `Unknown command "${text}". Try /model, /llm, /provider, /key, /keys, /help.`);
      return;
    }
    if (busy) { setNotice("Already starting a run…"); return; }
    setBusy(true);
    try {
      const run = await createRun(text, config);
      await refreshSessions();
      setBusy(false);
      void openRun(run.path, text);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }, [busy, config, exit, handleSettings, openMenu, openRun, refreshSessions, selectedIdx, sessions]);

  const stopTurn = useCallback(() => {
    queuedPromptRef.current = null;
    setApprovalPending((p) => { p?.resolve(false); return null; });
    if (currentRunPath) abortSession(currentRunPath);
    pushFeed({ kind: "status", text: "Stopped." });
    setBusy(false);
  }, [currentRunPath, pushFeed, setApprovalPending]);

  const submitChat = useCallback((value: string) => {
    if (!currentRunPath) return;
    const text = value.trim();
    if (!text) return;
    if (!text.startsWith("/")) {
      setInputHistory((h) => [...h.slice(-50), text]);
      setHistoryIndex(-1);
    }
    setInputText("");
    setCursorPos(0);

    if (text === "/quit" || text === "/q") { abortTurn(); exit(); return; }
    if (text === "/help") { setHelpOpen(true); return; }
    if (text === "/stop") { stopTurn(); return; }
    if (text === "/back" || text === "/new" || text === "/home") {
      if (currentRunPath) detachSubscriber(currentRunPath);
      setScreen("home");
      void refreshSessions();
      return;
    }
    if (text === "/model") { void openMenu("model"); return; }
    if (text === "/llm") { void openMenu("llm"); return; }
    if (text === "/provider") { void openMenu("provider"); return; }
    if (["/key", "/keys", "/llm", "/theme"].includes(text.split(/\s+/u)[0])) {
      void (async () => {
        const result = await handleSettings(text);
        if (result) pushFeed({ kind: "status", text: result });
      })();
      return;
    }
    if (text === "/report") {
      void (async () => {
        try {
          const report = await readFile(getRunPaths(currentRunPath).report, "utf8");
          pushFeed({ kind: "text", text: report });
        } catch {
          pushFeed({ kind: "status", text: "No report.md yet." });
        }
      })();
      return;
    }
    if (text === "/sources") {
      void (async () => {
        const sources = await readJsonl<Source>(getRunPaths(currentRunPath).sources).catch(() => []);
        if (sources.length === 0) { pushFeed({ kind: "status", text: "No sources recorded yet." }); return; }
        const lines = sources
          .map((s) => `- **${s.id}** [${s.title || s.url}](${s.url})${s.kind !== "unknown" ? ` — ${s.kind}` : ""}`)
          .join("\n");
        pushFeed({ kind: "text", text: `## Sources (${sources.length})\n\n${lines}` });
      })();
      return;
    }
    if (text === "/claims") {
      void (async () => {
        const claims = await readJsonl<Claim>(getRunPaths(currentRunPath).claims).catch(() => []);
        if (claims.length === 0) { pushFeed({ kind: "status", text: "No claims recorded yet." }); return; }
        const STATUS_ICON: Record<string, string> = {
          verified: "✓", weak: "~", contradicted: "✗", needs_review: "?", draft: "○"
        };
        const CONF_LABEL: Record<string, string> = { high: "high", medium: "med", low: "low" };
        const lines = claims.map((c) =>
          `- **${c.id}** [${CONF_LABEL[c.confidence] ?? c.confidence}] ${STATUS_ICON[c.status] ?? c.status}  ${c.text}`
        ).join("\n");
        pushFeed({ kind: "text", text: `## Claims (${claims.length})\n\n${lines}\n\nUse \`/why <id>\` to see full detail for a claim.` });
      })();
      return;
    }
    if (text.startsWith("/why ") || text === "/why") {
      const claimId = text.slice(5).trim();
      if (!claimId) { pushFeed({ kind: "status", text: "Usage: /why <claim-id>" }); return; }
      void (async () => {
        const claims = await readJsonl<Claim>(getRunPaths(currentRunPath).claims).catch(() => []);
        const claim = claims.find((c) => c.id === claimId || c.id.includes(claimId));
        if (!claim) {
          pushFeed({ kind: "status", text: `No claim found with id matching "${claimId}". Use /claims to list all.` });
          return;
        }
        const sourceList = claim.sourceIds.length > 0
          ? `\n\n**Sources:** ${claim.sourceIds.join(", ")}`
          : "";
        const reason = claim.reason ? `\n\n**Reason:** ${claim.reason}` : "";
        pushFeed({ kind: "text", text: `## Claim ${claim.id}\n\n${claim.text}\n\n**Status:** ${claim.status}  **Confidence:** ${claim.confidence}  **Created:** ${claim.createdAt}${reason}${sourceList}` });
      })();
      return;
    }
    if (text === "/mcp" || text.startsWith("/mcp ")) {
      const sub = text.slice(5).trim();
      void (async () => {
        const cfg = config;
        const dt = cfg.mcp.chromeDevtools;
        const servers = cfg.mcp.servers;

        if (!sub || sub === "list") {
          setMcpOpen(true);
          return;
        }

        if (sub === "enable chromeDevtools" || sub === "enable devtools") {
          const next: SciraConfig = { ...cfg, mcp: { ...cfg.mcp, chromeDevtools: { ...dt, enabled: true } } };
          setConfig(next);
          await saveGlobalMcpConfig(next.mcp);
          pushFeed({ kind: "status", text: "chromeDevtools MCP enabled. Restart the session to apply." });
          return;
        }
        if (sub === "disable chromeDevtools" || sub === "disable devtools") {
          const next: SciraConfig = { ...cfg, mcp: { ...cfg.mcp, chromeDevtools: { ...dt, enabled: false } } };
          setConfig(next);
          await saveGlobalMcpConfig(next.mcp);
          pushFeed({ kind: "status", text: "chromeDevtools MCP disabled." });
          return;
        }

        const enableMatch = sub.match(/^enable (.+)$/u);
        if (enableMatch) {
          const name = enableMatch[1].trim();
          const idx = servers.findIndex((s) => s.name === name);
          if (idx === -1) { pushFeed({ kind: "status", text: `No server named "${name}". Use /mcp list to see servers.` }); return; }
          const next: SciraConfig = { ...cfg, mcp: { ...cfg.mcp, servers: servers.map((s, i) => i === idx ? { ...s, enabled: true } : s) } };
          setConfig(next);
          await saveGlobalMcpConfig(next.mcp);
          pushFeed({ kind: "status", text: `"${name}" enabled. Restart the session to apply.` });
          return;
        }

        const disableMatch = sub.match(/^disable (.+)$/u);
        if (disableMatch) {
          const name = disableMatch[1].trim();
          const idx = servers.findIndex((s) => s.name === name);
          if (idx === -1) { pushFeed({ kind: "status", text: `No server named "${name}". Use /mcp list to see servers.` }); return; }
          const next: SciraConfig = { ...cfg, mcp: { ...cfg.mcp, servers: servers.map((s, i) => i === idx ? { ...s, enabled: false } : s) } };
          setConfig(next);
          await saveGlobalMcpConfig(next.mcp);
          pushFeed({ kind: "status", text: `"${name}" disabled.` });
          return;
        }

        const addMatch = sub.match(/^add (stdio|sse|http) (\S+) (.+)$/u);
        if (addMatch) {
          const transport = addMatch[1] as "stdio" | "sse" | "http";
          const name = addMatch[2];
          const rest = addMatch[3].trim();
          if (servers.some((s) => s.name === name)) {
            pushFeed({ kind: "status", text: `A server named "${name}" already exists. Use /mcp disable to disable it.` });
            return;
          }
          let newEntry: SciraConfig["mcp"]["servers"][number];
          if (transport === "stdio") {
            const parts = rest.split(/\s+/u);
            newEntry = { name, transport, command: parts[0], args: parts.slice(1), toolPrefix: "", env: {}, enabled: true, authType: "none" };
          } else {
            newEntry = { name, transport, url: rest, args: [], toolPrefix: "", env: {}, enabled: true, authType: "none" };
          }
          const next: SciraConfig = { ...cfg, mcp: { ...cfg.mcp, servers: [...servers, newEntry] } };
          setConfig(next);
          await saveGlobalMcpConfig(next.mcp);
          pushFeed({ kind: "status", text: `Server "${name}" added. Restart the session to connect.` });
          return;
        }

        pushFeed({ kind: "status", text: "Usage: /mcp list · /mcp enable <name> · /mcp disable <name> · /mcp add stdio <name> <command> [args…] · /mcp add http <name> <url>" });
      })();
      return;
    }
    if (text === "/copy") {
      void (async () => {
        const currentSession = sessions.find(s => s.path === currentRunPath);
        const report = currentSession?.isFull
          ? await readFile(getRunPaths(currentRunPath).report, "utf8").catch(() => "")
          : "";
        const lastText = [...feedRef.current].reverse().find((it): it is FeedItem & { kind: "text" } => it.kind === "text")?.text ?? "";
        const content = report.trim() || lastText;
        if (!content) { pushFeed({ kind: "status", text: "Nothing to copy yet." }); return; }
        const ok = await copyToClipboard(content);
        pushFeed({ kind: "status", text: ok ? `Copied ${report.trim() ? "report.md" : "last answer"} to clipboard.` : "Clipboard unavailable." });
      })();
      return;
    }
    if (text === "/usage") {
      const entries = Object.entries(usage);
      const reasoningTotal = feedRef.current.reduce(
        (n, it) => n + (it.kind === "reasoning" ? (it.durationMs ?? 0) : 0),
        0
      );
      const reasoningCount = feedRef.current.filter((it) => it.kind === "reasoning" && (it.durationMs ?? 0) > 0).length;
      if (entries.length === 0 && reasoningTotal === 0) {
        pushFeed({ kind: "status", text: "No token usage recorded yet." });
        return;
      }
      const lines = entries
        .map(([model, u]) => `- **${model}** — ↑${fmtTokens(u.input)} in · ↓${fmtTokens(u.output)} out · ${fmtTokens(u.total)} total (${u.turns} ${u.turns === 1 ? "turn" : "turns"})`)
        .join("\n");
      const grand = entries.reduce((n, [, u]) => n + u.total, 0);
      const thinking = reasoningTotal > 0
        ? `\n\n**Reasoning:** ${fmtDuration(reasoningTotal)} across ${reasoningCount} ${reasoningCount === 1 ? "block" : "blocks"}`
        : "";
      pushFeed({ kind: "text", text: `## Token usage\n\n${lines}\n\n**Session total:** ${fmtTokens(grand)} tokens${thinking}` });
      return;
    }
    if (text.startsWith("/rename ")) {
      const title = text.slice(8).trim();
      if (!title) { pushFeed({ kind: "status", text: "Usage: /rename <title>" }); return; }
      void (async () => {
        try {
          await setRunTitle(currentRunPath, title);
          setRunState((prev) => prev ? { ...prev, title } : prev);
          pushFeed({ kind: "status", text: `Session title set to "${title}".` });
        } catch (e) {
          pushFeed({ kind: "status", text: `Failed to set title: ${e instanceof Error ? e.message : String(e)}` });
        }
      })();
      return;
    }
    if (text === "/rerun") {
      if (busy) return;
      if (rerunConfirmRef.current) {
        rerunConfirmRef.current = false;
        conversationRef.current = [];
        setMode(true); // explicit deep re-run uses the full harness
        setFeed([{ kind: "status", text: "Re-running research…" }]);
        void runTurn("Re-run the research from scratch. Plan, gather grounded sources, and rewrite report.md, then summarize.");
        return;
      }
      pushFeed({ kind: "status", text: "This will wipe the conversation history. Press /rerun again to confirm." });
      rerunConfirmRef.current = true;
      return;
    }
    if (busy) {
      queuedPromptRef.current = text;
      pushFeed({ kind: "status", text: "Queued — will send when the current turn finishes." });
      return;
    }
    pushFeed({ kind: "user", text, ts: Date.now() });
    void runTurn(text);
  }, [abortTurn, stopTurn, busy, currentRunPath, exit, handleSettings, openMenu, pushFeed, refreshSessions, runTurn, usage, setMode, pendingRerun, setConfig, config]);

  return { submitHome, submitChat, stopTurn };
}
