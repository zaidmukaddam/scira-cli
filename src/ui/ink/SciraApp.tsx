import React, { useCallback, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useStdout, useStdin } from "ink";
import { SciraConfig, RunState } from "../../types/index.js";
import { type Screen, type ModelUsage, type TurnUsage, type ApprovalPending } from "./types.js";
import { CHAT_COMMANDS, MENU_VISIBLE } from "./constants.js";
import { CWD_DISPLAY, wrapText, wrapInputWithCursor, loadInputHistory, saveInputHistory } from "./lib/utils.js";
import { deleteRun } from "../../storage/run-store.js";
import { useMountEffect, TipCycler, AnimationTick, MouseTracker } from "./components/effects.js";
import { useFeedLines, computeGroups } from "./hooks/use-feed-lines.js";
import { useAgentTurn } from "./hooks/use-agent-turn.js";
import { TopBar, InputBar, HintLine, CommandMenuBox, HelpBox, ApprovalBox, MenuDialog, McpDialog } from "./components/overlays.js";
import { useKeyboard } from "./hooks/use-keyboard.js";
import { HomeScreen } from "./components/home-screen.js";
import { useFeed } from "./hooks/use-feed.js";
import { useSettings } from "./hooks/use-settings.js";
import { useSuggestions } from "./hooks/use-suggestions.js";
import { useSubmit } from "./hooks/use-submit.js";
import { useSession } from "./hooks/use-session.js";
import { useMouse } from "./hooks/use-mouse.js";

export type SciraAppProps = {
  runPath?: string;
  config: SciraConfig;
};

