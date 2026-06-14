import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type RoutineResult } from "../types/index.js";
import { appendJsonl, readJsonl } from "../storage/jsonl.js";
import { ROUTINES_DIR } from "./routine-store.js";

const RESULTS_FILE = join(ROUTINES_DIR, "results.jsonl");
const CURSOR_FILE = join(ROUTINES_DIR, "read-cursor.json");

export async function appendResult(r: RoutineResult): Promise<void> {
  await appendJsonl(RESULTS_FILE, r);
}

export async function readAllResults(): Promise<RoutineResult[]> {
  return readJsonl<RoutineResult>(RESULTS_FILE);
}

export async function readUnreadResults(): Promise<RoutineResult[]> {
  let cursor = 0;
  try {
    const raw = (await Bun.file(CURSOR_FILE).json()) as { lastReadIndex: number };
    cursor = raw.lastReadIndex ?? 0;
  } catch {
    /* no cursor yet */
  }

  const all = await readAllResults();
  const unread = all.slice(cursor);

  if (unread.length > 0) {
    await mkdir(ROUTINES_DIR, { recursive: true });
    await Bun.write(CURSOR_FILE, JSON.stringify({ lastReadIndex: all.length }));
  }

  return unread;
}
