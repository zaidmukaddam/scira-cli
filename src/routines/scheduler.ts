import { type Routine } from "../types/index.js";

function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function parseHHMM(atHHMM: string): { hours: number; minutes: number } {
  const [h, m] = atHHMM.split(":").map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

function targetTimeToday(atHHMM: string, ref: Date): Date {
  const { hours, minutes } = parseHHMM(atHHMM);
  const t = new Date(ref);
  t.setHours(hours, minutes, 0, 0);
  return t;
}

export function isDue(routine: Routine, now: Date): boolean {
  const dow = now.getDay(); // 0=Sun 6=Sat
  if (routine.frequency === "weekday" && (dow === 0 || dow === 6)) return false;
  if (routine.frequency === "week" && dow !== 1) return false; // Monday only

  const target = targetTimeToday(routine.atHHMM, now);
  if (now < target) return false; // not yet time today

  if (routine.lastRunAt === null) return true;
  return new Date(routine.lastRunAt) < startOfDay(target);
}

export function nextRunAt(routine: Routine, from: Date): Date {
  const candidate = new Date(from);

  for (let i = 0; i < 14; i++) {
    const { hours, minutes } = parseHHMM(routine.atHHMM);
    candidate.setHours(hours, minutes, 0, 0);

    const dow = candidate.getDay();
    const isValidDay =
      routine.frequency === "day" ||
      (routine.frequency === "weekday" && dow !== 0 && dow !== 6) ||
      (routine.frequency === "week" && dow === 1);

    if (isValidDay && candidate > from) return new Date(candidate);

    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
  }

  return candidate;
}
