import { loadConfig } from "../../config/load-config.js";
import { findRun, summarizeRun } from "../../storage/run-store.js";
import {
  loadRoutines,
  addRoutine,
  removeRoutine,
  findRoutine,
  nextRoutineId,
} from "../../routines/routine-store.js";
import { isDue, nextRunAt } from "../../routines/scheduler.js";
import { executeRoutine } from "../../routines/executor.js";
import { type Routine } from "../../types/index.js";

export async function routineSave(
  runId: string,
  opts: { name?: string; at: string; every: string }
): Promise<void> {
  if (!/^\d{2}:\d{2}$/u.test(opts.at)) {
    throw new Error(`--at must be HH:MM in 24h format (got: ${opts.at})`);
  }
  const validFreqs = ["day", "weekday", "week"];
  if (!validFreqs.includes(opts.every)) {
    throw new Error(`--every must be one of: ${validFreqs.join(", ")} (got: ${opts.every})`);
  }

  const config = await loadConfig();
  const runPath = await findRun(runId, config);
  const state = await summarizeRun(runPath);

  const existing = await loadRoutines();
  const id = nextRoutineId(existing);
  const name = opts.name ?? id;

  const routine: Routine = {
    id,
    name,
    runId: state.id,
    goal: state.goal,
    projectRoot: process.cwd(),
    frequency: opts.every as Routine["frequency"],
    atHHMM: opts.at,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    enabled: true,
  };

  await addRoutine(routine);
  console.log(`Saved routine "${name}" (${id}) — runs ${opts.every} at ${opts.at}`);
  console.log(`Goal: ${state.goal}`);
  console.log(`\nStart the scheduler: scira daemon start`);
}

export async function routineList(): Promise<void> {
  const routines = await loadRoutines();
  if (routines.length === 0) {
    console.log("No routines saved. Use: scira routine save <run-id>");
    return;
  }
  const now = new Date();
  for (const r of routines) {
    const due = isDue(r, now);
    const nextStr = due ? "due now" : `next: ${nextRunAt(r, now).toLocaleString()}`;
    const status = r.enabled ? "enabled" : "disabled";
    console.log(`${r.id}  "${r.name}"  ${r.frequency}@${r.atHHMM}  [${status}]  ${nextStr}`);
    console.log(`  goal: ${r.goal.slice(0, 80)}`);
  }
}

export async function routineRemove(idOrName: string): Promise<void> {
  const r = await findRoutine(idOrName);
  if (!r) throw new Error(`Routine not found: ${idOrName}`);
  await removeRoutine(r.id);
  console.log(`Removed routine "${r.name}" (${r.id})`);
}

export async function routineRun(idOrName: string): Promise<void> {
  const r = await findRoutine(idOrName);
  if (!r) throw new Error(`Routine not found: ${idOrName}`);
  console.log(`Running routine "${r.name}"…`);
  await executeRoutine(r);
  console.log(`Done. Result saved to ~/.scira/routines/results.jsonl`);
}
