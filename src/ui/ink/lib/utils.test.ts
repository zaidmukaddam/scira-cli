import { describe, expect, it } from "vitest";
import { summarizeToolInput, summarizeToolOutput } from "./utils.js";

describe("summarizeToolInput", () => {
  it("formats webSearch queries", () => {
    expect(summarizeToolInput("webSearch", { queries: ["a", "b", "c"] })).toBe("a · b +1");
  });

  it("formats readUrl url", () => {
    expect(summarizeToolInput("readUrl", { url: "https://example.com" })).toBe("https://example.com");
  });
});

describe("summarizeToolOutput", () => {
  it("summarizes webSearch json results", () => {
    const output = JSON.stringify([
      { query: "q1", results: [{ title: "Alpha" }, { title: "Beta" }] },
      { query: "q2", results: [{ title: "Gamma" }] },
    ]);
    expect(summarizeToolOutput("webSearch", output)).toBe("3 results · Alpha · Beta · Gamma");
  });

  it("extracts readUrl page title", () => {
    const output = "# Example Page\n(snapshot saved to snapshots/example.md)\n\nBody text";
    expect(summarizeToolOutput("readUrl", output)).toBe("Example Page");
  });

  it("summarizes listSkills output", () => {
    const output = "plan: Write a research plan\nsources: Gather sources";
    expect(summarizeToolOutput("listSkills", output)).toBe("2 skills · plan, sources");
  });

  it("passes through predetermined string results", () => {
    expect(summarizeToolOutput("requestFullResearch", "Approved. Stop now and do not call more tools."))
      .toBe("Approved. Stop now and do not call more tools.");
  });
});
