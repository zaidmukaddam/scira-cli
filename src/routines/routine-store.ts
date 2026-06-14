import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Routine, RoutineSchema } from "../types/index.js";

export const ROUTINES_DIR = join(homedir(), ".scira", "routines");
const ROUTINES_FILE = join(ROUTINES_DIR, "routines.json");

export async function loadRoutines(): Promise<Routine[]> {
  try {
    const raw = (await Bun.file(ROUTINES_FILE).json()) as unknown[];
    return raw.map((r) => RoutineSchema.parse(r));
  } catch {
    return [];
  }
}

async function saveRoutines(list: Routine[]): Promise<void> {
  await mkdir(ROUTINES_DIR, { recursive: true });
  await Bun.write(ROUTINES_FILE, JSON.stringify(list, null, 2));
}

export function nextRoutineId(existing: Routine[]): string {
  const nums = existing
    .map((r) => /^routine_(\d+)$/u.exec(r.id)?.[1])
    .filter((n): n is string => Boolean(n))
    .map((n) => Number.parseInt(n, 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `routine_${String(next).padStart(3, "0")}`;
}

export async function addRoutine(r: Routine): Promise<void> {
  const list = await loadRoutines();
  await saveRoutines([...list, r]);
}

export async function removeRoutine(id: string): Promise<void> {
  const list = await loadRoutines();
  await saveRoutines(list.filter((r) => r.id !== id));
}

export async function updateRoutine(updated: Routine): Promise<void> {
  const list = await loadRoutines();
  await saveRoutines(list.map((r) => (r.id === updated.id ? updated : r)));
}

export async function findRoutine(idOrName: string): Promise<Routine | undefined> {
  const list = await loadRoutines();
  return list.find((r) => r.id === idOrName || r.name === idOrName);
}
