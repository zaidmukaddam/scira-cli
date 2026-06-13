import { describe, expect, it } from "bun:test";
import { SciraConfigSchema } from "../types/index.js";
import { multiSearchWeb } from "./search-web.js";

const BASE_CONFIG = SciraConfigSchema.parse({});

describe("multiSearchWeb", () => {
  it("reports provider errors instead of silently returning empty results", async () => {
    const origExa = process.env.EXA_API_KEY;
    const origFc = process.env.FIRECRAWL_API_KEY;
    process.env.EXA_API_KEY = "invalid";
    process.env.FIRECRAWL_API_KEY = "invalid";

    const config = { ...BASE_CONFIG, search: { ...BASE_CONFIG.search, provider: "exa" as const } };
    const results = await multiSearchWeb(["test query"], [{}], config);

    expect(results[0]?.results).toEqual([]);
    expect(results[0]?.error).toMatch(/invalid|unauthorized|api key/i);

    if (origExa) process.env.EXA_API_KEY = origExa;
    else delete process.env.EXA_API_KEY;
    if (origFc) process.env.FIRECRAWL_API_KEY = origFc;
    else delete process.env.FIRECRAWL_API_KEY;
  });
});
