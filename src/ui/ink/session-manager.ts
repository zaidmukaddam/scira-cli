import { type FeedItem, type ApprovalPending } from "./types.js";

export type { ApprovalPending };

export type SessionSubscriber = {
  pushFeed: (item: FeedItem) => void;
  appendText: (delta: string) => void;
  appendReasoning: (delta: string) => void;
  finishReasoning: () => void;
  markToolDone: (toolCallId: string, status: "done" | "error", result?: string) => void;
  onBusyChange: (busy: boolean) => void;
  onApprovalRequired: (pending: ApprovalPending) => void;
  onApprovalCleared: () => void;
  onEscalate: () => void;
  onModeChange: (full: boolean) => void;
};

type BackgroundSession = {
  runPath: string;
  feedBuffer: FeedItem[];
  busy: boolean;
  approvalPending: ApprovalPending | null;
  abort: AbortController | null;
  subscriber: SessionSubscriber | null;
};

const sessions = new Map<string, BackgroundSession>();

export function getSession(runPath: string): BackgroundSession | undefined {
  return sessions.get(runPath);
}

export function createSession(runPath: string): BackgroundSession {
  const existing = sessions.get(runPath);
  if (existing) return existing;
  const session: BackgroundSession = {
    runPath,
    feedBuffer: [],
    busy: false,
    approvalPending: null,
    abort: null,
    subscriber: null,
  };
  sessions.set(runPath, session);
  return session;
}

export function attachSubscriber(runPath: string, sub: SessionSubscriber): FeedItem[] {
  const session = sessions.get(runPath);
  if (!session) return [];
  session.subscriber = sub;
  return [...session.feedBuffer];
}

export function detachSubscriber(runPath: string): void {
  const session = sessions.get(runPath);
  if (session) session.subscriber = null;
  // deliberately NOT aborting — stream keeps running in the background
}

export function abortSession(runPath: string): void {
  const session = sessions.get(runPath);
  if (!session) return;
  session.abort?.abort();
  session.abort = null;
  session.busy = false;
  sessions.delete(runPath);
}

export function removeSession(runPath: string): void {
  sessions.delete(runPath);
}

/** Route a feed item to the correct subscriber method and buffer it. */
export function sessionPushFeed(runPath: string, item: FeedItem): void {
  const session = sessions.get(runPath);
  if (!session) return;
  const sub = session.subscriber;
  if (sub) {
    // Route to fine-grained helpers for smooth streaming rendering
    if (item.kind === "text") {
      sub.appendText(item.text);
      // Keep buffer in sync: merge into last text item or push new
      const last = session.feedBuffer.at(-1);
      if (last?.kind === "text") {
        session.feedBuffer[session.feedBuffer.length - 1] = { ...last, text: last.text + item.text };
      } else {
        session.feedBuffer.push(item);
      }
      return;
    }
    if (item.kind === "reasoning") {
      sub.appendReasoning(item.text);
      const last = session.feedBuffer.at(-1);
      if (last?.kind === "reasoning" && last.durationMs === undefined) {
        session.feedBuffer[session.feedBuffer.length - 1] = { ...last, text: last.text + item.text };
      } else {
        session.feedBuffer.push({ ...item, startedAt: item.startedAt ?? Date.now() });
      }
      return;
    }
    if (item.kind === "tool" && (item.status === "done" || item.status === "error") && item.toolCallId) {
      sub.markToolDone(item.toolCallId, item.status, item.result);
      // Update existing tool item in buffer
      for (let i = session.feedBuffer.length - 1; i >= 0; i--) {
        const b = session.feedBuffer[i];
        if (b.kind === "tool" && b.status === "running" && (b.toolCallId === item.toolCallId || !item.toolCallId)) {
          session.feedBuffer[i] = { ...b, status: item.status, result: item.result };
          break;
        }
      }
      return;
    }
    sub.pushFeed(item);
  }
  // No subscriber — always buffer
  if (item.kind === "tool" && (item.status === "done" || item.status === "error") && item.toolCallId) {
    for (let i = session.feedBuffer.length - 1; i >= 0; i--) {
      const b = session.feedBuffer[i];
      if (b.kind === "tool" && b.status === "running" && (b.toolCallId === item.toolCallId || !item.toolCallId)) {
        session.feedBuffer[i] = { ...b, status: item.status, result: item.result };
        return;
      }
    }
  }
  if (item.kind === "text") {
    const last = session.feedBuffer.at(-1);
    if (last?.kind === "text") { session.feedBuffer[session.feedBuffer.length - 1] = { ...last, text: last.text + item.text }; return; }
  }
  if (item.kind === "reasoning") {
    const last = session.feedBuffer.at(-1);
    if (last?.kind === "reasoning" && last.durationMs === undefined) { session.feedBuffer[session.feedBuffer.length - 1] = { ...last, text: last.text + item.text }; return; }
    session.feedBuffer.push({ ...item, startedAt: item.startedAt ?? Date.now() });
    return;
  }
  session.feedBuffer.push(item);
}

export function sessionFinishReasoning(runPath: string): void {
  const session = sessions.get(runPath);
  if (!session) return;
  const ended = Date.now();
  for (let i = session.feedBuffer.length - 1; i >= 0; i--) {
    const item = session.feedBuffer[i];
    if (item.kind === "reasoning" && item.durationMs === undefined) {
      session.feedBuffer[i] = { ...item, durationMs: ended - (item.startedAt ?? ended) };
      break;
    }
  }
  session.subscriber?.finishReasoning();
}

export function sessionSetBusy(runPath: string, busy: boolean): void {
  const session = sessions.get(runPath);
  if (!session) return;
  session.busy = busy;
  session.subscriber?.onBusyChange(busy);
}

export function sessionSetApproval(runPath: string, pending: ApprovalPending | null): void {
  const session = sessions.get(runPath);
  if (!session) return;
  session.approvalPending = pending;
  // NOTE: The resolve closure in pending is captured per-promise, so it correctly
  // resolves even if the subscriber changed (user navigated away and back).
  if (pending) {
    session.subscriber?.onApprovalRequired(pending);
  } else {
    session.subscriber?.onApprovalCleared();
  }
}

export function sessionNotifyEscalate(runPath: string): void {
  const session = sessions.get(runPath);
  session?.subscriber?.onEscalate();
}

export function sessionNotifyModeChange(runPath: string, full: boolean): void {
  const session = sessions.get(runPath);
  session?.subscriber?.onModeChange(full);
}
