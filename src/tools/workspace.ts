import { isAbsolute, relative, resolve } from "node:path";

/** Harness files that live under .scira/runs/<id>/, not in the project codebase. */
export const RUN_ARTIFACT_FILES = new Set([
  "plan.md",
  "notes.md",
  "report.md",
  "sources.jsonl",
  "claims.jsonl",
  "goal.md",
  "RESEARCH.md",
  "scope.json",
  "progress.md",
  "handoff.md",
  "convo.json",
  "todos.json",
  "background-tasks.json",
  "title.md",
  "run.log.jsonl"
]);

/** Normalize a run-scoped path to its harness basename (strips run: and ./ prefixes). */
export function harnessBasename(displayPath: string): string {
  return displayPath.replace(/^run:/u, "").replace(/^\.\//u, "");
}

export function isRunArtifactPath(candidate: string): boolean {
  if (candidate.startsWith("run:")) return true;
  const normalized = candidate.replace(/\\/g, "/").replace(/^\.\//u, "");
  if (normalized.startsWith("snapshots/") || normalized.startsWith("artifacts/")) return true;
  // Harness files are referenced by bare filename at the run root, not nested paths.
  if (normalized.includes("/")) return false;
  return RUN_ARTIFACT_FILES.has(normalized);
}

/**
 * Project root: parent of `.scira` when the run lives under `.scira/runs/…`,
 * otherwise the current working directory (unless cwd is inside `.scira`).
 */
export function resolveProjectRoot(runPath: string, cwd = process.cwd()): string {
  const fromRun = projectRootFromPath(runPath);
  if (fromRun) return fromRun;
  const fromCwd = projectRootFromPath(resolve(cwd));
  if (fromCwd) return fromCwd;
  return resolve(cwd);
}

function projectRootFromPath(absPath: string): string | undefined {
  const normalized = resolve(absPath).replace(/\\/g, "/");
  const marker = "/.scira/";
  const idx = normalized.indexOf(marker);
  if (idx >= 0) return normalized.slice(0, idx) || "/";
  if (normalized.endsWith("/.scira")) return normalized.slice(0, -"/.scira".length) || "/";
  return undefined;
}

export type ResolvedToolPath = {
  abs: string;
  displayPath: string;
  scope: "run" | "workspace";
};

/** Absolute form of `candidate` if it lands inside the run directory, else null. */
function absInsideRun(runPath: string, workspacePath: string | undefined, raw: string): string | null {
  if (!isAbsolute(raw) && !workspacePath) return null; // can't resolve a relative path without a root
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(workspacePath!, raw);
  const rel = relative(resolve(runPath), abs);
  return !rel.startsWith("..") && !isAbsolute(rel) ? abs : null;
}

export function resolveToolPath(
  runPath: string,
  workspacePath: string | undefined,
  candidate: string
): ResolvedToolPath {
  const raw = candidate.trim();
  if (raw.startsWith("run:")) {
    const inner = raw.slice(4);
    const abs = resolveInsideRun(runPath, inner);
    return { abs, displayPath: inner, scope: "run" };
  }

  // A full/absolute path that points into the run directory routes to the run —
  // so the model can use the run dir path we hand it, not only bare names.
  const runAbs = absInsideRun(runPath, workspacePath, raw);
  if (runAbs) {
    const display = relative(resolve(runPath), runAbs) || ".";
    return { abs: runAbs, displayPath: display, scope: "run" };
  }

  if (workspacePath && !isRunArtifactPath(raw)) {
    const abs = resolveInsideWorkspace(workspacePath, raw);
    return { abs, displayPath: raw, scope: "workspace" };
  }

  const abs = resolveInsideRun(runPath, raw);
  return { abs, displayPath: raw, scope: "run" };
}

export function resolveInsideRun(runPath: string, candidate: string): string {
  const abs = isAbsolute(candidate) ? candidate : resolve(runPath, candidate);
  const rel = relative(runPath, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path "${candidate}" is outside the run directory and is not allowed.`);
  }
  return abs;
}

export function resolveInsideWorkspace(workspacePath: string, candidate: string): string {
  const abs = isAbsolute(candidate) ? candidate : resolve(workspacePath, candidate);
  const rel = relative(workspacePath, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path "${candidate}" is outside the project workspace.`);
  }
  const norm = rel.replace(/\\/g, "/");
  if (norm === ".scira" || norm.startsWith(".scira/")) {
    throw new Error(
      `Path "${candidate}" is inside .scira. Harness files use bare names (plan.md, notes.md, report.md). Source code paths are relative to the project root.`
    );
  }
  return abs;
}
