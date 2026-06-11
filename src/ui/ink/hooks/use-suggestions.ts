import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { CHAT_COMMANDS } from "../constants.js";
import { listMentionableFiles, activeFileMention } from "../lib/file-mentions.js";
import { type RunState } from "../../../types/index.js";

type SuggestionsOptions = {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  setCursorPos: React.Dispatch<React.SetStateAction<number>>;
  sessions: RunState[];
  openRun: (runPath: string, initialQuestion?: string) => void | Promise<void>;
  refreshSessions: () => Promise<void>;
};

export function sessionLabel(s: RunState): string {
  return (s.title ?? s.goal ?? s.id).replace(/\s+/gu, " ").trim();
}

export function useSuggestions({ inputText, setInputText, setCursorPos, sessions, openRun, refreshSessions }: SuggestionsOptions): {
  activeSuggestions: string[];
  activeSuggestionKind: "file" | "command" | "session" | null;
  acceptActiveSuggestion: (value: string) => void;
} {
  const cachedFilesRef = useRef<string[] | null>(null);
  const sessionMatchesRef = useRef<RunState[]>([]);

  const commandSuggestions = useMemo(() => {
    const match = inputText.match(/(?:^|\s)(\/[a-z]*)$/u);
    if (!match) return [];
    const fragment = match[1];
    return CHAT_COMMANDS.filter((cmd) => cmd.startsWith(fragment));
  }, [inputText]);

  const fileMentionSuggestions = useMemo(() => {
    const mention = activeFileMention(inputText);
    if (!mention) return [];
    const fragment = mention.fragment.toLowerCase();
    if (!cachedFilesRef.current) cachedFilesRef.current = listMentionableFiles();
    return cachedFilesRef.current
      .filter((file) => file.toLowerCase().includes(fragment))
      .slice(0, 50);
  }, [inputText]);

  const sessionSuggestions = useMemo(() => {
    if (!inputText.startsWith("#")) { sessionMatchesRef.current = []; return []; }
    const fragment = inputText.slice(1).trim().toLowerCase();
    const matches = sessions
      .filter((s) => fragment === "" || sessionLabel(s).toLowerCase().includes(fragment))
      .slice(0, 50);
    sessionMatchesRef.current = matches;
    return matches.map(sessionLabel);
  }, [inputText, sessions]);

  // Refresh sessions when typing # if the list is empty
  React.useEffect(() => {
    if (inputText.startsWith("#") && sessions.length === 0) {
      void refreshSessions();
    }
  }, [inputText, sessions.length, refreshSessions]);

  const activeSuggestions = fileMentionSuggestions.length > 0
    ? fileMentionSuggestions
    : sessionSuggestions.length > 0
      ? sessionSuggestions
      : commandSuggestions;
  const activeSuggestionKind: "file" | "command" | "session" | null =
    fileMentionSuggestions.length > 0 ? "file"
      : sessionSuggestions.length > 0 ? "session"
        : commandSuggestions.length > 0 ? "command" : null;

  const acceptCommandSuggestion = useCallback((cmd: string) => {
    setInputText((text) => {
      const match = text.match(/(?:^|\s)(\/[a-z]*)$/u);
      const next = !match || match.index === undefined
        ? cmd
        : `${text.slice(0, match.index + match[0].length - match[1].length)}${cmd}`;
      setCursorPos(next.length);
      return next;
    });
  }, [setCursorPos, setInputText]);

  const acceptFileMentionSuggestion = useCallback((file: string) => {
    setInputText((text) => {
      const mention = activeFileMention(text);
      const next = !mention
        ? `@${file}`
        : `${text.slice(0, mention.start)}@${file}${text.slice(mention.start + mention.fragment.length + 1)}`;
      setCursorPos(next.length);
      return next;
    });
  }, [setCursorPos, setInputText]);

  const acceptSessionSuggestion = useCallback((label: string) => {
    const match = sessionMatchesRef.current.find((s) => sessionLabel(s) === label) ?? sessionMatchesRef.current[0];
    if (!match) return;
    setInputText("");
    setCursorPos(0);
    void openRun(match.path);
  }, [openRun, setInputText, setCursorPos]);

  const acceptActiveSuggestion = useCallback((value: string) => {
    if (activeSuggestionKind === "file") acceptFileMentionSuggestion(value);
    else if (activeSuggestionKind === "session") acceptSessionSuggestion(value);
    else acceptCommandSuggestion(value);
  }, [acceptCommandSuggestion, acceptFileMentionSuggestion, acceptSessionSuggestion, activeSuggestionKind]);

  return { activeSuggestions, activeSuggestionKind, acceptActiveSuggestion };
}
