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

  /** Keep feedRef in sync immediately so convo.json saves never read stale React state. */
  const applyFeed = useCallback((update: (current: FeedItem[]) => FeedItem[]) => {
    const next = update(feedRef.current);
    feedRef.current = next;
    setFeed(next);
  }, []);

  const pushFeed = useCallback((item: FeedItem) => {
    applyFeed((f) => [...f, item]);
  }, [applyFeed]);

  const appendText = useCallback((delta: string) => {
    applyFeed((f) => {
      const next = [...f];
      const last = next.at(-1);
      if (last?.kind === "text") {
        next[next.length - 1] = { ...last, text: last.text + delta };
      } else {
        next.push({ kind: "text", text: delta });
      }
      return next;
    });
  }, [applyFeed]);

  const appendReasoning = useCallback((delta: string) => {
    applyFeed((f) => {
      const next = [...f];
      const last = next.at(-1);
      if (last?.kind === "reasoning" && last.durationMs === undefined) {
        next[next.length - 1] = { ...last, text: last.text + delta };
      } else {
        next.push({ kind: "reasoning", text: delta, startedAt: Date.now() });
      }
      return next;
    });
  }, [applyFeed]);

  const finishReasoning = useCallback(() => {
    applyFeed((f) => {
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
      return changed ? next : f;
    });
  }, [applyFeed]);

  const markToolDone = useCallback((toolCallId: string, status: "done" | "error", result?: string) => {
    applyFeed((f) => {
      const next = [...f];
      for (let i = next.length - 1; i >= 0; i--) {
        const item = next[i];
        if (item.kind === "tool" && item.status === "running" && (item.toolCallId === toolCallId || !toolCallId)) {
          next[i] = { ...item, status, result: result ?? item.result };
          break;
        }
      }
      return next;
    });
  }, [applyFeed]);

  return { feed, setFeed, feedRef, pushFeed, appendText, appendReasoning, finishReasoning, markToolDone };
}
