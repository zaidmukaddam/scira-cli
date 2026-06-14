import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ROUTINES_DIR, loadRoutines } from "../../routines/routine-store.js";
import { isDue, nextRunAt } from "../../routines/scheduler.js";

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

async function readLock(): Promise<{ pid: number; startedAt: string } | null> {
  try {
    return (await Bun.file(DAEMON_PID_FILE).json()) as { pid: number; startedAt: string };
  } catch {
    return null;
  }
}

export async function daemonStart(): Promise<void> {
  const lock = await readLock();
  if (lock && isProcessRunning(lock.pid)) {
    console.log(`Daemon already running (pid ${lock.pid})`);
    return;
  }

  // Locate daemon script relative to this compiled file
  // dist/cli/commands/daemon-cmd.js → dist/routines/daemon.js
  // src/cli/commands/daemon-cmd.ts  → src/routines/daemon.ts  (dev mode)
  const thisFile = fileURLToPath(import.meta.url);
  const ext = thisFile.endsWith(".ts") ? ".ts" : ".js";
  const daemonScript = join(dirname(thisFile), "..", "..", "routines", `daemon${ext}`);

  const bunExe = Bun.which("bun") ?? "bun";
  const child = spawn(bunExe, [daemonScript], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Give the daemon a moment to write its PID lock before we check
  await Bun.sleep(600);

  const newLock = await readLock();
  if (newLock && isProcessRunning(newLock.pid)) {
    console.log(`Daemon started (pid ${newLock.pid})`);
    console.log(`Log: ${DAEMON_LOG_FILE}`);
  } else {
    console.log(`Daemon may have failed to start. Check: ${DAEMON_LOG_FILE}`);
  }
}

export async function daemonStop(): Promise<void> {
  const lock = await readLock();
  if (!lock) {
    console.log("Daemon not running.");
    return;
  }
  if (!isProcessRunning(lock.pid)) {
    console.log("Daemon not running (stale pid file).");
    return;
  }
  process.kill(lock.pid, "SIGTERM");
  console.log(`Sent SIGTERM to daemon (pid ${lock.pid})`);
}

export async function daemonStatus(): Promise<void> {
  const lock = await readLock();
  if (!lock || !isProcessRunning(lock.pid)) {
    console.log("Daemon: not running");
    console.log("Start with: scira daemon start");
    return;
  }

  const upSecs = Math.floor((Date.now() - new Date(lock.startedAt).getTime()) / 1000);
  console.log(`Daemon: running (pid ${lock.pid}, uptime ${upSecs}s)`);
  console.log(`Log: ${DAEMON_LOG_FILE}`);

  try {
    const log = await readFile(DAEMON_LOG_FILE, "utf8");
    const lines = log.trim().split("\n").filter(Boolean).slice(-10);
    if (lines.length > 0) {
      console.log("\nLast log lines:");
      for (const line of lines) console.log(`  ${line}`);
    }
  } catch {
    /* no log yet */
  }

  const routines = await loadRoutines();
  const enabled = routines.filter((r) => r.enabled);
  if (enabled.length > 0) {
    console.log("\nScheduled routines:");
    const now = new Date();
    for (const r of enabled) {
      const due = isDue(r, now);
      const nextStr = due ? "due now" : nextRunAt(r, now).toLocaleString();
      console.log(`  ${r.name}  ${r.frequency}@${r.atHHMM}  next: ${nextStr}`);
    }
  } else {
    console.log("\nNo routines configured. Use: scira routine save <run-id>");
  }
}
