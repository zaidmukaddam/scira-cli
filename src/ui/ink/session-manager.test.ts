import { describe, expect, it } from "vitest";
import { type FeedItem } from "./types.js";
import { mergeFeedToolResults } from "./session-manager.js";

describe("mergeFeedToolResults", () => {
  it("replaces truncated tool results with full buffer copies", () => {
    const feed: FeedItem[] = [
      {
        kind: "tool",
        name: "webSearch",
        toolCallId: "call-1",
        summary: "query a",
        status: "done",
        result: "truncated…",
      },
    ];
    const buffer: FeedItem[] = [
      {
        kind: "tool",
        name: "webSearch",
        toolCallId: "call-1",
        summary: "query a",
        status: "done",
        result: "x".repeat(5000),
      },
    ];
    const merged = mergeFeedToolResults(feed, buffer);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].result).toHaveLength(5000);
    }
  });
});
