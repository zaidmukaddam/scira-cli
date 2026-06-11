import React from "react";
import { Box, Text } from "ink";
import { type RunState, type SciraConfig } from "../../../types/index.js";
import { LLM_PROVIDER_LABELS } from "../../../providers/llm/registry.js";
import { pkgVersion, relativeTime } from "../lib/utils.js";
import { HOME_TIPS } from "../constants.js";
import { useTheme } from "../hooks/use-theme.js";
import { type ClickHandler } from "../hooks/use-mouse.js";

function enabledMcpCount(config: SciraConfig): number {
  return (config.mcp.chromeDevtools.enabled ? 1 : 0) + config.mcp.servers.filter((s) => s.enabled).length;
}

type HeroLayout = {
  showArt: boolean;
  showSubtitle: boolean;
  showTagline: boolean;
  showHint: boolean;
  showConfig: boolean;
  showConfigDetail: boolean;
  showProviderLabel: boolean;
  showVersion: boolean;
  showActionHints: boolean;
  showTip: boolean;
  cardRows: number;
  newResearchRowOffset: number;
};

function computeHeroLayout(bodyRows: number, bodyCols: number, hasNotice: boolean): HeroLayout {
  const showTip = bodyRows >= 20 && bodyCols >= 58 && !hasNotice;
  const showArt = bodyRows >= 17 && bodyCols >= 72;
  const showSubtitle = bodyRows >= 14 && bodyCols >= 50;
  const showTagline = bodyRows >= 16 && bodyCols >= 64;
  const showHint = bodyRows >= 15 && bodyCols >= 58;
  const showConfig = bodyRows >= 12 && bodyCols >= 46;
  const showConfigDetail = bodyRows >= 14 && bodyCols >= 56;
  const showProviderLabel = bodyCols >= 62;
  const showVersion = bodyRows >= 13 && bodyCols >= 54;
  const showActionHints = bodyCols >= 52;

  let contentRows = 1; // title
  if (showTagline) contentRows++;
  if (showHint) contentRows++;
  if (showConfig || showConfigDetail) {
    contentRows++; // spacer
    if (showConfig) contentRows++;
    if (showConfigDetail) contentRows++;
  }
  const newResearchRowOffset = contentRows + 1; // spacer before actions, then new research
  contentRows = newResearchRowOffset + 2; // new + quit
  const cardRows = contentRows + 2; // border padding

  return {
    showArt,
    showSubtitle,
    showTagline,
    showHint,
    showConfig,
    showConfigDetail,
    showProviderLabel,
    showVersion,
    showActionHints,
    showTip,
    cardRows,
    newResearchRowOffset,
  };
}

type HomeScreenProps = {
  cols: number;
  rows: number;
  sessions: RunState[];
  selectedIdx: number;
  hoveredIdx: number | null;
  heroHidden: boolean;
  notice: string;
  tipIndex: number;
  commandMenuHeight: number;
  mcpOpen: boolean;
  sessionsModalOpen: boolean;
  sessionsModalIdx: number;
  inputText: string;
  config: SciraConfig;
  modelName: string;
  clickMapRef: React.RefObject<Map<number, ClickHandler>>;
  hoverMapRef: React.RefObject<Map<number, number>>;
  setSelectedIdx: (i: number) => void;
  setSessionsModalOpen: (open: boolean) => void;
  setSessionsModalIdx: (i: number) => void;
  setNotice: (text: string) => void;
  openRun: (runPath: string) => Promise<void>;
  submitHome: (value: string) => Promise<void>;
  exit: () => void;
};

/** Home screen body: branding card, browse modal, notice, and tip line.
 *  Also (re)builds the mouse click/hover row maps as a render side-effect. */
