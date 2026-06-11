import React, { useCallback } from "react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SciraConfig, RunState } from "../../../types/index.js";
import { listRuns, summarizeRun } from "../../../storage/run-store.js";
import { type FeedItem, type Screen, type ModelUsage, type TurnUsage, type SessionUsage } from "../types.js";
import { getSession, attachSubscriber, type SessionSubscriber } from "../session-manager.js";

type SessionOptions = {
  config: SciraConfig;
  currentRunPath: string | undefined;
  conversationRef: React.RefObject<{ role: "user" | "assistant"; content: string }[]>;
  feedRef: React.RefObject<FeedItem[]>;
  turnsRef: React.RefObject<TurnUsage[]>;
  startedRef: React.RefObject<string | undefined>;
  runTurnRef: React.RefObject<(prompt: string) => Promise<void>>;
  setSessions: (sessions: RunState[]) => void;
  setRunState: React.Dispatch<React.SetStateAction<RunState | null>>;
  setCurrentRunPath: (path: string | undefined) => void;
  setInputText: (text: string) => void;
  setCursorPos: (pos: number) => void;
  setFeed: React.Dispatch<React.SetStateAction<FeedItem[]>>;
  setUsage: (usage: Record<string, ModelUsage>) => void;
  setScrollOffset: (offset: number) => void;
  setScreen: (screen: Screen) => void;
  setMode: (full: boolean) => void;
  setBusy: (busy: boolean) => void;
  setApprovalPending: React.Dispatch<React.SetStateAction<{ toolName: string; description: string; resolve: (v: boolean) => void } | null>>;
  getSubscriber: () => SessionSubscriber;
};

export function useSession(o: SessionOptions): {
  refreshSessions: () => Promise<void>;
  refreshRun: () => Promise<void>;
  openRun: (runPath: string, initialQuestion?: string) => Promise<void>;
} {
  const {
    config, currentRunPath, conversationRef, feedRef, turnsRef, startedRef, runTurnRef,
    setSessions, setRunState, setCurrentRunPath, setInputText, setCursorPos,
    setFeed, setUsage, setScrollOffset, setScreen, setMode,
    setBusy, setApprovalPending, getSubscriber,
  } = o;


  const refreshSessions = useCallback(async () => {
    const runs = await listRuns(config);
    setSessions(runs);
  }, [config]);

  const refreshRun = useCallback(async () => {
    if (currentRunPath) setRunState(await summarizeRun(currentRunPath));
  }, [currentRunPath]);

  const openRun = useCallback(async (runPath: string, initialQuestion?: string) => {
    setCurrentRunPath(runPath);
    setInputText("");
    setCursorPos(0);

    // If a background session is already running for this path, reattach to it.
    const live = getSession(runPath);
    if (live) {
      startedRef.current = runPath;
      setScrollOffset(0);
      setScreen("chat");
      setMode(live.feedBuffer.some((it) => it.kind === "tool" || it.kind === "status"));
      const buffered = attachSubscriber(runPath, getSubscriber());
      if (buffered.length > 0) {
        setFeed(buffered);
        feedRef.current = buffered;
      }
      setBusy(live.busy);
      if (live.approvalPending) setApprovalPending(live.approvalPending);
      const resumedState = await summarizeRun(runPath).catch(() => null);
      setRunState(resumedState);
      return;
    }

    try {
      const raw = await readFile(join(runPath, "convo.json"), "utf8");
      const saved = JSON.parse(raw) as { feed?: FeedItem[]; messages?: typeof conversationRef.current; usage?: SessionUsage };
      if (saved.feed && saved.feed.length > 0) {
        const filteredFeed = saved.feed.filter((item: FeedItem) => !(item.kind === "status" && item.text === "This will wipe the conversation history. Press /rerun again to confirm."));
        const restoredFeed: FeedItem[] = [...filteredFeed, { kind: "status", text: "— resumed —" }];
        setFeed(restoredFeed);
        feedRef.current = restoredFeed;
        conversationRef.current = saved.messages ?? [];
        turnsRef.current = saved.usage?.turns ?? [];
        setUsage(saved.usage?.byModel ?? {});
        startedRef.current = runPath;
        setScrollOffset(0);
        setScreen("chat");
        const resumedState = await summarizeRun(runPath).catch(() => null);
        setRunState(resumedState);
        setMode((resumedState?.claimCount ?? 0) > 0 || (resumedState?.sourceCount ?? 0) > 0);
        return;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        conversationRef.current = [];
        const errMsg = e instanceof Error ? e.message : String(e);
        const errFeed: FeedItem[] = [{ kind: "status", text: `Could not restore session: ${errMsg}` }];
        setFeed(errFeed);
        feedRef.current = errFeed;
        startedRef.current = runPath;
        setScrollOffset(0);
        setScreen("chat");
        return;
      }
    }

    conversationRef.current = [];
    turnsRef.current = [];
    setUsage({});
    startedRef.current = runPath;
    setMode(false);
    const shortModel = config.model.includes("/") ? (config.model.split("/").pop() ?? config.model) : config.model;
    const startStatus = [
      shortModel,
      `${config.search.provider} ×${config.search.maxResults}`,
      `${config.approvalMode} approvals`,
      ...(() => {
        const mcpCount = (config.mcp.chromeDevtools.enabled ? 1 : 0) + config.mcp.servers.filter((s) => s.enabled).length;
        return mcpCount > 0 ? [`${mcpCount} mcp`] : [];
      })(),
    ].join("  ·  ");
    const freshFeed: FeedItem[] = initialQuestion
      ? [{ kind: "user", text: initialQuestion, ts: Date.now() }, { kind: "status", text: startStatus }]
      : [{ kind: "status", text: startStatus }];
    setFeed(freshFeed);
    feedRef.current = freshFeed;
    setScrollOffset(0);
    setScreen("chat");
    void (async () => {
      await summarizeRun(runPath).then(setRunState).catch(() => { });
      // Attach subscriber BEFORE starting the turn so no items are emitted without a listener.
      attachSubscriber(runPath, getSubscriber());
      await runTurnRef.current("Answer my question concisely using web search. If it genuinely needs deep, multi-source, verifiable research, call requestFullResearch to ask me to approve the full research harness.");
    })();
  }, [config, setCurrentRunPath, setInputText, setCursorPos, setFeed, setUsage, setScrollOffset,
      setScreen, setRunState, setMode, setBusy, setApprovalPending, getSubscriber]);

  return { refreshSessions, refreshRun, openRun };
}
