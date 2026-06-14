import { type Routine, type RoutineResult } from "../types/index.js";
import { loadConfig } from "../config/load-config.js";
import { createRun, listRuns, getRunPaths } from "../storage/run-store.js";
import { runResearchAgent } from "../agent/main-agent.js";
import { diffReports } from "../watch/runner.js";
import { updateRoutine } from "./routine-store.js";
import { appendResult } from "./result-store.js";
import { tryDesktopNotify } from "../utils/desktop-notify.js";

export async function executeRoutine(routine: Routine): Promise<void> {
  const config = await loadConfig(routine.projectRoot);

  // Optimistic lock — prevents re-fire if daemon tick overlaps with a running task
  await updateRoutine({ ...routine, lastRunAt: new Date().toISOString() });

  // Capture previous report before creating new run
  const prevRuns = await listRuns(config, routine.projectRoot);
  const prevRun = prevRuns.find((r) => r.goal === routine.goal);
  const prevReport = prevRun
    ? await Bun.file(getRunPaths(prevRun.path).report).text().catch(() => "")
    : "";

  let result: RoutineResult;
  try {
    const runState = await createRun(routine.goal, config, routine.projectRoot);
    await runResearchAgent(runState.path, routine.goal, config);
    const nextReport = await Bun.file(getRunPaths(runState.path).report).text().catch(() => "");
    const diffSummary = diffReports(prevReport, nextReport);
    result = {
      id: `result_${new Date().toISOString().replace(/[:.]/gu, "-")}`,
      routineId: routine.id,
      routineName: routine.name,
      runPath: runState.path,
      goal: routine.goal,
      diffSummary,
      ranAt: new Date().toISOString(),
      status: "ok",
    };
  } catch (err) {
    result = {
      id: `result_${new Date().toISOString().replace(/[:.]/gu, "-")}`,
      routineId: routine.id,
      routineName: routine.name,
      runPath: "",
      goal: routine.goal,
      diffSummary: "",
      ranAt: new Date().toISOString(),
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  await appendResult(result);
  if (result.status === "ok") {
    await tryDesktopNotify(
      `Scira: ${routine.name}`,
      result.diffSummary.slice(0, 200) || "Research complete."
    );
  }
}
