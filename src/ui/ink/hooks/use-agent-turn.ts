import React, { useCallback, useRef } from "react";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SciraConfig } from "../../../types/index.js";
import { createResearchAgent, createOneShotAgent, type AgentOptions } from "../../../agent/research-agent.js";
import { createBackgroundTaskManager, type BackgroundTaskManager } from "../../../tools/background-tasks.js";
import { resolveProjectRoot } from "../../../tools/workspace.js";
import { generateWithGateway } from "../../../providers/llm/gateway.js";
import { setRunTitle, summarizeRun } from "../../../storage/run-store.js";
import { type FeedItem, type TurnUsage } from "../types.js";
import { fmtDuration, fmtTokens, aggregateTurns, wantsFullResearch, summarizeToolInput } from "../lib/utils.js";
import { promptWithFileMentions } from "../lib/file-mentions.js";
import { markdownJoinerTransform } from "../../../utils/markdown-joiner.js";
import {
  createSession, getSession, removeSession, attachSubscriber,
  sessionPushFeed, sessionSetBusy, sessionSetApproval,
  sessionFinishReasoning, sessionNotifyEscalate, sessionNotifyModeChange,
  mergeFeedToolResults, getSessionFeedBuffer,
  type SessionSubscriber,
} from "../session-manager.js";

type AgentTurnOptions = {
  config: SciraConfig;
  currentRunPath: string | undefined;
  queuedPromptRef: React.RefObject<string | null>;
  fullModeRef: React.RefObject<boolean>;
  planModeRef: React.RefObject<boolean>;
  conversationRef: React.RefObject<{ role: "user" | "assistant"; content: string }[]>;
  turnsRef: React.RefObject<TurnUsage[]>;
  feedRef: React.RefObject<FeedItem[]>;
  setBusy: (v: boolean) => void;
  setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
  refreshRun: () => Promise<void>;
  recordUsage: (model: string, u: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) => void;
  setMode: (full: boolean) => void;
  setPlanMode: (active: boolean) => void;
  getSubscriber: () => SessionSubscriber;
};

