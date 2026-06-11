import React from "react";
import { Box, Text } from "ink";
import { type RunState } from "../../../types/index.js";
import { pkgVersion, relativeTime } from "../lib/utils.js";
import { HOME_TIPS } from "../constants.js";

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
  sessionsModalOpen: boolean;
  sessionsModalIdx: number;
  inputText: string;
  clickMapRef: React.RefObject<Map<number, () => void>>;
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
  commandMenuHeight, sessionsModalOpen, sessionsModalIdx, inputText,
  clickMapRef, hoverMapRef, setSelectedIdx, setSessionsModalOpen, setSessionsModalIdx,
  setNotice, openRun, submitHome, exit,
}: HomeScreenProps): React.ReactElement {
  const cardW = Math.min(Math.max(52, cols - 4), 90);
  const heroRows = heroHidden ? 0 : 2;
  const cardH = heroHidden ? 0 : 10;
  const bHeight = rows - 6 - commandMenuHeight;
  const contentH = cardH + (notice ? 2 : 0) + 2;
  const topGap = Math.max(0, Math.floor((bHeight - contentH) / 2));
  const cardTop0 = 2 + topGap;
  const newIdx = 0;
  const quitIdx = 1;
  const newActive = selectedIdx === newIdx || hoveredIdx === newIdx;
  const quitActive = selectedIdx === quitIdx || hoveredIdx === quitIdx;
  const clickMap = new Map<number, () => void>();
  const hoverMap = new Map<number, number>();
  const rowBase = cardTop0 + heroRows + 4;
  if (sessionsModalOpen) {
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
  } else if (!heroHidden) {
    clickMap.set(rowBase, () => {
      setSelectedIdx(newIdx);
      if (inputText.trim()) void submitHome(inputText);
      else setNotice("Type a question below to start a new research run.");
    });
    hoverMap.set(rowBase, newIdx);
    clickMap.set(rowBase + 1, () => exit());
    hoverMap.set(rowBase + 1, quitIdx);
  }
  clickMapRef.current = clickMap;
  hoverMapRef.current = hoverMap;

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
          <Box borderStyle="round" borderColor="#FFE0C2" width={cardW} flexDirection="column" paddingX={2} paddingY={1}>
            <Text color="#FFE0C2" bold>All sessions</Text>
            <Text color="gray" dimColor>{`${sessions.length} total  ·  ${sessionsModalIdx + 1}/${sessions.length}  ·  ↑↓ navigate · ⏎ open · esc close`}</Text>
            <Box height={1} />
            {above > 0 && <Text color="gray" dimColor>{`  ↑ ${above} more above`}</Text>}
            {sessions.slice(windowStart, windowEnd).map((s, i) => {
              const idx = windowStart + i;
              const active = idx === sessionsModalIdx;
              const display = (s.title || s.goal || s.id).slice(0, cardW - 22);
              return (
                <Box key={s.id}>
                  <Text color={active ? "white" : "gray"}>{active ? "❯ [ " : "  [ "}</Text>
                  <Text bold={active} color={active ? "white" : "gray"} wrap="truncate">{display}</Text>
                  <Box flexGrow={1} />
                  {s.isFull && <Text color={s.reportDirty ? "yellow" : "green"} dimColor>{s.reportDirty ? "draft " : "ready "}</Text>}
                  <Text color="gray" dimColor>{relativeTime(s.updatedAt)}</Text>
                  <Text color={active ? "white" : "gray"}>{" ]"}</Text>
                </Box>
              );
            })}
            {below > 0 && <Text color="gray" dimColor>{`  ↓ ${below} more below`}</Text>}
          </Box>
        );
      })() : heroHidden ? null : (
        <Box flexDirection="column" alignItems="center" width={cardW}>
          <Box borderStyle="round" borderColor="gray" width={cardW} flexDirection="row" paddingX={2} paddingY={1}>
            <Box flexDirection="column" justifyContent="center" marginRight={3}>
              {[" ·:::· ", "·:     ", " ·:::· ", "     ·:", " ·:::· "].map((line, i) => (
                <Text key={i} color="#FFE0C2" dimColor>{line}</Text>
              ))}
            </Box>
            <Box flexDirection="column" flexGrow={1}>
              <Box gap={2} marginBottom={1}>
                <Text bold color="white">scira</Text>
                <Text color="gray" dimColor>research agent</Text>
                <Text color="gray" dimColor>v{pkgVersion}</Text>
              </Box>
              <Text color="white">Research and coding agent with real sources and tools.</Text>
              <Text color="gray" dimColor>Type a question below to start, or use # to browse past sessions.</Text>
              <Box height={1} />
              <Box>
                <Text bold={newActive} color={newActive ? "white" : "gray"}>New research</Text>
                <Box flexGrow={1} />
                <Text color="gray" dimColor>⏎ enter</Text>
              </Box>
              <Box>
                <Text bold={quitActive} color={quitActive ? "white" : "gray"}>Quit</Text>
                <Box flexGrow={1} />
                <Text color="gray" dimColor>ctrl+d</Text>
              </Box>
            </Box>
          </Box>
          {notice ? (
            <Box paddingTop={1}>
              <Text color="yellow">{notice}</Text>
            </Box>
          ) : null}
          <Box paddingTop={2}>
            <Text color="gray" dimColor>Tip:  {HOME_TIPS[tipIndex % HOME_TIPS.length]}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
