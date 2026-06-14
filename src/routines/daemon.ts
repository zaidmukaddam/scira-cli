#!/usr/bin/env bun
import { appendFile, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/load-config.js";
import { loadRoutines, ROUTINES_DIR } from "./routine-store.js";
import { isDue } from "./scheduler.js";
import { executeRoutine } from "./executor.js";

const DAEMON_PID_FILE = join(ROUTINES_DIR, "daemon.pid.json");
const DAEMON_LOG_FILE = join(ROUTINES_DIR, "daemon.log");

function isProcessRunning(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function log(msg: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  await appendFile(DAEMON_LOG_FILE, line).catch(() => {});
}

async function runTick(): Promise<void> {
  const routines = await loadRoutines();
  const now = new Date();
  for (const routine of routines) {
    if (!routine.enabled) continue;
    if (isDue(routine, now)) {
      void log(`starting routine "${routine.name}" (${routine.id})`);
      executeRoutine(routine)
        .then(() => log(`completed routine "${routine.name}"`))
        .catch((err: unknown) => {
          void log(`routine "${routine.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
  }
}

async function main(): Promise<void> {
  // Check for an existing daemon instance
  try {
    const lock = (await Bun.file(DAEMON_PID_FILE).json()) as { pid: number };
    if (isProcessRunning(lock.pid)) {
      process.stderr.write(`Daemon already running (pid ${lock.pid})\n`);
      process.exit(1);
    }
  } catch {
    /* no existing lock */
  }

  await mkdir(ROUTINES_DIR, { recursive: true });
  await Bun.write(
    DAEMON_PID_FILE,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
  );

  const cleanup = (): void => {
    rm(DAEMON_PID_FILE, { force: true }).catch(() => {});
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  await log(`started (pid ${process.pid})`);

  // Initial tick, then every 60s
  await runTick();
  setInterval(() => {
    runTick().catch((e: unknown) => {
      void log(`tick error: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, 60_000);
}

main().catch((err: unknown) => {
  process.stderr.write(`[daemon] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
