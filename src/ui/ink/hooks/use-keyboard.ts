import React, { useRef } from "react";
import { useInput } from "ink";
import { type Screen, type ApprovalPending } from "../types.js";
import { type RunState } from "../../../types/index.js";
import { COMMANDS_NEEDING_ARGS } from "../constants.js";
import { type Menu } from "./use-settings.js";

function completeCommandWithArgSuffix(
  selected: string,
  inputText: string,
  acceptActiveSuggestion: (value: string) => void,
): boolean {
  if (COMMANDS_NEEDING_ARGS.has(selected) && inputText.trim() === selected) {
    acceptActiveSuggestion(`${selected} `);
    return true;
  }
  return false;
}

export type KeyboardInputOptions = {
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  cursorPos: number;
  setCursorPos: React.Dispatch<React.SetStateAction<number>>;
  history: string[];
  historyIndex: number;
  setHistoryIndex: React.Dispatch<React.SetStateAction<number>>;
};

export type KeyboardDialogOptions = {
  approvalPending: ApprovalPending | null;
  setApprovalPending: React.Dispatch<React.SetStateAction<ApprovalPending | null>>;
  menu: Menu | null;
  setMenu: React.Dispatch<React.SetStateAction<Menu | null>>;
  applyMenuSelection: (menu: Menu) => Promise<void>;
  helpOpen: boolean;
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  mcpOpen: boolean;
  setMcpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  mcpRowIdx: number;
  setMcpRowIdx: React.Dispatch<React.SetStateAction<number>>;
  mcpRowCount: number;
  toggleMcpRow: (idx: number) => void;
  removeMcpRow: (idx: number) => void;
};

export type KeyboardSuggestionOptions = {
  activeSuggestions: string[];
  activeSuggestionKind: "file" | "command" | "session" | null;
  commandMenuIndex: number;
  setCommandMenuIndex: React.Dispatch<React.SetStateAction<number>>;
  acceptActiveSuggestion: (value: string) => void;
};

export type KeyboardChatOptions = {
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  contentRows: number;
  maxScrollOffset: number;
  pendingRerun: boolean;
  setPendingRerun: React.Dispatch<React.SetStateAction<boolean>>;
  busy: boolean;
  stopTurn: () => void;
  submitChat: (value: string) => void;
  toggleAllGroups: () => void;
  toggleFocusedGroup: () => void;
  focusPrevGroup: () => void;
  focusNextGroup: () => void;
  unfocusGroup: () => void;
  hasFocusedGroup: boolean;
};

export type KeyboardHomeOptions = {
  sessionsModalOpen: boolean;
  setSessionsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sessionsModalIdx: number;
  setSessionsModalIdx: React.Dispatch<React.SetStateAction<number>>;
  sessions: RunState[];
  deleteSession: (idx: number) => void;
  selectedIdx: number;
  setSelectedIdx: React.Dispatch<React.SetStateAction<number>>;
  setHeroHidden: React.Dispatch<React.SetStateAction<boolean>>;
  openRun: (runPath: string, initialQuestion?: string) => Promise<void>;
  submitHome: (value: string) => Promise<void>;
};

type KeyboardOptions = {
  screen: Screen;
  input: KeyboardInputOptions;
  dialogs: KeyboardDialogOptions;
  suggestions: KeyboardSuggestionOptions;
  chat: KeyboardChatOptions;
  home: KeyboardHomeOptions;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  exit: () => void;
};

type InkKey = Parameters<Parameters<typeof useInput>[0]>[1];

