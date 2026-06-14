import { type RoutineResult } from "../types/index.js";
import { readUnreadResults } from "../routines/result-store.js";

export async function checkRoutineNotices(): Promise<RoutineResult[]> {
  try {
    return await readUnreadResults();
  } catch {
    return [];
  }
}

function timeAgo(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function briefDiff(diffSummary: string): string {
  if (!diffSummary || diffSummary === "No changes detected.") return "no changes";
  const addMatch = /\+\+\+ (\d+) added/u.exec(diffSummary);
  const remMatch = /--- (\d+) removed/u.exec(diffSummary);
  const parts: string[] = [];
  if (addMatch) parts.push(`${addMatch[1]} added`);
  if (remMatch) parts.push(`${remMatch[1]} removed`);
  return parts.join(", ") || "changed";
}

export function formatRoutineNotice(results: RoutineResult[]): string {
  const ok = results.filter((r) => r.status === "ok");
  const err = results.filter((r) => r.status === "error");
  const lines: string[] = [`${results.length} routine result${results.length > 1 ? "s" : ""} ready:`];
  for (const r of ok) {
    lines.push(`  • ${r.routineName} — ran ${timeAgo(r.ranAt)}, ${briefDiff(r.diffSummary)}`);
  }
  for (const r of err) {
    lines.push(`  • ${r.routineName} — failed: ${r.errorMessage ?? "unknown error"}`);
  }
  lines.push(`Run: scira routine list  to view full reports`);
  return lines.join("\n");
}
