import { describe, expect, it } from "vitest";
import { formatKeyGuide, formatMissingKeysHelp } from "./env-guide.js";

describe("env-guide", () => {
  it("includes signup URL and steps for a known key", () => {
    const text = formatKeyGuide("EXA_API_KEY");
    expect(text).toContain("EXA_API_KEY");
    expect(text).toContain("dashboard.exa.ai");
    expect(text).toContain("1.");
  });

  it("builds missing-key help from env checks", () => {
    const help = formatMissingKeysHelp([
      { name: "EXA_API_KEY", present: false, purpose: "exa web search", required: true }
    ]);
    expect(help).toContain("Missing required keys");
    expect(help).toContain("~/.scira/.env");
    expect(help).toContain("scira init");
  });
});
