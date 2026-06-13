import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendJsonl, readJsonl } from "./jsonl.js";

describe("readJsonl / appendJsonl", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scira-test-"));
    file = join(dir, "test.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns [] for a missing file", async () => {
    expect(await readJsonl(join(dir, "missing.jsonl"))).toEqual([]);
  });

  it("round-trips a single object", async () => {
    await appendJsonl(file, { id: "c1", text: "hello" });
    expect(await readJsonl(file)).toEqual([{ id: "c1", text: "hello" }]);
  });

  it("appends multiple objects sequentially", async () => {
    await appendJsonl(file, { n: 1 });
    await appendJsonl(file, { n: 2 });
    await appendJsonl(file, { n: 3 });
    expect(await readJsonl(file)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("skips malformed lines without throwing", async () => {
    await writeFile(file, '{"ok":true}\nNOT_JSON\n{"ok":false}\n');
    expect(await readJsonl(file)).toEqual([{ ok: true }, { ok: false }]);
  });

  it("creates parent directories that do not exist", async () => {
    const nested = join(dir, "a", "b", "c.jsonl");
    await appendJsonl(nested, { x: 1 });
    expect(await readJsonl(nested)).toEqual([{ x: 1 }]);
  });
});
