import { describe, it, expect } from "vitest";
import { resolveInsideRun } from "./tools.js";

const RUN = "/tmp/scira-test-run";

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
