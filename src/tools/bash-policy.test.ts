import { describe, it, expect } from "bun:test";
import { isReadOnlyBashCommand } from "./agent-tools.js";

describe("isReadOnlyBashCommand", () => {
  it("allows common read-only commands", () => {
    expect(isReadOnlyBashCommand("ls -la")).toBe(true);
    expect(isReadOnlyBashCommand("cat package.json")).toBe(true);
    expect(isReadOnlyBashCommand("git status")).toBe(true);
    expect(isReadOnlyBashCommand("git log --oneline -5")).toBe(true);
    expect(isReadOnlyBashCommand("git branch")).toBe(false);
    expect(isReadOnlyBashCommand("git remote -v")).toBe(false);
  });

  it("rejects chained or mutating commands", () => {
    expect(isReadOnlyBashCommand("ls; rm -rf /")).toBe(false);
    expect(isReadOnlyBashCommand("git commit -m x")).toBe(false);
    expect(isReadOnlyBashCommand("npm install")).toBe(false);
  });

  it("rejects multiline chaining and destructive find", () => {
    expect(isReadOnlyBashCommand("git status\nrm -rf .")).toBe(false);
    expect(isReadOnlyBashCommand("git status\nnpm install")).toBe(false);
    expect(isReadOnlyBashCommand("find . -delete")).toBe(false);
    expect(isReadOnlyBashCommand("find . -exec rm {} +")).toBe(false);
    expect(isReadOnlyBashCommand("find . -type f")).toBe(true);
  });

  it("rejects path traversal and absolute paths", () => {
    expect(isReadOnlyBashCommand("cat ../secret")).toBe(false);
    expect(isReadOnlyBashCommand("grep -r token ..")).toBe(false);
    expect(isReadOnlyBashCommand("ls /")).toBe(false);
    expect(isReadOnlyBashCommand("cat .//etc/passwd")).toBe(false);
    expect(isReadOnlyBashCommand("grep -r secret .//etc")).toBe(false);
    expect(isReadOnlyBashCommand("cat package.json")).toBe(true);
    expect(isReadOnlyBashCommand("grep -rn foo .")).toBe(true);
  });

  it("rejects privileged flags on allowlisted binaries", () => {
    expect(isReadOnlyBashCommand("git diff --extcmd=sh")).toBe(false);
    expect(isReadOnlyBashCommand("rg --pre=bash -- foo .")).toBe(false);
    expect(isReadOnlyBashCommand("git -c alias.status=!rm status")).toBe(false);
  });
});
