import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSciraEnv, parseEnvFile, projectEnvPath } from "./env-store.js";

describe("parseEnvFile", () => {
  it("parses comments, export prefix, and quoted values", () => {
    const entries = parseEnvFile(`
      # comment
      export EXA_API_KEY=global
      FIRECRAWL_API_KEY="quoted"
      PARALLEL_API_KEY='single'
    `);
    expect(entries).toEqual([
      ["EXA_API_KEY", "global"],
      ["FIRECRAWL_API_KEY", "quoted"],
      ["PARALLEL_API_KEY", "single"]
    ]);
  });
});

describe("loadSciraEnv", () => {
  it("loads project .scira/.env over global values", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "scira-env-"));
    const projectEnv = projectEnvPath(projectRoot);
    mkdirSync(join(projectRoot, ".scira"), { recursive: true });
    writeFileSync(projectEnv, "EXA_API_KEY=from-project\n");

    const shellValue = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
    process.env.SCIRA_TEST_GLOBAL_ENV = "1";
    process.env.EXA_API_KEY = "from-shell";

    try {
      loadSciraEnv(projectRoot);
      expect(process.env.EXA_API_KEY).toBe("from-shell");
    } finally {
      delete process.env.SCIRA_TEST_GLOBAL_ENV;
      if (shellValue === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = shellValue;
    }
  });

  it("applies project keys when not set in shell", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "scira-env-"));
    mkdirSync(join(projectRoot, ".scira"), { recursive: true });
    writeFileSync(projectEnvPath(projectRoot), "EXA_API_KEY=from-project\n");

    const shellValue = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;

    try {
      loadSciraEnv(projectRoot);
      expect(process.env.EXA_API_KEY).toBe("from-project");
    } finally {
      if (shellValue === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = shellValue;
    }
  });
});
