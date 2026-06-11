import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRun, summarizeRun, setRunTitle, getRunPaths } from "./run-store.js";
import { SciraConfigSchema } from "../types/index.js";
import { appendJsonl } from "./jsonl.js";

const BASE_CONFIG = SciraConfigSchema.parse({});

describe("createRun / summarizeRun", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "scira-runs-"));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("creates all expected files and subdirectories", async () => {
    const config = { ...BASE_CONFIG, runDirectory: tmpRoot };
    const state = await createRun("What is the speed of light?", config, "");
    const paths = getRunPaths(state.path);
    const { readFile, stat } = await import("node:fs/promises");
    await expect(readFile(paths.goal, "utf8")).resolves.toContain("speed of light");
    await expect(stat(paths.artifacts)).resolves.toBeDefined();
    await expect(stat(paths.snapshots)).resolves.toBeDefined();
  });

  it("summarizeRun reflects zero sources and claims on a fresh run", async () => {
    const config = { ...BASE_CONFIG, runDirectory: tmpRoot };
    const state = await createRun("Test question", config, "");
    expect(state.sourceCount).toBe(0);
    expect(state.claimCount).toBe(0);
    expect(state.weakCount).toBe(0);
    expect(state.isFull).toBe(false);
    expect(state.reportDirty).toBe(true);
    expect(state.goal).toContain("Test question");
  });

  it("setRunTitle persists the title and summarizeRun reads it back", async () => {
    const config = { ...BASE_CONFIG, runDirectory: tmpRoot };
    const state = await createRun("Title test", config, "");
    await setRunTitle(state.path, "My Custom Title");
    const updated = await summarizeRun(state.path);
    expect(updated.title).toBe("My Custom Title");
  });

  it("isFull becomes true once a source is appended", async () => {
    const config = { ...BASE_CONFIG, runDirectory: tmpRoot };
    const state = await createRun("Full test", config, "");
    const paths = getRunPaths(state.path);
    await appendJsonl(paths.sources, {
      id: "s1", title: "Test", url: "https://test.com",
      kind: "primary", summary: "", createdAt: new Date().toISOString()
    });
    const updated = await summarizeRun(state.path);
    expect(updated.sourceCount).toBe(1);
    expect(updated.isFull).toBe(true);
  });

  it("weakCount reflects weak claims", async () => {
    const config = { ...BASE_CONFIG, runDirectory: tmpRoot };
    const state = await createRun("Weak test", config, "");
    const paths = getRunPaths(state.path);
    await appendJsonl(paths.claims, { id: "c1", text: "x", confidence: "low", status: "weak", sourceIds: [], reason: "", createdAt: new Date().toISOString() });
    await appendJsonl(paths.claims, { id: "c2", text: "y", confidence: "high", status: "verified", sourceIds: [], reason: "", createdAt: new Date().toISOString() });
    const updated = await summarizeRun(state.path);
    expect(updated.claimCount).toBe(2);
    expect(updated.weakCount).toBe(1);
  });
});