export function useKeyboard(o: KeyboardOptions): void {
  const { screen, setNotice, exit } = o;
  const { text: inputText, setText: setInputText, cursorPos, setCursorPos, history: inputHistory, historyIndex, setHistoryIndex } = o.input;
  const {
    approvalPending, setApprovalPending, menu, setMenu, applyMenuSelection, helpOpen, setHelpOpen,
    mcpOpen, setMcpOpen, mcpRowIdx, setMcpRowIdx, mcpRowCount, toggleMcpRow, removeMcpRow,
  } = o.dialogs;
  const { activeSuggestions, activeSuggestionKind, commandMenuIndex, setCommandMenuIndex, acceptActiveSuggestion } = o.suggestions;
  const { setScrollOffset, contentRows, maxScrollOffset, pendingRerun, setPendingRerun, busy, stopTurn, submitChat, toggleAllGroups, toggleFocusedGroup, focusPrevGroup, focusNextGroup, unfocusGroup, hasFocusedGroup } = o.chat;
  const { sessionsModalOpen, setSessionsModalOpen, sessionsModalIdx, setSessionsModalIdx, sessions, deleteSession, selectedIdx, setSelectedIdx, setHeroHidden, openRun, submitHome } = o.home;

  const deleteArmedRef = useRef<number | null>(null);

  const editInput = (char: string, key: InkKey): boolean => {
    const deleteWordBefore = () => {
      const match = inputText.slice(0, cursorPos).match(/\S+\s*$/u);
      const toDelete = match ? match[0].length : 0;
      setInputText((c) => c.slice(0, cursorPos - toDelete) + c.slice(cursorPos));
      setCursorPos((p) => Math.max(0, p - toDelete));
    };
    if (key.leftArrow) { setCursorPos((p) => Math.max(0, p - 1)); return true; }
    if (key.rightArrow) { setCursorPos((p) => Math.min(inputText.length, p + 1)); return true; }
    if (key.delete && !key.backspace) {
      if (cursorPos < inputText.length) {
        setInputText((c) => c.slice(0, cursorPos) + c.slice(cursorPos + 1));
      }
      setCommandMenuIndex(0);
      if (screen === "home") setSelectedIdx(0);
      return true;
    }
    if (key.backspace) {
      if (key.ctrl) {
        deleteWordBefore();
      } else if (cursorPos > 0) {
        setInputText((c) => c.slice(0, cursorPos - 1) + c.slice(cursorPos));
        setCursorPos((p) => Math.max(0, p - 1));
      }
      setCommandMenuIndex(0);
      if (screen === "home") setSelectedIdx(0);
      return true;
    }
    if (key.ctrl && (char === "a" || char === "b")) { setCursorPos(0); return true; }
    if (key.ctrl && (char === "e" || char === "f")) { setCursorPos(inputText.length); return true; }
    if (key.ctrl && char === "w") {
      deleteWordBefore();
      setCommandMenuIndex(0);
      if (screen === "home") setSelectedIdx(0);
      return true;
    }
    if (key.escape) { setInputText(""); setCursorPos(0); setCommandMenuIndex(0); setHistoryIndex(-1); if (screen === "home") setSelectedIdx(0); return true; }
    if (char && !key.ctrl && !key.meta) {
      setInputText((c) => c.slice(0, cursorPos) + char + c.slice(cursorPos));
      setCursorPos((p) => p + char.length);
      setCommandMenuIndex(0);
      setHeroHidden(true);
      setHistoryIndex(-1);
      if (screen === "home") setSelectedIdx(0);
      return true;
    }
    return false;
  };

  useInput((char, key) => {
    if (char && (char.includes("[<") || /^\d+;\d+;\d+[Mm]$/u.test(char))) return;
    if (approvalPending) {
      if (char === "y" || char === "Y" || key.return) {
        const p = approvalPending;
        setApprovalPending(null);
        p.resolve(true);
      } else if (char === "n" || char === "N" || key.escape) {
        const p = approvalPending;
        setApprovalPending(null);
        p.resolve(false);
      }
      return;
    }
    if (menu) {
      if (key.escape) { setMenu(null); return; }
      if (menu.loading) return;
      const mFiltered = menu.query
        ? menu.items.filter((item) => item.toLowerCase().includes(menu.query.toLowerCase()))
        : menu.items;
      if (key.upArrow) {
        setMenu((m) => (m ? { ...m, index: Math.max(0, Math.min(m.index, mFiltered.length - 1) - 1) } : m));
        return;
      }
      if (key.downArrow) {
        setMenu((m) => (m ? { ...m, index: Math.max(0, Math.min(mFiltered.length - 1, m.index + 1)) } : m));
        return;
      }
      if (key.return) {
        const value = mFiltered[menu.index];
        if (value) { setMenu(null); void applyMenuSelection({ ...menu, items: [value], index: 0 }); }
        return;
      }
      if (key.backspace || key.delete) {
        setMenu((m) => (m ? { ...m, query: m.query.slice(0, -1), index: 0 } : m));
        return;
      }
      if (char.length === 1 && !key.ctrl && !key.meta) {
        setMenu((m) => (m ? { ...m, query: m.query + char, index: 0 } : m));
        return;
      }
      return;
    }
    if (helpOpen) {
      if (key.escape || key.return || char === "q") setHelpOpen(false);
      return;
    }
    if (mcpOpen) {
      if (key.escape || char === "q") { setMcpOpen(false); return; }
      if (key.upArrow) { setMcpRowIdx((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setMcpRowIdx((i) => Math.min(mcpRowCount - 1, i + 1)); return; }
      if (char === " " || key.return) { toggleMcpRow(mcpRowIdx); return; }
      if (char === "x" || char === "X") { removeMcpRow(mcpRowIdx); return; }
      return;
    }
    if (screen === "chat" && busy && key.escape) {
      stopTurn();
      return;
    }
    if (activeSuggestions.length > 0) {
      if (key.upArrow) {
        setCommandMenuIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setCommandMenuIndex((i) => Math.min(activeSuggestions.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        acceptActiveSuggestion(activeSuggestions[Math.min(commandMenuIndex, activeSuggestions.length - 1)] ?? inputText);
        return;
      }
    }
    if (screen === "chat" && (key.pageUp || key.pageDown)) {
      setScrollOffset((off) => {
        const step = Math.max(1, Math.floor(contentRows / 2));
        if (key.pageUp) return Math.min(off + step, maxScrollOffset);
        return Math.max(0, off - step);
      });
      return;
    }
    // Cancel pendingRerun if user types something other than /rerun
    if (pendingRerun && char && !(inputText + char).trim().startsWith("/rerun")) {
      setPendingRerun(false);
    }
    if (screen === "chat" && inputHistory.length > 0) {
      if (key.upArrow && !inputText) {
        const idx = historyIndex === -1 ? inputHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(idx);
        setInputText(inputHistory[idx]);
        setCursorPos(inputHistory[idx].length);
        return;
      }
      if (key.downArrow && historyIndex >= 0) {
        if (historyIndex === inputHistory.length - 1) {
          setHistoryIndex(-1);
          setInputText("");
          setCursorPos(0);
        } else {
          const idx = historyIndex + 1;
          setHistoryIndex(idx);
          setInputText(inputHistory[idx]);
          setCursorPos(inputHistory[idx].length);
        }
        return;
      }
    }
    if (sessionsModalOpen) {
      if (key.upArrow) { deleteArmedRef.current = null; setSessionsModalIdx((i) => Math.max(0, i - 1)); }
      else if (key.downArrow) { deleteArmedRef.current = null; setSessionsModalIdx((i) => Math.min(sessions.length - 1, i + 1)); }
      else if (char === "d") {
        if (deleteArmedRef.current === sessionsModalIdx) {
          deleteArmedRef.current = null;
          deleteSession(sessionsModalIdx);
        } else {
          deleteArmedRef.current = sessionsModalIdx;
          setNotice("Press d again to delete this session permanently.");
        }
      }
      else if (key.return) {
        deleteArmedRef.current = null;
        const s = sessions[sessionsModalIdx];
        if (s) { setSessionsModalOpen(false); void openRun(s.path); }
      }
      else if (key.escape) { deleteArmedRef.current = null; setSessionsModalOpen(false); }
      return;
    }
    if (screen === "home") {
      const hasBrowse = sessions.length > 0;
      const sessionItems = Math.min(sessions.length, 6);
      const browseIdx = hasBrowse ? sessionItems : -1;
      const newIdx = hasBrowse ? sessionItems + 1 : sessionItems;
      const quitIdx = hasBrowse ? sessionItems + 2 : sessionItems + 1;
      const maxHomeIdx = quitIdx;
      if (key.upArrow && !activeSuggestions.length) setSelectedIdx((i) => Math.max(0, i - 1));
      else if (key.downArrow && !activeSuggestions.length) setSelectedIdx((i) => Math.min(maxHomeIdx, i + 1));
      else if (key.return) {
        if (activeSuggestions.length > 0 && activeSuggestionKind === "command" && inputText.trim().startsWith("/")) {
          const selected = activeSuggestions[Math.min(commandMenuIndex, activeSuggestions.length - 1)] ?? inputText;
          if (completeCommandWithArgSuffix(selected, inputText, acceptActiveSuggestion)) return;
          void submitHome(selected);
        } else if (activeSuggestions.length > 0 && activeSuggestionKind === "file") {
          acceptActiveSuggestion(activeSuggestions[Math.min(commandMenuIndex, activeSuggestions.length - 1)] ?? inputText);
        } else if (activeSuggestions.length > 0 && activeSuggestionKind === "session") {
          acceptActiveSuggestion(activeSuggestions[Math.min(commandMenuIndex, activeSuggestions.length - 1)] ?? inputText);
        } else if (inputText.trim()) {
          void submitHome(inputText);
        } else if (selectedIdx === browseIdx) {
          setSessionsModalOpen(true);
          setSessionsModalIdx(0);
        } else if (selectedIdx === newIdx) {
          setNotice("Type a question below to start a new research run.");
        } else if (selectedIdx === quitIdx) {
          exit();
        } else {
          void submitHome("");
        }
      }
      else if (char === "q" && !inputText) exit();
      else if (key.ctrl && char === "d" && !inputText) exit();
      else editInput(char, key);
    } else {
      if (!inputText && !busy) {
        if (char === "c") { hasFocusedGroup ? toggleFocusedGroup() : toggleAllGroups(); return; }
        if (char === "[") { focusPrevGroup(); return; }
        if (char === "]") { focusNextGroup(); return; }
      }
      if (key.escape && !inputText && hasFocusedGroup) { unfocusGroup(); return; }
      if (key.return) {
        if (activeSuggestions.length > 0 && activeSuggestionKind === "command" && inputText.trim().startsWith("/")) {
          const selected = activeSuggestions[Math.min(commandMenuIndex, activeSuggestions.length - 1)] ?? inputText;
          if (completeCommandWithArgSuffix(selected, inputText, acceptActiveSuggestion)) return;
          submitChat(selected);
        } else if (activeSuggestions.length > 0 && activeSuggestionKind === "file") {
          acceptActiveSuggestion(activeSuggestions[Math.min(commandMenuIndex, activeSuggestions.length - 1)] ?? inputText);
        } else if (activeSuggestions.length > 0 && activeSuggestionKind === "session") {
          acceptActiveSuggestion(activeSuggestions[Math.min(commandMenuIndex, activeSuggestions.length - 1)] ?? inputText);
        } else {
          submitChat(inputText);
        }
      }
      else editInput(char, key);
    }
  }, { isActive: true });
}
