import { describe, expect, it } from "bun:test";
import { type FeedItem } from "../types.js";
import { computeGroups } from "./use-feed-lines.js";

describe("computeGroups", () => {
  it("lists thinking and tools in step order", () => {
    const feed: FeedItem[] = [
      { kind: "reasoning", text: "plan", durationMs: 100 },
      { kind: "tool", name: "webSearch", summary: "q", status: "done" },
      { kind: "reasoning", text: "read", durationMs: 50 },
      { kind: "tool", name: "readUrl", summary: "url", status: "done" },
    ];
    const { groups } = computeGroups(feed);
    const g = groups.get(0);
    expect(g?.stepLabels).toEqual(["thinking", "webSearch", "thinking", "readUrl"]);
    expect(g?.itemCount).toBe(4);
  });
});