export function useAgentTurn({
  config, currentRunPath, queuedPromptRef, fullModeRef, planModeRef, conversationRef, turnsRef, feedRef,
  setBusy, setScrollOffset, refreshRun, recordUsage, setMode, setPlanMode, getSubscriber,
}: AgentTurnOptions): {
  runTurn: (prompt: string, runPathOverride?: string) => Promise<void>;
  runTurnRef: React.RefObject<(prompt: string, runPathOverride?: string) => Promise<void>>;
} {
  const bgManagersRef = useRef(new Map<string, BackgroundTaskManager>());

  const runTurn = useCallback(async (prompt: string, runPathOverride?: string) => {
    const runPath = runPathOverride ?? currentRunPath;
    if (!runPath) return;
    const workspacePath = resolveProjectRoot(runPath);
    const existing = getSession(runPath);
    if (existing?.busy) return;
    const session = createSession(runPath);
    // Always re-attach subscriber so follow-up turns have a live listener.
    attachSubscriber(runPath, getSubscriber());
    const controller = new AbortController();
    session.abort = controller;
    setBusy(true);
    // Pin the just-sent user message to the top of the viewport, leaving room
    // below for the incoming assistant reply (-1 sentinel; see SciraApp).
    setScrollOffset(-1);
    sessionSetBusy(runPath, true);
    const modelId = config.model;
    const turnStartedAt = Date.now();
    const turnUsage = { input: 0, output: 0, total: 0 };
    let summary: Awaited<ReturnType<typeof summarizeRun>> | undefined;
    try {
      summary = await summarizeRun(runPath);
      if (summary && !summary.title && conversationRef.current.length === 0) {
        void (async () => {
          try {
            const title = await generateWithGateway(
              config,
              `Summarize this research topic into a very short title (3-5 words). Output ONLY the title, nothing else.\n\nTopic: ${summary!.goal}`
            );
            const cleanTitle = title.trim().replace(/^["']+|["']+$/gu, "").slice(0, 60);
            if (cleanTitle) await setRunTitle(runPath, cleanTitle);
          } catch { /* non-fatal */ }
        })();
      }
      const onApprovalRequired = (toolName: string, description: string): Promise<boolean> =>
        new Promise((resolve) => sessionSetApproval(runPath, { toolName, description, resolve }));

      const consume = async (result: { fullStream: AsyncIterable<any>; text: PromiseLike<string>; totalUsage: PromiseLike<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }> }): Promise<string> => {
        for await (const part of result.fullStream) {
          if (part.type !== "reasoning-delta" && part.type !== "reasoning-start") sessionFinishReasoning(runPath);
          switch (part.type) {
            case "text-delta":
              sessionPushFeed(runPath, { kind: "text", text: part.text });
              break;
            case "reasoning-delta":
              sessionPushFeed(runPath, { kind: "reasoning", text: part.text });
              break;
            case "reasoning-end":
              sessionFinishReasoning(runPath);
              break;
            case "tool-call":
              sessionPushFeed(runPath, { kind: "tool", name: part.toolName, toolCallId: part.toolCallId, summary: summarizeToolInput(part.toolName, part.input), status: "running" });
              break;
            case "tool-result": {
              if (part.preliminary) break;
              const raw = part.output;
              const resultText = typeof raw === "string" ? raw : JSON.stringify(raw);
              sessionPushFeed(runPath, {
                kind: "tool",
                name: "",
                toolCallId: part.toolCallId,
                summary: "",
                status: "done",
                result: resultText,
              });
              void refreshRun();
              break;
            }
            case "tool-error": {
              const errRaw = (part as { error?: unknown }).error;
              const errText = errRaw instanceof Error ? errRaw.message : String(errRaw);
              sessionPushFeed(runPath, {
                kind: "tool",
                name: "",
                toolCallId: part.toolCallId ?? "",
                summary: errText,
                status: "error",
                result: errText,
              });
              break;
            }
            case "error":
              sessionPushFeed(runPath, { kind: "status", text: `Error: ${String((part as { error?: unknown }).error)}` });
              break;
            default: break;
          }
        }
        sessionFinishReasoning(runPath);
        try {
          const u = await result.totalUsage;
          recordUsage(modelId, u);
          turnUsage.input += u.inputTokens ?? 0;
          turnUsage.output += u.outputTokens ?? 0;
          turnUsage.total += u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
        } catch { /* usage is best-effort */ }
        return result.text;
      };

      const mentioned = await promptWithFileMentions(prompt);
      if (mentioned.files.length > 0) sessionPushFeed(runPath, { kind: "status", text: `Attached ${mentioned.files.map((f) => `@${f}`).join(", ")}.` });
      let messages = [...conversationRef.current, { role: "user" as const, content: mentioned.prompt }];
      let finalText = "";

      if (!fullModeRef.current && wantsFullResearch(prompt)) {
        setPlanMode(false);
        setMode(true);
        fullModeRef.current = true;
        sessionNotifyModeChange(runPath, true);
        sessionPushFeed(runPath, { kind: "status", text: "Detected a research request — switching to the full research harness." });
      }

      let bgManager = bgManagersRef.current.get(runPath);
      if (!bgManager) {
        bgManager = createBackgroundTaskManager(runPath, workspacePath);
        bgManagersRef.current.set(runPath, bgManager);
      }
      const agentOptions: AgentOptions = {
        workspacePath,
        getPlanMode: () => planModeRef.current && !fullModeRef.current,
        backgroundTasks: bgManager
      };

      if (fullModeRef.current) {
        const bundle = await createResearchAgent(runPath, summary.goal, config, onApprovalRequired, agentOptions);
        try {
          finalText = await consume(await bundle.agent.stream({ messages, abortSignal: controller.signal, experimental_transform: markdownJoinerTransform() }));
        } finally {
          await bundle.close();
        }
      } else {
        const escalate = { requested: false };
        const oneShot = await createOneShotAgent(runPath, summary.goal, config, onApprovalRequired, () => { escalate.requested = true; }, agentOptions);
        try {
          finalText = await consume(await oneShot.agent.stream({ messages, abortSignal: controller.signal, experimental_transform: markdownJoinerTransform() }));
        } finally {
          await oneShot.close();
        }
        if (escalate.requested && !controller.signal.aborted) {
          setPlanMode(false);
          setMode(true);
          fullModeRef.current = true;
          sessionNotifyEscalate(runPath);
          sessionNotifyModeChange(runPath, true);
          sessionPushFeed(runPath, { kind: "status", text: "Escalated to the full research harness." });
          messages = [
            ...messages,
            { role: "assistant" as const, content: finalText },
            { role: "user" as const, content: "Approved. Now run the full research harness: discover skills, write plan.md, gather and read grounded sources, extract and verify claims, write sources.jsonl and a complete report.md, then give a short summary." }
          ];
          const full = await createResearchAgent(runPath, summary.goal, config, onApprovalRequired, {
            ...agentOptions,
            getPlanMode: () => false
          });
          try {
            finalText = await consume(await full.agent.stream({ messages, abortSignal: controller.signal, experimental_transform: markdownJoinerTransform() }));
          } finally {
            await full.close();
          }
        }
      }

      conversationRef.current = [...messages, { role: "assistant", content: finalText }];
      await refreshRun();
    } catch (error) {
      if (!controller.signal.aborted) {
        sessionPushFeed(runPath, { kind: "status", text: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      session.abort = null;
      setBusy(false);
      sessionSetBusy(runPath, false);
      sessionSetApproval(runPath, null);
      const elapsedMs = Date.now() - turnStartedAt;
      const parts: string[] = [];
      if (turnUsage.input > 0) parts.push(`↑${fmtTokens(turnUsage.input)}`);
      if (turnUsage.output > 0) parts.push(`↓${fmtTokens(turnUsage.output)}`);
      parts.push(`◌ ${fmtDuration(elapsedMs)}`);
      if (controller.signal.aborted) parts.push("stopped");
      sessionPushFeed(runPath, { kind: "status", text: parts.join(" · ") });
      if (turnUsage.input + turnUsage.output + turnUsage.total > 0) {
        turnsRef.current = [...turnsRef.current, { model: modelId, input: turnUsage.input, output: turnUsage.output, total: turnUsage.total, ts: Date.now() }];
      }
      const merged = mergeFeedToolResults(feedRef.current, getSessionFeedBuffer(runPath));
      const snapshot = merged
        .filter((item) => !(item.kind === "status" && item.text === "This will wipe the conversation history. Press /rerun again to confirm."))
        .map((item) =>
          item.kind === "tool" && item.status === "running" ? { ...item, status: "error" as const } : item
        );
      try {
        await writeFile(
          join(runPath, "convo.json"),
          JSON.stringify({ feed: snapshot, messages: conversationRef.current, usage: aggregateTurns(turnsRef.current) }, null, 2)
        );
      } catch { /* non-fatal */ }
      removeSession(runPath);
      const queued = queuedPromptRef.current;
      if (queued && !controller.signal.aborted) {
        queuedPromptRef.current = null;
        sessionPushFeed(runPath, { kind: "user", text: queued, ts: Date.now() });
        void runTurnRef.current(queued);
      }
    }
  }, [config, currentRunPath, refreshRun, recordUsage, setMode, setPlanMode, getSubscriber, fullModeRef, planModeRef]);

  const runTurnRef = useRef(runTurn);
  runTurnRef.current = runTurn;

  return { runTurn, runTurnRef };
}
