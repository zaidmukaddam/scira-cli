import { describe, it, expect } from "bun:test";
import { harnessBasename, isRunArtifactPath, resolveInsideRun, resolveProjectRoot, resolveToolPath } from "./workspace.js";

const RUN = "/tmp/scira-test-run";
const PROJECT = "/Users/me/my-app";
const RUN_UNDER_SCIRA = `${PROJECT}/.scira/runs/2024-test-abc`;

describe("resolveInsideRun", () => {
  it("resolves a relative path inside the run dir", () => {
    expect(resolveInsideRun(RUN, "notes.md")).toBe(`${RUN}/notes.md`);
  });

  it("resolves a nested relative path inside the run dir", () => {
    expect(resolveInsideRun(RUN, "artifacts/output.txt")).toBe(`${RUN}/artifacts/output.txt`);
  });

  it("resolves an absolute path that is inside the run dir", () => {
    expect(resolveInsideRun(RUN, `${RUN}/plan.md`)).toBe(`${RUN}/plan.md`);
  });

  it("throws for a path that escapes with ../", () => {
    expect(() => resolveInsideRun(RUN, "../outside.txt")).toThrow("outside the run directory");
  });

  it("throws for a deep escape path", () => {
    expect(() => resolveInsideRun(RUN, "a/../../outside.txt")).toThrow("outside the run directory");
  });

  it("throws for an absolute path outside the run dir", () => {
    expect(() => resolveInsideRun(RUN, "/etc/passwd")).toThrow("outside the run directory");
  });

  it("throws for a home-dir escape", () => {
    const home = `${process.env.HOME ?? "/root"}/evil.sh`;
    expect(() => resolveInsideRun(RUN, home)).toThrow("outside the run directory");
  });
});

describe("resolveProjectRoot", () => {
  it("returns parent of .scira when run is under .scira/runs", () => {
    expect(resolveProjectRoot(RUN_UNDER_SCIRA)).toBe(PROJECT);
  });
});

describe("harnessBasename", () => {
  it("strips run: and ./ prefixes", () => {
    expect(harnessBasename("run:report.md")).toBe("report.md");
    expect(harnessBasename("./plan.md")).toBe("plan.md");
    expect(harnessBasename("notes.md")).toBe("notes.md");
  });
});

describe("isRunArtifactPath", () => {
  it("treats bare harness filenames as run artifacts", () => {
    expect(isRunArtifactPath("plan.md")).toBe(true);
    expect(isRunArtifactPath("notes.md")).toBe(true);
    expect(isRunArtifactPath("src/foo.ts")).toBe(false);
  });

  it("does not treat nested paths as run artifacts by basename", () => {
    expect(isRunArtifactPath("docs/notes.md")).toBe(false);
    expect(isRunArtifactPath("src/plan.md")).toBe(false);
  });

  it("treats run: prefix as run artifact", () => {
    expect(isRunArtifactPath("run:custom.md")).toBe(true);
  });
});

describe("resolveToolPath", () => {
  it("routes source paths to workspace", () => {
    const resolved = resolveToolPath(RUN_UNDER_SCIRA, PROJECT, "src/index.ts");
    expect(resolved.scope).toBe("workspace");
    expect(resolved.abs).toBe(`${PROJECT}/src/index.ts`);
  });

  it("routes plan.md to run directory", () => {
    const resolved = resolveToolPath(RUN_UNDER_SCIRA, PROJECT, "plan.md");
    expect(resolved.scope).toBe("run");
    expect(resolved.abs).toBe(`${RUN_UNDER_SCIRA}/plan.md`);
  });

  it("routes nested notes.md to workspace not run", () => {
    const resolved = resolveToolPath(RUN_UNDER_SCIRA, PROJECT, "docs/notes.md");
    expect(resolved.scope).toBe("workspace");
    expect(resolved.abs).toBe(`${PROJECT}/docs/notes.md`);
  });

  it("blocks writes into .scira from workspace paths", () => {
    expect(() => resolveToolPath(RUN_UNDER_SCIRA, PROJECT, ".scira/config.json")).toThrow("inside .scira");
  });
});