export function HomeScreen({
  cols, rows, sessions, selectedIdx, hoveredIdx, heroHidden, notice, tipIndex,
  commandMenuHeight, mcpOpen, sessionsModalOpen, sessionsModalIdx, inputText, config, modelName,
  clickMapRef, hoverMapRef, setSelectedIdx, setSessionsModalOpen, setSessionsModalIdx,
  setNotice, openRun, submitHome, exit,
}: HomeScreenProps): React.ReactElement {
  const theme = useTheme();
  const bodyCols = Math.max(32, cols - 4);
  const cardW = Math.min(Math.max(36, bodyCols), 90);
  const mcpCount = enabledMcpCount(config);
  const bHeight = rows - 6 - commandMenuHeight;
  const heroLayout = heroHidden ? null : computeHeroLayout(bHeight, bodyCols, !!notice);
  const providerLabel = heroLayout?.showProviderLabel
    ? LLM_PROVIDER_LABELS[config.llmProvider]
    : config.llmProvider;
  const cardH = heroLayout?.cardRows ?? 0;
  const tipRows = heroLayout?.showTip ? 2 : 0;
  const contentH = cardH + (notice ? 2 : 0) + tipRows;
  const topGap = Math.max(0, Math.floor((bHeight - contentH) / 2));
  const cardTop0 = 2 + topGap;
  const newIdx = 0;
  const quitIdx = 1;
  const newActive = selectedIdx === newIdx || hoveredIdx === newIdx;
  const quitActive = selectedIdx === quitIdx || hoveredIdx === quitIdx;
  const clickMap = new Map<number, (x: number) => void>();
  const hoverMap = new Map<number, number>();
  const rowBase = cardTop0 + 1 + (heroLayout?.newResearchRowOffset ?? 4);
  if (!mcpOpen && sessionsModalOpen) {
    const modalVisible = Math.max(5, rows - 12);
    const half = Math.floor(modalVisible / 2);
    const windowStart = Math.max(0, Math.min(sessionsModalIdx - half, Math.max(0, sessions.length - modalVisible)));
    const windowEnd = Math.min(sessions.length, windowStart + modalVisible);
    const modalTop = cardTop0;
    const headerRows = 3;
    const above = windowStart;
    sessions.slice(windowStart, windowEnd).forEach((s, i) => {
      const idx = windowStart + i;
      const row = modalTop + headerRows + (above > 0 ? 1 : 0) + i;
      clickMap.set(row, () => {
        setSessionsModalIdx(idx);
        setSessionsModalOpen(false);
        void openRun(s.path);
      });
      hoverMap.set(row, idx);
    });
  } else if (!mcpOpen && !heroHidden) {
    clickMap.set(rowBase, (_x) => {
      setSelectedIdx(newIdx);
      if (inputText.trim()) void submitHome(inputText);
      else setNotice("Type a question below to start a new research run.");
    });
    hoverMap.set(rowBase, newIdx);
    clickMap.set(rowBase + 1, (_x) => exit());
    hoverMap.set(rowBase + 1, quitIdx);
  }
  if (!mcpOpen) {
    clickMapRef.current = clickMap;
    hoverMapRef.current = hoverMap;
  }

  return (
    <Box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center">
      {sessionsModalOpen ? (() => {
        const modalVisible = Math.max(5, rows - 12);
        const half = Math.floor(modalVisible / 2);
        const windowStart = Math.max(0, Math.min(sessionsModalIdx - half, Math.max(0, sessions.length - modalVisible)));
        const windowEnd = Math.min(sessions.length, windowStart + modalVisible);
        const above = windowStart;
        const below = sessions.length - windowEnd;
        return (
          <Box borderStyle="round" borderColor={theme.border} width={cardW} flexDirection="column" paddingX={2} paddingY={1}>
            <Text color={theme.accent} bold>All sessions</Text>
            <Text color={theme.textDim} wrap="truncate">
              {bodyCols >= 58
                ? `${sessions.length} total  ·  ${sessionsModalIdx + 1}/${sessions.length}  ·  ↑↓ navigate · ⏎ open · esc close`
                : `${sessions.length} sessions  ·  ${sessionsModalIdx + 1}/${sessions.length}  ·  esc close`}
            </Text>
            <Box height={1} />
            {above > 0 && <Text color={theme.textDim}>{`  ↑ ${above} more above`}</Text>}
            {sessions.slice(windowStart, windowEnd).map((s, i) => {
              const idx = windowStart + i;
              const active = idx === sessionsModalIdx;
              const display = (s.title || s.goal || s.id).slice(0, cardW - 22);
              return (
                <Box key={s.id}>
                  <Text color={active ? theme.text : theme.textDim}>{active ? "❯ [ " : "  [ "}</Text>
                  <Text bold={active} color={active ? theme.text : theme.textDim} wrap="truncate">{display}</Text>
                  <Box flexGrow={1} />
                  {s.isFull && <Text color={s.reportDirty ? theme.warning : theme.success}>{s.reportDirty ? "draft " : "ready "}</Text>}
                  <Text color={theme.textDim}>{relativeTime(s.updatedAt)}</Text>
                  <Text color={active ? theme.text : theme.textDim}>{" ]"}</Text>
                </Box>
              );
            })}
            {below > 0 && <Text color={theme.textDim}>{`  ↓ ${below} more below`}</Text>}
          </Box>
        );
      })() : heroHidden || !heroLayout ? null : (
        <Box flexDirection="column" alignItems="center" width={cardW}>
          <Box borderStyle="round" borderColor={theme.border} width={cardW} flexDirection="row" paddingX={2} paddingY={1}>
            {heroLayout.showArt ? (
              <Box flexDirection="column" justifyContent="center" marginRight={3}>
                {[" ·:::· ", "·:     ", " ·:::· ", "     ·:", " ·:::· "].map((line, i) => (
                  <Text key={i} color={theme.accent}>{line}</Text>
                ))}
              </Box>
            ) : null}
            <Box flexDirection="column" flexGrow={1}>
              <Box gap={heroLayout.showSubtitle || heroLayout.showVersion ? 2 : 0} marginBottom={1}>
                <Text bold color={theme.text}>scira</Text>
                {heroLayout.showSubtitle ? <Text color={theme.textDim}>research agent</Text> : null}
                {heroLayout.showVersion ? <Text color={theme.textDim}>v{pkgVersion}</Text> : null}
              </Box>
              {heroLayout.showTagline ? (
                <Text color={theme.text} wrap="truncate">Research and coding agent with real sources and tools.</Text>
              ) : null}
              {heroLayout.showHint ? (
                <Text color={theme.textDim} wrap="truncate">Type a question below to start, or use # to browse past sessions.</Text>
              ) : null}
              {(heroLayout.showConfig || heroLayout.showConfigDetail) ? <Box height={1} /> : null}
              {heroLayout.showConfig ? (
                <Text color={theme.textDim} wrap="truncate">
                  <Text color={theme.accent}>model </Text>
                  {modelName}
                  <Text color={theme.textDim}> · {providerLabel}</Text>
                </Text>
              ) : null}
              {heroLayout.showConfigDetail ? (
                <Text color={theme.textDim} wrap="truncate">
                  <Text color={theme.accent}>search </Text>
                  {config.search.provider} ×{config.search.maxResults}
                  <Text color={theme.textDim}> · theme {config.theme} · {config.approvalMode}</Text>
                  {mcpCount > 0 ? <Text color={theme.textDim}> · {mcpCount} mcp</Text> : null}
                </Text>
              ) : null}
              <Box height={1} />
              <Box>
                <Text bold={newActive} color={newActive ? theme.text : theme.textDim}>New research</Text>
                {heroLayout.showActionHints ? (
                  <>
                    <Box flexGrow={1} />
                    <Text color={theme.textDim}>⏎ enter</Text>
                  </>
                ) : null}
              </Box>
              <Box>
                <Text bold={quitActive} color={quitActive ? theme.text : theme.textDim}>Quit</Text>
                {heroLayout.showActionHints ? (
                  <>
                    <Box flexGrow={1} />
                    <Text color={theme.textDim}>ctrl+d</Text>
                  </>
                ) : null}
              </Box>
            </Box>
          </Box>
          {notice ? (
            <Box paddingTop={1}>
              <Text color={theme.warning}>{notice}</Text>
            </Box>
          ) : null}
          {heroLayout.showTip ? (
            <Box paddingTop={2} width={cardW}>
              <Text color={theme.textDim} wrap="truncate">Tip:  {HOME_TIPS[tipIndex % HOME_TIPS.length]}</Text>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