export function SciraApp({ runPath: initialRunPath, config: initialConfig }: SciraAppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { stdin } = useStdin();
  const [size, setSize] = useState({ cols: stdout?.columns ?? 120, rows: stdout?.rows ?? 30 });
  const cols = size.cols;
  const rows = size.rows;

  useMountEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize({ cols: stdout.columns, rows: stdout.rows });
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  });

  const [screen, setScreen] = useState<Screen>(initialRunPath ? "chat" : "home");
  const [currentRunPath, setCurrentRunPath] = useState<string | undefined>(initialRunPath);
  const [config, setConfig] = useState<SciraConfig>(initialConfig);
  const [notice, setNotice] = useState("");
  const [pendingRerun, setPendingRerun] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);

  const [sessions, setSessions] = useState<RunState[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);
  const [sessionsModalIdx, setSessionsModalIdx] = useState(0);

  const [runState, setRunState] = useState<RunState | null>(null);
  const { feed, setFeed, feedRef, pushFeed, appendText, appendReasoning, finishReasoning, markToolDone } = useFeed();
  const conversationRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const queuedPromptRef = useRef<string | null>(null);
  const startedRef = useRef<string | undefined>(undefined);
  const fullModeRef = useRef(false);
  const [fullMode, setFullModeState] = useState(false);
  const setMode = useCallback((full: boolean) => { fullModeRef.current = full; setFullModeState(full); }, []);

  const [usage, setUsage] = useState<Record<string, ModelUsage>>({});
  const turnsRef = useRef<TurnUsage[]>([]);
  const recordUsage = useCallback((model: string, u: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) => {
    const input = u.inputTokens ?? 0;
    const output = u.outputTokens ?? 0;
    const total = u.totalTokens ?? input + output;
    if (input + output + total === 0) return;
    setUsage((prev) => {
      const cur = prev[model] ?? { input: 0, output: 0, total: 0, turns: 0 };
      return { ...prev, [model]: { input: cur.input + input, output: cur.output + output, total: cur.total + total, turns: cur.turns + 1 } };
    });
  }, []);

  const [approvalPending, setApprovalPending] = useState<ApprovalPending | null>(null);

  const [inputText, setInputText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [heroHidden, setHeroHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blink, setBlink] = useState(true);
  const [frame, setFrame] = useState(0);
  const [reasoningTick, setReasoningTick] = useState(0);

  const [commandMenuIndex, setCommandMenuIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const [scrollOffset, setScrollOffset] = useState(0);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const [focusedGroupKey, setFocusedGroupKey] = useState<number | null>(null);
  const [pendingCollapse, setPendingCollapse] = useState<Set<number>>(new Set());

  const doneGroupKeys = useMemo(() => {
    const { groups } = computeGroups(feed);
    return [...groups.entries()].filter(([, g]) => !g.active).map(([k]) => k).sort((a, b) => a - b);
  }, [feed]);

  const toggleAllGroups = useCallback(() => {
    setCollapsedGroups((prev) => {
      const allCollapsed = doneGroupKeys.length > 0 && doneGroupKeys.every((k) => prev.has(k));
      if (allCollapsed) {
        setPendingCollapse(new Set());
        return new Set<number>();
      }
      // Mark done groups for pending collapse, but don't collapse active ones
      setPendingCollapse(new Set(doneGroupKeys));
      return new Set<number>(doneGroupKeys.filter((k) => {
        const group = computeGroups(feed).groups.get(k);
        return group && !group.active;
      }));
    });
  }, [doneGroupKeys, feed]);

  const toggleFocusedGroup = useCallback(() => {
    if (focusedGroupKey === null) return;
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(focusedGroupKey)) next.delete(focusedGroupKey); else next.add(focusedGroupKey);
      return next;
    });
  }, [focusedGroupKey]);

  // Auto-collapse groups when they become inactive if they're in pendingCollapse
  React.useEffect(() => {
    if (pendingCollapse.size === 0) return;
    const { groups } = computeGroups(feed);
    const nowInactive = [...pendingCollapse].filter((k) => {
      const group = groups.get(k);
      return group && !group.active;
    });
    if (nowInactive.length > 0) {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        nowInactive.forEach((k) => next.add(k));
        return next;
      });
      setPendingCollapse((prev) => {
        const next = new Set(prev);
        nowInactive.forEach((k) => next.delete(k));
        return next;
      });
    }
  }, [feed, pendingCollapse]);

  const focusPrevGroup = useCallback(() => {
    setFocusedGroupKey((prev) => {
      if (doneGroupKeys.length === 0) return null;
      if (prev === null) return doneGroupKeys[doneGroupKeys.length - 1] ?? null;
      const idx = doneGroupKeys.indexOf(prev);
      return idx <= 0 ? prev : (doneGroupKeys[idx - 1] ?? prev);
    });
  }, [doneGroupKeys]);

  const focusNextGroup = useCallback(() => {
    setFocusedGroupKey((prev) => {
      if (doneGroupKeys.length === 0) return null;
      if (prev === null) return doneGroupKeys[0] ?? null;
      const idx = doneGroupKeys.indexOf(prev);
      return idx < 0 || idx >= doneGroupKeys.length - 1 ? prev : (doneGroupKeys[idx + 1] ?? prev);
    });
  }, [doneGroupKeys]);

  const unfocusGroup = useCallback(() => setFocusedGroupKey(null), []);

  const [tipIndex, setTipIndex] = useState(0);


  React.useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  const wheelStateRef = useRef({ screen, maxScrollOffset: 0 });
  const handleWheel = useCallback((dir: 1 | -1) => {
    if (wheelStateRef.current.screen !== "chat") return;
    setScrollOffset((off) => Math.max(0, Math.min(off + dir * 3, wheelStateRef.current.maxScrollOffset)));
  }, []);
  const { clickMapRef, hoverMapRef, hoveredIdx, setHoveredIdx, handleMouseData } = useMouse(handleWheel);

  const getSubscriber = useCallback(() => ({
    pushFeed,
    appendText,
    appendReasoning,
    finishReasoning,
    markToolDone,
    onBusyChange: setBusy,
    onApprovalRequired: (p: { toolName: string; description: string; resolve: (v: boolean) => void }) => setApprovalPending(p),
    onApprovalCleared: () => setApprovalPending(null),
    onEscalate: () => setMode(true),
    onModeChange: setMode,
  }), [pushFeed, appendText, appendReasoning, finishReasoning, markToolDone, setBusy, setApprovalPending, setMode]);

  const runTurnRef = useRef<(prompt: string) => Promise<void>>(async () => { });
  const { refreshSessions, refreshRun, openRun: openRunBase } = useSession({
    config, currentRunPath, conversationRef, feedRef, turnsRef, startedRef, runTurnRef,
    setSessions, setRunState, setCurrentRunPath, setInputText, setCursorPos,
    setFeed, setUsage, setScrollOffset, setScreen, setMode,
    setBusy, setApprovalPending, getSubscriber,
  });

  const openRun = useCallback(async (runPath: string, initialQuestion?: string) => {
    setPendingRerun(false);
    await openRunBase(runPath, initialQuestion);
  }, [openRunBase, setPendingRerun]);

  useMountEffect(() => {
    if (!initialRunPath) void refreshSessions();
    void loadInputHistory(config.runDirectory).then((h) => { if (h.length > 0) setInputHistory(h); });
  });

  React.useEffect(() => {
    if (inputHistory.length > 0) void saveInputHistory(config.runDirectory, inputHistory);
  }, [inputHistory, config.runDirectory]);

  const deleteSession = useCallback((idx: number) => {
    const s = sessions[idx];
    if (!s) return;
    void (async () => {
      await deleteRun(s.path).catch(() => { });
      await refreshSessions();
      setSessionsModalIdx((i) => Math.max(0, Math.min(i, sessions.length - 2)));
      setNotice("Session deleted.");
    })();
  }, [sessions, refreshSessions]);

  const { menu, setMenu, modelName, openMenu, applyMenuSelection, handleSettings } = useSettings({
    config, setConfig, screen, pushFeed, setNotice,
  });

  const { runTurn } = useAgentTurn({
    config, currentRunPath, queuedPromptRef, fullModeRef, conversationRef, turnsRef, feedRef,
    setBusy, setScrollOffset, refreshRun, recordUsage, setMode, getSubscriber,
  });
  runTurnRef.current = runTurn;

  const { submitHome, submitChat, stopTurn } = useSubmit({
    state: { config, currentRunPath, sessions, selectedIdx, busy, usage, pendingRerun },
    refs: { queuedPromptRef, conversationRef, feedRef },
    setters: {
      setApprovalPending, setInputText, setCursorPos, setInputHistory, setHistoryIndex, setHelpOpen,
      setNotice, setBusy, setScreen, setFeed, setRunState, setPendingRerun, setMode, setConfig, setMcpOpen,
      setHeroHidden,
    },
    actions: { pushFeed, refreshSessions, openRun, openMenu, handleSettings, runTurn, exit },
  });

  const { activeSuggestions, activeSuggestionKind, acceptActiveSuggestion } = useSuggestions({
    inputText, setInputText, setCursorPos, sessions, openRun, refreshSessions,
  });

  const innerWidth = Math.max(20, cols - 4);
  const boxWidth = Math.max(20, cols - 4);
  const textWidth = Math.max(1, boxWidth - 6);
  const rawInputText = approvalPending ? "waiting for approval\u2026" : inputText;
  const showCursor = !busy && !approvalPending;
  const caret = Math.max(0, Math.min(cursorPos, inputText.length));
  const { lines: inputLines, cursorLine, cursorCol } = wrapInputWithCursor(
    rawInputText,
    textWidth,
    showCursor ? caret : -1,
  );
  const commandMenuHeight = activeSuggestions.length > 0 ? Math.min(MENU_VISIBLE, activeSuggestions.length) + 3 : 0;
  const helpHeight = helpOpen ? Math.min(14, CHAT_COMMANDS.length + 4) : 0;
  const approvalPreviewLines = approvalPending
    ? Math.min(5, wrapText(approvalPending.description, Math.max(10, innerWidth - 4)).length)
    : 0;
  const approvalHeight = approvalPending ? approvalPreviewLines + 5 : 0;
  const menuHeight = commandMenuHeight + helpHeight + approvalHeight;
  const feedRows = Math.max(3, rows - 6 - inputLines.length - menuHeight);


  const hasRunningTool = feed.some((it) => it.kind === "tool" && it.status === "running");
  const feedLines = useFeedLines(feed, innerWidth, reasoningTick, hasRunningTool ? frame : 0, collapsedGroups, focusedGroupKey);

  const contentRows = Math.max(1, feedRows);
  const maxScrollOffset = Math.max(0, feedLines.length - contentRows);
  wheelStateRef.current = { screen, maxScrollOffset };
  const clampedOffset = Math.min(scrollOffset, maxScrollOffset);
  const startIdx = Math.max(0, feedLines.length - contentRows - clampedOffset);
  const visibleLines = feedLines.slice(startIdx, startIdx + contentRows);
  const scrollLabel = clampedOffset > 0
    ? (startIdx > 0 ? `↑ ${startIdx} · ↓ ${clampedOffset} · wheel/⇞⇟` : `top · ↓ ${clampedOffset} · wheel/⇞⇟`)
    : "";

  useKeyboard({
    screen,
    setNotice,
    exit,
    input: { text: inputText, setText: setInputText, cursorPos, setCursorPos, history: inputHistory, historyIndex, setHistoryIndex },
    dialogs: { approvalPending, setApprovalPending, menu, setMenu, applyMenuSelection, helpOpen, setHelpOpen, mcpOpen, setMcpOpen },
    suggestions: { activeSuggestions, activeSuggestionKind, commandMenuIndex, setCommandMenuIndex, acceptActiveSuggestion },
    chat: { setScrollOffset, contentRows, maxScrollOffset, pendingRerun, setPendingRerun, busy, stopTurn, submitChat, toggleAllGroups, toggleFocusedGroup, focusPrevGroup, focusNextGroup, unfocusGroup, hasFocusedGroup: focusedGroupKey !== null },
    home: { sessionsModalOpen, setSessionsModalOpen, sessionsModalIdx, setSessionsModalIdx, sessions, deleteSession, selectedIdx, setSelectedIdx, setHeroHidden, openRun, submitHome },
  });

  const activeUsage = usage[config.model];

  if (screen === "home") {
    return (
      <Box flexDirection="column" width={cols} height={rows} paddingX={2}>
        <TipCycler setTipIndex={setTipIndex} />
        {!sessionsModalOpen && stdout !== undefined && stdin !== undefined && (
          <MouseTracker stdout={stdout} stdin={stdin} onData={handleMouseData} onUnmount={() => setHoveredIdx(null)} />
        )}
        {busy && <AnimationTick setBlink={setBlink} setFrame={setFrame} setReasoningTick={setReasoningTick} />}
        <TopBar screen={screen} runState={runState} fullMode={fullMode} activeUsage={activeUsage} busy={busy} frame={frame} cwdDisplay={CWD_DISPLAY} />
        <HomeScreen
          cols={cols}
          rows={rows}
          sessions={sessions}
          selectedIdx={selectedIdx}
          hoveredIdx={hoveredIdx}
          heroHidden={heroHidden}
          notice={notice}
          tipIndex={tipIndex}
          commandMenuHeight={commandMenuHeight}
          sessionsModalOpen={sessionsModalOpen}
          sessionsModalIdx={sessionsModalIdx}
          inputText={inputText}
          clickMapRef={clickMapRef}
          hoverMapRef={hoverMapRef}
          setSelectedIdx={setSelectedIdx}
          setSessionsModalOpen={setSessionsModalOpen}
          setSessionsModalIdx={setSessionsModalIdx}
          setNotice={setNotice}
          openRun={openRun}
          submitHome={submitHome}
          exit={exit}
        />
        <Box flexDirection="column" backgroundColor="#141414" paddingBottom={1}>
          <CommandMenuBox activeSuggestions={activeSuggestions} activeSuggestionKind={activeSuggestionKind} commandMenuIndex={commandMenuIndex} innerWidth={innerWidth} sessions={sessions} />
          <InputBar inputLines={inputLines} cursorLine={cursorLine} cursorCol={cursorCol} showCursor={showCursor} approvalPending={!!approvalPending} busy={busy} frame={frame} boxWidth={boxWidth} modelName={modelName} />
          <HintLine screen={screen} busy={busy} />
        </Box>
        <MenuDialog menu={menu} cols={cols} rows={rows} />
        <McpDialog open={mcpOpen} config={config} cols={cols} rows={rows} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={cols} height={rows} paddingX={2}>
      {stdout !== undefined && stdin !== undefined && (
        <MouseTracker stdout={stdout} stdin={stdin} onData={handleMouseData} onUnmount={() => setHoveredIdx(null)} />
      )}
      {busy && <AnimationTick setBlink={setBlink} setFrame={setFrame} setReasoningTick={setReasoningTick} />}
      <TopBar screen={screen} runState={runState} fullMode={fullMode} activeUsage={activeUsage} busy={busy} frame={frame} cwdDisplay={CWD_DISPLAY} />
      <Box flexDirection="column" flexGrow={1} paddingTop={1} overflow="hidden">
        {visibleLines}
      </Box>
      <Box flexDirection="column" backgroundColor="#141414" paddingBottom={1}>
        <CommandMenuBox activeSuggestions={activeSuggestions} activeSuggestionKind={activeSuggestionKind} commandMenuIndex={commandMenuIndex} innerWidth={innerWidth} sessions={sessions} />
        <HelpBox open={helpOpen} innerWidth={innerWidth} />
        {approvalPending && <ApprovalBox toolName={approvalPending.toolName} description={approvalPending.description} innerWidth={innerWidth} />}
        <InputBar inputLines={inputLines} cursorLine={cursorLine} cursorCol={cursorCol} showCursor={showCursor} approvalPending={!!approvalPending} busy={busy} frame={frame} boxWidth={boxWidth} modelName={modelName} />
        <HintLine screen={screen} busy={busy} scrollLabel={scrollLabel} hasDoneGroups={doneGroupKeys.length > 0} hasFocusedGroup={focusedGroupKey !== null} />
      </Box>
      <MenuDialog menu={menu} cols={cols} rows={rows} />
      <McpDialog open={mcpOpen} config={config} cols={cols} rows={rows} />
    </Box>
  );
}
