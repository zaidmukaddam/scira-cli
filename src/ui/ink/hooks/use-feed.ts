import React, { useCallback, useRef, useState } from "react";
import { type FeedItem } from "../types.js";

export function useFeed(): {
  feed: FeedItem[];
  setFeed: React.Dispatch<React.SetStateAction<FeedItem[]>>;
  feedRef: React.RefObject<FeedItem[]>;
  pushFeed: (item: FeedItem) => void;
  appendText: (delta: string) => void;
  appendReasoning: (delta: string) => void;
  finishReasoning: () => void;
  markToolDone: (toolCallId: string, status: "done" | "error", result?: string) => void;
} {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedRef = useRef<FeedItem[]>([]);

  const pushFeed = useCallback((item: FeedItem) => {
    setFeed((f) => { const next = [...f, item]; feedRef.current = next; return next; });
  }, []);

  const appendText = useCallback((delta: string) => {
    setFeed((f) => {
      const next = [...f];
      const last = next.at(-1);
      if (last?.kind === "text") {
        next[next.length - 1] = { ...last, text: last.text + delta };
      } else {
        next.push({ kind: "text", text: delta });
      }
      feedRef.current = next;
      return next;
    });
  }, []);

  const appendReasoning = useCallback((delta: string) => {
    setFeed((f) => {
      const next = [...f];
      const last = next.at(-1);
      if (last?.kind === "reasoning" && last.durationMs === undefined) {
        next[next.length - 1] = { ...last, text: last.text + delta };
      } else {
        next.push({ kind: "reasoning", text: delta, startedAt: Date.now() });
      }
      feedRef.current = next;
      return next;
    });
  }, []);

  const finishReasoning = useCallback(() => {
    setFeed((f) => {
      let changed = false;
      const ended = Date.now();
      const next = f.map((it) => {
        if (it.kind === "reasoning" && it.durationMs === undefined) {
          changed = true;
          const startedAt = it.startedAt ?? ended;
          return { ...it, durationMs: ended - startedAt };
        }
        return it;
      });
      if (!changed) return f;
      feedRef.current = next;
      return next;
    });
  }, []);

  const markToolDone = useCallback((toolCallId: string, status: "done" | "error", result?: string) => {
    setFeed((f) => {
      const next = [...f];
      for (let i = next.length - 1; i >= 0; i--) {
        const item = next[i];
        if (item.kind === "tool" && item.status === "running" && (item.toolCallId === toolCallId || !toolCallId)) {
          next[i] = { ...item, status, result };
          break;
        }
      }
      feedRef.current = next;
      return next;
    });
  }, []);

  return { feed, setFeed, feedRef, pushFeed, appendText, appendReasoning, finishReasoning, markToolDone };
}
