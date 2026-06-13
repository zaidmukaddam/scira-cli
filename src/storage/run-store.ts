import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SciraConfig, RunState, Source, Claim } from "../types/index.js";
import { createRunId } from "../utils/ids.js";
import { appendJsonl, readJsonl } from "./jsonl.js";
import { isHarnessProvider } from "../providers/llm/registry.js";

export type RunPaths = {
  root: string;
  goal: string;
  plan: string;
  research: string;
  scope: string;
  progress: string;
  sources: string;
  claims: string;
  notes: string;
  report: string;
  log: string;
  handoff: string;
  artifacts: string;
  snapshots: string;
};

export function getRunPaths(runPath: string): RunPaths {
  return {
    root: runPath,
    goal: join(runPath, "goal.md"),
    plan: join(runPath, "plan.md"),
    research: join(runPath, "RESEARCH.md"),
    scope: join(runPath, "scope.json"),
    progress: join(runPath, "progress.md"),
    sources: join(runPath, "sources.jsonl"),
    claims: join(runPath, "claims.jsonl"),
    notes: join(runPath, "notes.md"),
    report: join(runPath, "report.md"),
    log: join(runPath, "run.log.jsonl"),
    handoff: join(runPath, "handoff.md"),
    artifacts: join(runPath, "artifacts"),
    snapshots: join(runPath, "snapshots")
  };
}

export async function createRun(goal: string, config: SciraConfig, projectRoot = process.cwd()): Promise<RunState> {
  const runId = createRunId(goal);
  const runPath = resolve(projectRoot, config.runDirectory, runId);
  const paths = getRunPaths(runPath);
  await mkdir(paths.artifacts, { recursive: true });
  await mkdir(paths.snapshots, { recursive: true });
  await Bun.write(paths.goal, `# Goal\n\n${goal}\n`);
  await Bun.write(paths.research, researchInstructions());
  await Bun.write(paths.scope, `${JSON.stringify({ goal, maxSources: config.maxSources, citationPolicy: config.citationPolicy }, null, 2)}\n`);
  await Bun.write(paths.progress, progressText("created", "Generate and approve research plan."));
  await Bun.write(paths.handoff, handoffText(goal, "created"));
  // The local-harness providers (claude-code / codex) run their own CLI, whose
  // Write tool refuses to overwrite a file it hasn't Read first. Pre-seeding the
  // agent-written artifacts would block it, so leave those for the agent to
  // create fresh. summarizeRun tolerates the missing files.
  if (!isHarnessProvider(config.llmProvider)) {
    await Bun.write(paths.plan, "# Research Plan\n\nPending plan generation.\n");
    await Bun.write(paths.sources, "");
    await Bun.write(paths.claims, "");
    await Bun.write(paths.notes, "# Notes\n\n");
    await Bun.write(paths.report, "# Report\n\nDraft not generated yet.\n");
  }
  await logEvent(paths.root, "run.created", { goal });
  return summarizeRun(paths.root);
}

export async function summarizeRun(runPath: string): Promise<RunState> {
  const paths = getRunPaths(runPath);
  const goal = (await Bun.file(paths.goal).text().catch(() => "")).replace(/^# Goal\s*/u, "").trim();
  const title = (await Bun.file(join(runPath, "title.md")).text().catch(() => "")).trim() || undefined;
  const sources = await readJsonl<Source>(paths.sources);
  const claims = await readJsonl<Claim>(paths.claims);
  const report = await Bun.file(paths.report).text().catch(() => "");
  // last activity = newest mtime among the files that change as a run progresses
  const mtimes = await Promise.all(
    [join(runPath, "convo.json"), paths.report, runPath].map((p) =>
      stat(p).then((s) => s.mtimeMs).catch(() => 0)
    )
  );
  const updatedAt = Math.max(0, ...mtimes);
  return {
    id: runPath.split(/[\\/]/u).at(-1) ?? runPath,
    path: runPath,
    goal,
    title,
    sourceCount: sources.length,
    claimCount: claims.length,
    weakCount: claims.filter((claim) => claim.status === "weak").length,
    reportDirty: report.length < 200 || report.includes("Draft not generated yet"),
    updatedAt,
    isFull: sources.length > 0 || claims.length > 0
  };
}

export async function setRunTitle(runPath: string, title: string): Promise<void> {
  await Bun.write(join(runPath, "title.md"), title.trim());
}

export async function deleteRun(runPath: string): Promise<void> {
  await rm(runPath, { recursive: true, force: true });
}

/** Build a human-readable verification report from the run's claim ledger (scope §16.2). */
export async function verificationReport(runPath: string): Promise<string> {
  const claims = await readJsonl<Claim>(getRunPaths(runPath).claims);
  if (claims.length === 0) {
    return "No claims recorded yet. Run the research agent first.";
  }
  const count = (status: Claim["status"]) => claims.filter((c) => c.status === status).length;
  const lines = [
    "Verification Report",
    "",
    `Claims: ${claims.length}`,
    `Verified: ${count("verified")}`,
    `Weak: ${count("weak")}`,
    `Contradicted: ${count("contradicted")}`,
    `Needs review: ${count("needs_review")}`,
    `Draft: ${count("draft")}`
  ];
  const flagged = claims.filter((c) => c.status === "weak" || c.status === "contradicted" || c.status === "needs_review");
  for (const claim of flagged) {
    lines.push("", `${claim.id} (${claim.status}): "${claim.text}"`, `Reason: ${claim.reason || "n/a"}`);
  }
  return lines.join("\n");
}

export async function listRuns(config: SciraConfig, projectRoot = process.cwd()): Promise<RunState[]> {
  const runsRoot = resolve(projectRoot, config.runDirectory);
  try {
    const entries = await readdir(runsRoot);
    const dirs = await Promise.all(entries.map(async (entry) => {
      const path = join(runsRoot, entry);
      return (await stat(path)).isDirectory() ? path : undefined;
    }));
    const settled = await Promise.allSettled(dirs.filter((path): path is string => Boolean(path)).map(summarizeRun));
    return settled
      .filter((r): r is PromiseFulfilledResult<RunState> => r.status === "fulfilled")
      .map((r) => r.value)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function findRun(runId: string, config: SciraConfig, projectRoot = process.cwd()): Promise<string> {
  const runs = await listRuns(config, projectRoot);
  const run = runs.find((candidate) => candidate.id === runId || candidate.id.includes(runId));
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  return run.path;
}

export async function logEvent(runPath: string, type: string, data: Record<string, unknown> = {}): Promise<void> {
  await appendJsonl(getRunPaths(runPath).log, { type, data, createdAt: new Date().toISOString() });
}

export function progressText(status: string, next: string): string {
  return `# Progress\n\nStatus: ${status}\n\nNext: ${next}\n`;
}

export function handoffText(goal: string, status: string): string {
  return `# Handoff\n\nGoal: ${goal}\n\nStatus: ${status}\n\nNext agent should inspect \`progress.md\`, \`sources.jsonl\`, \`claims.jsonl\`, and \`report.md\`.\n`;
}

function researchInstructions(): string {
  return `# Research Instructions\n\n- Prefer primary sources.\n- Never make uncited claims in final reports.\n- Mark vendor claims as vendor claims.\n- Check dates for pricing, market, company, and product claims.\n- Search for contradictions before finalizing.\n- Do not overstate weak evidence.\n- Put uncertain claims in the risks or open questions section.\n`;
}
