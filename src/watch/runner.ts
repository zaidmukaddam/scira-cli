import { readFile } from "node:fs/promises";
import { diffLines } from "diff";
import { createRun, listRuns, getRunPaths } from "../storage/run-store.js";
import { runResearchAgent } from "../agent/main-agent.js";
import { type SciraConfig } from "../types/index.js";

export type WatchOptions = {
  goal: string;
  intervalMs: number;
  maxRuns?: number;
  config: SciraConfig;
  projectRoot?: string;
  onRunStart?: (runPath: string, tick: number) => void;
  onRunComplete?: (runPath: string, diffText: string, tick: number) => void;
  onError?: (error: Error, tick: number) => void;
};

/** Compare two report.md texts and return a human-readable diff summary. */
export function diffReports(prev: string, next: string): string {
  const changes = diffLines(prev, next);
  const added = changes.filter((c) => c.added).map((c) => c.value.trim()).filter(Boolean);
  const removed = changes.filter((c) => c.removed).map((c) => c.value.trim()).filter(Boolean);
  if (added.length === 0 && removed.length === 0) return "No changes detected.";
  const lines: string[] = [];
  if (added.length > 0) {
    lines.push(`+++ ${added.length} added section(s):\n${added.map((a) => `  + ${a.slice(0, 120)}`).join("\n")}`);
  }
  if (removed.length > 0) {
    lines.push(`--- ${removed.length} removed section(s):\n${removed.map((r) => `  - ${r.slice(0, 120)}`).join("\n")}`);
  }
  return lines.join("\n");
}

async function getLastReport(goal: string, config: SciraConfig, projectRoot: string): Promise<string> {
  const runs = await listRuns(config, projectRoot);
  const last = runs.find((r) => r.goal === goal || r.goal.includes(goal));
  if (!last) return "";
  return readFile(getRunPaths(last.path).report, "utf8").catch(() => "");
}

/**
 * Run the watch loop. Resolves when maxRuns is reached or signal is aborted.
 */
export async function watchLoop(opts: WatchOptions, signal?: AbortSignal): Promise<void> {
  const { goal, intervalMs, maxRuns, config, projectRoot = process.cwd() } = opts;
  let tick = 0;

  while (!signal?.aborted) {
    if (maxRuns !== undefined && tick >= maxRuns) break;

    const prevReport = await getLastReport(goal, config, projectRoot);

    let runPath: string;
    try {
      const state = await createRun(goal, config, projectRoot);
      runPath = state.path;
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)), tick);
      break;
    }

    opts.onRunStart?.(runPath, tick);

    try {
      await runResearchAgent(runPath, goal, config);
      const nextReport = await Bun.file(getRunPaths(runPath).report).text().catch(() => "");
      const diffText = diffReports(prevReport, nextReport);
      opts.onRunComplete?.(runPath, diffText, tick);
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)), tick);
    }

    tick++;
    if (maxRuns !== undefined && tick >= maxRuns) break;

    await new Promise<void>((resolve) => {
      const id = setTimeout(resolve, intervalMs);
      signal?.addEventListener("abort", () => { clearTimeout(id); resolve(); }, { once: true });
    });
  }
}
