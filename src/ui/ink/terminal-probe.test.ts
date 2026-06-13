import { describe, expect, it } from "bun:test";
import { luminance, parseOscBackgroundColor, themeFromLuminance } from "./terminal-probe.js";

describe("terminal-probe", () => {
  it("parses rgb OSC background colors", () => {
    expect(parseOscBackgroundColor("rgb:1e1e/1e1e/1e1e")).toEqual({ r: 30, g: 30, b: 30 });
    expect(parseOscBackgroundColor("#f0f0f0")).toEqual({ r: 240, g: 240, b: 240 });
  });

  it("classifies luminance into light and dark", () => {
    expect(themeFromLuminance(luminance({ r: 30, g: 30, b: 30 }))).toBe("dark");
    expect(themeFromLuminance(luminance({ r: 240, g: 240, b: 240 }))).toBe("light");
  });
});
