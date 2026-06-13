import { describe, it, expect } from "bun:test";
import { ClaimSchema, SourceSchema, SciraConfigSchema } from "./index.js";

describe("ClaimSchema", () => {
  it("parses a valid claim with defaults", () => {
    const result = ClaimSchema.parse({
      id: "c1",
      text: "The sky is blue.",
      createdAt: new Date().toISOString(),
    });
    expect(result.confidence).toBe("medium");
    expect(result.status).toBe("draft");
    expect(result.sourceIds).toEqual([]);
    expect(result.reason).toBe("");
  });

  it("rejects an invalid confidence value", () => {
    expect(() =>
      ClaimSchema.parse({ id: "c1", text: "x", confidence: "very_high", createdAt: "" })
    ).toThrow();
  });

  it("rejects an invalid status value", () => {
    expect(() =>
      ClaimSchema.parse({ id: "c1", text: "x", status: "maybe", createdAt: "" })
    ).toThrow();
  });

  it("preserves all fields when fully specified", () => {
    const input = {
      id: "c2",
      text: "Claim text.",
      confidence: "high" as const,
      status: "verified" as const,
      sourceIds: ["s1", "s2"],
      reason: "Verified by primary source.",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(ClaimSchema.parse(input)).toEqual(input);
  });
});

describe("SourceSchema", () => {
  it("parses a valid source with defaults", () => {
    const result = SourceSchema.parse({
      id: "s1",
      title: "Example",
      url: "https://example.com",
      createdAt: new Date().toISOString(),
    });
    expect(result.kind).toBe("unknown");
    expect(result.summary).toBe("");
  });

  it("rejects an invalid kind value", () => {
    expect(() =>
      SourceSchema.parse({ id: "s1", title: "t", url: "u", kind: "blog", createdAt: "" })
    ).toThrow();
  });
});

describe("SciraConfigSchema", () => {
  it("parses an empty object using all defaults", () => {
    const config = SciraConfigSchema.parse({});
    expect(config.llmProvider).toBe("gateway");
    expect(config.approvalMode).toBe("suggest");
    expect(config.alwaysAllowLinks).toBe(false);
    expect(config.runDirectory).toBe(".scira/runs");
    expect(config.maxSources).toBe(20);
  });

  it("rejects an invalid approvalMode", () => {
    expect(() => SciraConfigSchema.parse({ approvalMode: "yolo" })).toThrow();
  });
});
