export type Screen = "home" | "chat";

export type FeedItem =
  | { kind: "user"; text: string; ts?: number }
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string; startedAt?: number; durationMs?: number }
  | { kind: "tool"; name: string; toolCallId?: string; summary: string; status: "running" | "done" | "error"; result?: string; input?: string }
  | { kind: "status"; text: string };

export type ModelUsage = { input: number; output: number; total: number; turns: number };
export type TurnUsage = { model: string; input: number; output: number; total: number; ts: number };
export type SessionUsage = { total: { input: number; output: number; total: number }; byModel: Record<string, ModelUsage>; turns: TurnUsage[] };
export type ApprovalPending = { toolName: string; description: string; resolve: (v: boolean) => void };
export type LinkPending = { url: string };
